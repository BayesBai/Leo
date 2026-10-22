import { PLATFORMS, type RunResult, type TraceEntry } from '../../shared/types';
import { mockScenario, type MockScenario, type Transport } from './mode';

export type ApiErrorKind = 'http' | 'expired' | 'conflict' | 'busy' | 'network' | 'incomplete' | 'protocol' | 'needs_input' | 'stream';
export class ApiError extends Error {
  constructor(message: string, readonly kind: ApiErrorKind, readonly status?: number, readonly fields: { field: string; question: string }[] = []) {
    super(message); this.name = 'ApiError';
  }
}

const MAX_FRAME_CHARS = 2 * 1024 * 1024;
const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

function validTrace(value: unknown): value is TraceEntry {
  return record(value) && ['step', 'label', 'detail', 'at'].every(key => typeof value[key] === 'string')
    && ['running', 'done', 'error'].includes(String(value.status));
}
function validResult(value: unknown): value is RunResult {
  if (!record(value) || typeof value.id !== 'string' || !Number.isInteger(value.revision) || Number(value.revision) < 1
    || typeof value.createdAt !== 'string' || typeof value.notice !== 'string'
    || !record(value.brief) || !record(value.product) || !record(value.evidence) || !record(value.review)
    || !Array.isArray(value.drafts) || !value.drafts.length || !Array.isArray(value.strategies) || !Array.isArray(value.trace)) return false;
  const { brief, product, evidence, review } = value;
  if (!Array.isArray(brief.platforms) || !brief.platforms.length || brief.platforms.length > 4
    || brief.platforms.some(p => !PLATFORMS.includes(p as typeof PLATFORMS[number]))
    || new Set(brief.platforms).size !== brief.platforms.length) return false;
  return ['scene', 'audience', 'goal', 'mode', 'knowledgeSource'].every(key => typeof brief[key] === 'string')
    && typeof product.name === 'string' && record(value.outline)
    && Array.isArray(evidence.facts) && evidence.facts.every(f => record(f) && typeof f.id === 'string' && typeof f.statement === 'string' && strings(f.qualifiers))
    && Array.isArray(evidence.images) && evidence.images.every(i => record(i) && typeof i.id === 'string' && typeof i.url === 'string')
    && Array.isArray(evidence.sources) && evidence.sources.every(s => record(s) && typeof s.id === 'string' && typeof s.title === 'string')
    && ['passed', 'needs_attention', 'blocked'].includes(String(review.status)) && Array.isArray(review.issues) && Array.isArray(review.checks)
    && value.drafts.length === brief.platforms.length
    && new Set(value.drafts.map(d => record(d) ? d.platform : undefined)).size === brief.platforms.length
    && value.drafts.every(d => record(d) && typeof d.id === 'string' && (brief.platforms as unknown[]).includes(d.platform)
      && strings(d.titles) && d.titles.length > 0 && typeof d.intro === 'string' && typeof d.cta === 'string' && strings(d.tags)
      && Array.isArray(d.blocks) && d.blocks.every(b => record(b) && typeof b.id === 'string' && typeof b.heading === 'string' && typeof b.text === 'string' && strings(b.factIds))
      && Array.isArray(d.images) && d.images.every(i => record(i) && typeof i.imageId === 'string' && Number.isInteger(i.afterBlock)));
}
const inputFields = (value: unknown): { field: string; question: string }[] => Array.isArray(value)
  ? value.filter((field): field is { field: string; question: string } => record(field) && typeof field.field === 'string' && typeof field.question === 'string') : [];

async function httpError(response: Response) {
  const detail: unknown = await response.json().catch(() => undefined);
  const needsInput = record(detail) && detail.type === 'needs_input';
  const kind: ApiErrorKind = needsInput ? 'needs_input' : response.status === 410 ? 'expired' : response.status === 409 ? 'conflict' : response.status === 429 ? 'busy' : 'http';
  return new ApiError(record(detail) && typeof detail.message === 'string' ? detail.message : `请求失败（${response.status}）`, kind, response.status, record(detail) ? inputFields(detail.fields) : []);
}

/** One transport and SSE decoder serve the complete outline workflow, in real and mock modes. */
export function createWorkflowClient(transport: Transport) {
  async function request(url: string, init: RequestInit = {}) {
    init.signal?.throwIfAborted();
    try { return await transport(url, init); }
    catch (error) {
      init.signal?.throwIfAborted();
      if (error instanceof ApiError) throw error;
      throw new ApiError('网络连接异常，请检查服务后重试。', 'network');
    }
  }
  async function api<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await request(url, { method, signal, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw await httpError(response);
    signal?.throwIfAborted();
    try { return await response.json() as T; }
    catch { signal?.throwIfAborted(); throw new ApiError('服务器返回了无效的 JSON，请检查服务后重试。', 'protocol'); }
  }
  async function generateFromOutline(outlineId: string, version: number, signal: AbortSignal, progress: (entry: TraceEntry) => void): Promise<RunResult> {
    const response = await request('/api/generate-from-outline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outlineId, version }), signal });
    if (!response.ok) throw await httpError(response);
    if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') throw new ApiError('服务器未返回正文事件流，请检查连接后重试。', 'protocol');
    if (!response.body) throw new ApiError('正文流为空。', 'incomplete');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let receivedBytes = 0;
    const onAbort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', onAbort, { once: true });
    const frame = (raw: string): RunResult | undefined => {
      if (raw.length > MAX_FRAME_CHARS) throw new ApiError('正文事件超过接收上限，请精简任务后重试。', 'protocol');
      const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data) return;
      let event: unknown;
      try { event = JSON.parse(data); } catch { throw new ApiError('正文事件格式无效，请重试。', 'protocol'); }
      if (!record(event)) throw new ApiError('正文事件格式无效，请重试。', 'protocol');
      if (event.type === 'progress') {
        if (!validTrace(event.entry)) throw new ApiError('生成进度格式无效，请重试。', 'protocol');
        progress(event.entry);
      }
      if (event.type === 'result') {
        if (!validResult(event.result)) throw new ApiError('正文结果不完整，请重试。', 'protocol');
        if (event.result.outline?.id !== outlineId || event.result.outline.version !== version) throw new ApiError('正文与确认的大纲版本不一致，请重新生成。', 'conflict', 409);
        return event.result;
      }
      if (event.type === 'error' || event.type === 'needs_input') throw new ApiError(typeof event.message === 'string' && event.message ? event.message : '请补充任务信息。', event.type === 'needs_input' ? 'needs_input' : 'stream', undefined, inputFields(event.fields));
    };
    try {
      while (true) {
        signal.throwIfAborted();
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); }
        catch { signal.throwIfAborted(); throw new ApiError('正文连接中断，未收到完整正文，请重试。', 'incomplete'); }
        signal.throwIfAborted();
        const { value, done } = chunk;
        receivedBytes += value?.byteLength || 0;
        if (receivedBytes > MAX_STREAM_BYTES) throw new ApiError('正文流超过接收上限，请精简任务后重试。', 'protocol');
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        let split: RegExpExecArray | null;
        while ((split = /\r?\n\r?\n/.exec(buffer))) {
          const result = frame(buffer.slice(0, split.index)); buffer = buffer.slice(split.index + split[0].length);
          signal.throwIfAborted(); if (result) return result;
        }
        if (buffer.length > MAX_FRAME_CHARS) throw new ApiError('正文事件超过接收上限，请精简任务后重试。', 'protocol');
        if (done) { if (buffer.trim()) { const result = frame(buffer); signal.throwIfAborted(); if (result) return result; } break; }
      }
      throw new ApiError('连接已结束，但未收到完整正文，请重试。', 'incomplete');
    } finally { signal.removeEventListener('abort', onAbort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  return { api, generateFromOutline, apiFetch: request };
}

const mocks = new Map<MockScenario, Promise<Transport>>();
export const mockLabel = mockScenario();
const client = createWorkflowClient(async (url, init) => {
  const scenario = mockScenario();
  if (!scenario) return globalThis.fetch(url, init);
  let pending = mocks.get(scenario);
  if (!pending) { pending = import('./mock').then(module => module.createMockTransport(scenario)); mocks.set(scenario, pending); }
  const transport = await pending;
  return transport(url, init);
});
export const api = client.api;
export const generateFromOutline = client.generateFromOutline;
export const apiFetch = client.apiFetch;
