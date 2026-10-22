import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { BackgroundJob, JobError, JobInput, JobStage, ModelCallRecord, OutlineResult, Platform } from '../shared/types.js';
import { FileStateStore, HISTORY_TTL } from './state-store.js';
import { WorkflowError } from './outlines.js';

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface StoredJob {
  job: BackgroundJob; inputHash: string; configHash: string;
  snapshot?: OutlineResult; binding?: unknown; checkpoints: Record<string, unknown>;
  runId: string; dispatched?: boolean;
  /** HTTP success is not a durable parsed result; only a stage checkpoint clears this. */
  pendingPaid?: Record<string, { stage: string; platform?: Platform }>;
}
export interface JobContext {
  signal: AbortSignal;
  save(): void;
  call(record: ModelCallRecord): void;
  /** Clear in memory, then commit alongside the successful output with save(). */
  acknowledge(stage: JobStage, platform?: Platform): void;
}
export type JobExecutor = (record: StoredJob, context: JobContext) => Promise<void>;
const terminal = new Set(['completed', 'cancelled']);
export function jobError(error: unknown, stage: JobStage, platform?: Platform): JobError {
  const e = error as { message?: string; code?: string; status?: number; upstreamStatus?: number; outcomeUnknown?: boolean; retryable?: boolean } | undefined;
  let message = e?.message || '任务失败，已保留成功步骤。';
  for (const name of ['LLM_API_KEY', 'IMA_OPENAPI_APIKEY', 'IMA_OPENAPI_CLIENTID', 'IMA_API_KEY', 'IMA_CLIENT_ID']) {
    const secret = process.env[name]; if (secret) message = message.split(secret).join('[已隐藏]');
  }
  message = message.replace(/sk-[A-Za-z0-9._~+/-]{8,}={0,2}/g, '[已隐藏]').replace(/\/(?:Users|home|tmp|private|var|workspace)\/[^\s，。；]+/g, '[本地路径已隐藏]').slice(0, 900);
  const status = e?.upstreamStatus;
  return { message, code: e?.code || 'JOB_ERROR', stage, platform, upstreamStatus: status,
    retryable: e?.retryable ?? (![400, 403, 409, 410, 422].includes(e?.status || 0) && e?.code !== 'MODEL_CONFIG'), outcomeUnknown: !!e?.outcomeUnknown };
}
/** One-process durable scheduler. Dispatch is recorded before any paid HTTP request. */
export class JobQueue {
  private records = new Map<string, StoredJob>();
  private controllers = new Map<string, AbortController>();
  private events = new EventEmitter();
  private active = 0; private renderActive = 0; private scheduled = false; private stopped = false;
  constructor(private store: FileStateStore, private execute: JobExecutor, private configHash: () => string, private maxActive = 2) {
    this.events.setMaxListeners(100);
    for (const [id, record] of store.entries<StoredJob>('jobs')) {
      if (!record?.job || record.job.id !== id || !Array.isArray(record.job.channels) || !record.checkpoints) throw new WorkflowError(503, '本地任务记录损坏，已保留原文件，请检查后恢复。');
      if (Date.parse(record.job.expiresAt) <= Date.now()) continue;
      if (record.job.status === 'running' || record.job.status === 'queued') {
        const legacy = record.pendingPaid === undefined;
        record.pendingPaid ||= {};
        for (const call of record.job.calls) if (call.outcome === 'dispatched' || legacy && call.outcome === 'succeeded') {
          record.pendingPaid[call.id] ||= { stage: call.stage, platform: call.platform };
        }
        const pendingCalls = Object.values(record.pendingPaid);
        const unknown = pendingCalls.length > 0;
        record.job.status = unknown ? 'interrupted' : 'queued';
        for (const c of record.job.channels) {
          const pending = pendingCalls.some(call => !call.platform || call.platform === c.platform);
          if (!pending && c.status !== 'running') continue;
          c.status = pending ? 'interrupted' : 'queued';
          if (pending) c.error = { code: 'JOB_INTERRUPTED', message: '服务重启，已派发请求的结果不确定。主动重试可能再次产生消耗。', stage: c.stage, platform: c.platform, retryable: true, outcomeUnknown: true };
        }
        if (unknown) {
          record.job.error = { code: 'JOB_INTERRUPTED', message: '服务重启，未确认的付费步骤不会自动重发；成功检查点已保留。', stage: record.job.channels.find(c => c.error)?.stage || 'outline', retryable: true, outcomeUnknown: true };
          for (const call of record.job.calls) if (call.outcome === 'dispatched') { call.outcome = 'unknown'; call.endedAt = new Date().toISOString(); call.code = 'JOB_INTERRUPTED'; }
        }
        store.set('jobs', id, record);
      }
      this.records.set(id, record);
    }
  }
  start() { this.schedule(); }
  hasPending() { return this.controllers.size > 0 || [...this.records.values()].some(r => Date.parse(r.job.expiresAt) > Date.now() && ['queued', 'running'].includes(r.job.status)); }
  hasOutlineMutation(id: string) { return [...this.records.values()].some(r => (this.controllers.has(r.job.id) || Date.parse(r.job.expiresAt) > Date.now() && ['queued', 'running'].includes(r.job.status)) && r.job.input.kind === 'outline-revise' && r.job.input.outlineId === id); }
  hasOutlineUse(id: string) { return [...this.records.values()].some(r => (this.controllers.has(r.job.id) || Date.parse(r.job.expiresAt) > Date.now() && ['queued', 'running'].includes(r.job.status)) && 'outlineId' in r.job.input && r.job.input.outlineId === id); }
  list(key?: string, compact = false) {
    if (key) { const alias = this.store.get<{ id: string }>('jobKeys', key); const record = alias && this.records.get(alias.id); return record && Date.parse(record.job.expiresAt) > Date.now() ? [this.public(record)] : []; }
    return [...this.records.values()].filter(r => Date.parse(r.job.expiresAt) > Date.now()).sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt)).slice(0, 100).map(r => {
      if (!compact || r.job.status === 'running') return this.public(r);
      const { outline, result, ...job } = r.job; const brief = outline?.brief || result?.brief || (job.input.kind === 'outline' ? job.input.brief : undefined);
      return structuredClone({ ...job, detailOmitted: true, summary: { productName: outline?.product.name || result?.product.name || '', scene: brief?.scene || '', audience: brief?.audience || '' },
        channels: job.channels.map(({ preview: _preview, ...channel }) => channel), calls: [], renderBundles: [] });
    });
  }
  get(id: string) { return this.public(this.record(id)); }
  private public(record: StoredJob) { return structuredClone(record.job); }
  private record(id: string) { const record = this.records.get(id); if (!record || Date.parse(record.job.expiresAt) <= Date.now()) throw new WorkflowError(410, '任务不存在或已超过七天留存期。'); return record; }
  findSubmission(key: string, input: JobInput) {
    const hash = digest(input); const alias = this.store.get<{ id: string; hash: string }>('jobKeys', key);
    if (alias) { if (alias.hash !== hash) throw new WorkflowError(409, '幂等键已用于不同的任务内容，请恢复原任务。'); return this.get(alias.id); }
    const same = [...this.records.values()].find(r => Date.parse(r.job.expiresAt) > Date.now() && ['queued', 'running'].includes(r.job.status) && r.inputHash === hash && r.configHash === this.configHash());
    if (same) { this.store.set('jobKeys', key, { id: same.job.id, hash }); return this.public(same); }
  }
  submit(key: string, input: JobInput, model: BackgroundJob['model'], platforms: Platform[], initial: Partial<Pick<StoredJob, 'snapshot' | 'binding' | 'checkpoints'>> = {}) {
    const existing = this.findSubmission(key, input); if (existing) return existing;
    if ([...this.records.values()].filter(r => Date.parse(r.job.expiresAt) > Date.now() && ['queued', 'running'].includes(r.job.status)).length >= 100) throw new WorkflowError(429, '队列已有一百个任务，请先处理或取消后再提交。');
    const now = new Date().toISOString(); const id = randomUUID();
    const stage = input.kind === 'generate' ? 'write' : input.kind === 'render' ? 'render' : 'outline';
    const job: BackgroundJob = { id, idempotencyKey: key, input: structuredClone(input), kind: input.kind, status: 'queued', createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + HISTORY_TTL).toISOString(), model,
      channels: platforms.map(platform => ({ platform, status: 'queued', stage })), calls: [], renderBundles: [] };
    const record: StoredJob = { job, inputHash: digest(input), configHash: this.configHash(), checkpoints: {}, pendingPaid: {}, runId: randomUUID(), ...structuredClone(initial) };
    if (record.snapshot) job.outline = structuredClone(record.snapshot);
    this.store.update(b => { (b.jobs ||= {})[id] = record; (b.jobKeys ||= {})[key] = { id, hash: record.inputHash }; });
    this.records.set(id, record); this.emit(); this.schedule(); return this.public(record);
  }
  subscribe(listener: () => void) { this.events.on('change', listener); return () => { this.events.off('change', listener); }; }
  private emit() { this.events.emit('change'); }
  private persist(record: StoredJob) { record.job.updatedAt = new Date().toISOString(); this.store.set('jobs', record.job.id, record); this.emit(); }
  cancel(id: string) {
    const r = this.record(id); if (terminal.has(r.job.status)) return this.public(r);
    r.job.status = 'cancelled'; for (const c of r.job.channels) if (c.status !== 'completed') c.status = 'cancelled';
    this.persist(r); this.controllers.get(id)?.abort(); return this.public(r);
  }
  retry(id: string) {
    const r = this.record(id);
    if (!['failed', 'interrupted'].includes(r.job.status)) throw new WorkflowError(409, '只可重试失败或中断的任务步骤。');
    if (r.job.error && !r.job.error.retryable) throw new WorkflowError(409, '此错误需要先调整版本、配置或重新取证，请按错误提示创建新任务。');
    if (r.configHash !== this.configHash()) throw new WorkflowError(409, '接入配置已变化。此任务绑定原模型与凭证，请恢复原配置或创建新任务。');
    r.job.status = 'queued'; delete r.job.error;
    for (const c of r.job.channels) if (c.status !== 'completed') { c.status = 'queued'; delete c.error; }
    this.persist(r); this.schedule(); return this.public(r);
  }
  private schedule() {
    if (this.scheduled || this.stopped) return; this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.pump(); });
  }
  private pump() {
    while (!this.stopped) {
      const record = [...this.records.values()].find(r => r.job.status === 'queued' && Date.parse(r.job.expiresAt) > Date.now() && !this.controllers.has(r.job.id)
        && (r.job.input.kind === 'render' ? this.renderActive < 2 : this.active < this.maxActive)); if (!record) break;
      const renderOnly = record.job.input.kind === 'render';
      if (renderOnly) this.renderActive++; else this.active++;
      const controller = new AbortController(); this.controllers.set(record.job.id, controller);
      record.job.status = 'running';
      try { this.persist(record); } catch { this.controllers.delete(record.job.id); if (renderOnly) this.renderActive--; else this.active--; this.stopped = true; return; }
      const ctx: JobContext = { signal: controller.signal, save: () => { controller.signal.throwIfAborted(); this.persist(record); }, acknowledge: (stage, platform) => {
        for (const [id, pending] of Object.entries(record.pendingPaid || {})) if (pending.stage === stage && pending.platform === platform) delete record.pendingPaid![id];
      }, call: call => {
        const index = record.job.calls.findIndex(c => c.id === call.id);
        if (index < 0) record.job.calls.push(structuredClone(call)); else record.job.calls[index] = structuredClone(call);
        if (call.outcome === 'dispatched') {
          record.dispatched = true; (record.pendingPaid ||= {})[call.id] = { stage: call.stage, platform: call.platform };
        } else if (call.outcome === 'failed') delete record.pendingPaid?.[call.id];
        this.persist(record);
      } };
      void (async () => {
        try {
          if (record.configHash !== this.configHash()) throw new WorkflowError(409, '任务提交后的接入配置已变化，未调用新模型；请恢复原配置或重新创建任务。');
          await this.execute(record, ctx); controller.signal.throwIfAborted();
          if (record.job.channels.some(c => c.status === 'failed' || c.status === 'interrupted')) { record.job.status = 'failed'; record.job.error = record.job.channels.find(c => c.error)?.error; }
          else record.job.status = 'completed';
        } catch (error) {
          if (record.job.status !== 'cancelled') {
            record.job.status = 'failed'; record.job.error = jobError(error, record.job.channels.find(c => c.status !== 'completed')?.stage || 'publish');
            for (const c of record.job.channels) if (c.status === 'running') { c.status = 'failed'; c.error = { ...record.job.error, platform: c.platform, stage: c.stage }; }
          }
        } finally {
          try { this.persist(record); } catch { /* dispatch/checkpoint on disk remains recoverable; never replay here */ }
          this.controllers.delete(record.job.id); if (renderOnly) this.renderActive--; else this.active--; this.schedule();
        }
      })();
    }
  }
  /** Shutdown detaches workers; production process exit leaves dispatch records for safe recovery. */
  close() { this.stopped = true; this.events.removeAllListeners(); }
}
