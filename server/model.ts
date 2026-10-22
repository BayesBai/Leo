import { z } from 'zod';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ModelCallRecord, Platform } from '../shared/types.js';
import { FairLimiter } from './fair-limiter.js';

export class ModelError extends Error {
  constructor(message: string, public code = 'MODEL_ERROR', public upstreamStatus?: number, public outcomeUnknown = false, public retryable = true) { super(message); this.name = 'ModelError'; }
}

export const DEFAULT_MODEL_BASE_URL = 'https://relay.nccnxta.cn/v1';
export const DEFAULT_MODEL_NAME = 'gpt-6.1-sol';
const RESPONSE_LIMIT = 2_000_000;

export function hasRealSecret(value: string | undefined): boolean {
  return !!value?.trim() && !/^(\*+|<.*>|(?:sk-)?your(?:[-_ ].*)?|sk-x{3,}|填.*|sk-你的.*)$/i.test(value.trim());
}

/** A base is an API root, never a complete endpoint. Preserve proxy prefixes. */
export function normalizeModelBaseUrl(raw: string): string {
  try {
    const parsed = new URL(raw.trim());
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !localHttp) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('Invalid base URL');
    }
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (/\/(?:chat\/completions|messages|responses)$/i.test(pathname)) throw new Error('An endpoint is not an API base');
    return `${parsed.origin}${pathname.endsWith('/v1') ? pathname : `${pathname}/v1`}`;
  } catch { throw new ModelError('LLM_BASE_URL 必须是 HTTPS API 根地址（根域名或 /v1），不能包含凭证、查询参数或完整接口路径；本机测试允许 HTTP。', 'MODEL_CONFIG'); }
}

export interface ModelConfigSnapshot {
  configured: boolean; baseUrl: string; name: string; timeoutMs: number;
  /** Never persist or expose this object; jobs persist a hash, not this credential. */
  apiKey?: string;
}
interface ModelExecution {
  jobId?: string; stage?: string | (() => string); platform?: Platform;
  onCall?: (call: ModelCallRecord) => void; config?: ModelConfigSnapshot;
  beforeDispatch?: () => void;
}
const execution = new AsyncLocalStorage<ModelExecution>();
const modelSlots = new FairLimiter(4);
export function withModelExecution<T>(context: ModelExecution, operation: () => T): T {
  const parent = execution.getStore();
  const beforeDispatch = parent?.beforeDispatch && context.beforeDispatch
    ? () => { parent.beforeDispatch!(); context.beforeDispatch!(); }
    : context.beforeDispatch || parent?.beforeDispatch;
  return execution.run({ ...parent, ...context, beforeDispatch }, operation);
}
export function snapshotModelConfig(): ModelConfigSnapshot {
  const current = execution.getStore()?.config;
  if (current) return { ...current };
  return {
    configured: hasRealSecret(process.env.LLM_API_KEY),
    baseUrl: normalizeModelBaseUrl(process.env.LLM_BASE_URL || DEFAULT_MODEL_BASE_URL),
    name: process.env.LLM_MODEL?.trim() || DEFAULT_MODEL_NAME,
    timeoutMs: Math.floor(Math.max(5_000, Math.min(Number(process.env.LLM_TIMEOUT_MS) || 180_000, 300_000))),
    apiKey: process.env.LLM_API_KEY?.trim(),
  };
}
export function modelConfig() {
  const { configured, baseUrl, name, timeoutMs } = snapshotModelConfig();
  return { configured, baseUrl, name, timeoutMs };
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  try { return JSON.parse(trimmed); }
  catch { throw new ModelError('模型未返回完整 JSON，已停止使用该输出。', 'MODEL_JSON'); }
}

function redact(message: string, requestKey?: string): string {
  for (const key of [requestKey, process.env.LLM_API_KEY]) {
    if (key) message = message.split(key).join('[redacted]');
  }
  return message.replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[redacted]').slice(0, 250);
}

/** Enforce the response limit while reading, rather than after buffering a whole body. */
async function readBoundedBody(response: Response, observer?: StreamObserver): Promise<string> {
  if (!response.body) throw new ModelError('模型响应为空。', 'MODEL_EMPTY');
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value?.byteLength) observer?.onChunk?.();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > RESPONSE_LIMIT) throw new ModelError('模型响应超过限制。', 'MODEL_RESPONSE_SIZE');
      text += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recognize this gateway's explicit capacity error without exposing its raw body. */
async function exhaustedModelAccounts(response: Response): Promise<boolean> {
  if (response.status !== 503 || !response.body) return false;
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let text = '', bytes = 0;
  const matches = (payload: string) => {
    try {
      const data: unknown = JSON.parse(payload);
      return record(data) && record(data.error) && typeof data.error.message === 'string'
        && /^All available accounts exhausted[.!]?$/i.test(data.error.message.trim());
    } catch { return false; }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      bytes += value?.byteLength || 0;
      if (bytes > 16_384) return false;
      text += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (matches(text) || text.split(/\r?\n/).some(line => line.startsWith('data:') && matches(line.slice(5).trim()))) return true;
      if (done) return false;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function choiceFrom(data: unknown): Record<string, unknown> | undefined {
  if (!record(data)) throw new ModelError('中转站响应不是有效的 Chat Completions 对象。', 'MODEL_PROTOCOL');
  if (data.error) throw new ModelError('模型服务返回业务错误，请稍后重试。', 'MODEL_PROVIDER');
  if (!Array.isArray(data.choices)) throw new ModelError('中转站响应缺少 Chat Completions choices 字段。', 'MODEL_PROTOCOL');
  // A final usage chunk can have no choices. Other choices must never enter choice zero.
  return data.choices.find((choice: unknown) => record(choice) && choice.index === 0)
    ?? data.choices.find((choice: unknown) => record(choice) && choice.index === undefined);
}

function checkTextMessage(message: Record<string, unknown>): string {
  if ((Array.isArray(message.tool_calls) && message.tool_calls.length > 0) || message.function_call) {
    throw new ModelError('模型返回了工具调用，当前创作流程仅接受正文。', 'MODEL_PROTOCOL');
  }
  if (message.refusal) throw new ModelError('模型拒绝了本次生成，请调整任务要求。', 'MODEL_REFUSAL');
  if (message.content == null) return '';
  if (typeof message.content !== 'string') throw new ModelError('模型正文不是有效文本。', 'MODEL_PROTOCOL');
  return message.content;
}

function checkFinishReason(reason: unknown): boolean {
  if (reason == null) return false;
  if (reason === 'length') throw new ModelError('模型输出达到长度上限，请减少平台数量或缩短任务后重试。', 'MODEL_TRUNCATED');
  if (reason === 'content_filter') throw new ModelError('模型输出被服务方内容过滤，请调整任务要求。', 'MODEL_REFUSAL');
  if (reason !== 'stop') throw new ModelError('模型未以正常正文结束本次生成。', 'MODEL_PROTOCOL');
  return true;
}

interface StreamObserver { onChunk?: () => void; onContent?: () => void; onUsage?: (value: unknown) => void }
/** Only final-answer text enters JSON validation; reasoning and tool data never do. */
export async function readChatCompletionStream(response: Response, onActivity?: (characters: number) => void, observer?: StreamObserver): Promise<string> {
  if (!response.body) throw new ModelError('模型流式响应为空。', 'MODEL_EMPTY');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '', text = '', complete = false, doneMarker = false, lastActivity = 0, bytes = 0, tailDeadline = 0;
  function frame(raw: string) {
    const payload = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload) return;
    if (payload === '[DONE]') { doneMarker = true; return; }
    if (doneMarker) throw new ModelError('模型结束事件后仍返回内容。', 'MODEL_PROTOCOL');
    let data: unknown;
    try { data = JSON.parse(payload); }
    catch { throw new ModelError('模型流式事件不是有效 JSON。', 'MODEL_PROTOCOL'); }
    if (record(data) && data.usage) observer?.onUsage?.(data.usage);
    const choice = choiceFrom(data);
    if (!choice) return;
    if (choice.delta !== undefined && !record(choice.delta)) throw new ModelError('模型流式正文格式无效。', 'MODEL_PROTOCOL');
    const content = checkTextMessage(record(choice.delta) ? choice.delta : {});
    if (complete && content) throw new ModelError('模型正常结束后仍返回正文。', 'MODEL_PROTOCOL');
    if (content) observer?.onContent?.();
    text += content;
    const stopped = checkFinishReason(choice.finish_reason);
    if (stopped && !complete) tailDeadline = Date.now() + 100;
    complete = stopped || complete;
    if (text.length && (complete || Date.now() - lastActivity > 1500)) { lastActivity = Date.now(); onActivity?.(text.length); }
    if (text.length > RESPONSE_LIMIT || pending.length > RESPONSE_LIMIT) throw new ModelError('模型响应超过限制。', 'MODEL_RESPONSE_SIZE');
  }
  try {
    while (!doneMarker) {
      let tailTimer: ReturnType<typeof setTimeout> | undefined;
      let next: ReadableStreamReadResult<Uint8Array> | undefined;
      try {
        // Some compatible gateways keep the transport open after stop. Give usage its own
        // fragmented frame, but never turn an already completed answer into a 180s wait.
        next = complete ? await Promise.race([reader.read(), new Promise<undefined>(resolve => {
          tailTimer = setTimeout(() => resolve(undefined), Math.max(0, tailDeadline - Date.now()));
        })]) : await reader.read();
      } catch (error) {
        if (!complete) throw error;
        // A normal stop already made the answer complete; missing trailing usage is unknown.
        break;
      } finally { clearTimeout(tailTimer); }
      if (!next) break;
      const { value, done } = next;
      if (value?.byteLength) observer?.onChunk?.();
      bytes += value?.byteLength || 0;
      if (bytes > RESPONSE_LIMIT) throw new ModelError('模型响应超过限制。', 'MODEL_RESPONSE_SIZE');
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (pending.length > RESPONSE_LIMIT) throw new ModelError('模型响应超过限制。', 'MODEL_RESPONSE_SIZE');
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        frame(pending.slice(0, match.index)); pending = pending.slice(match.index + match[0].length);
      }
      if (done) { if (pending.trim()) frame(pending); break; }
    }
    if (!complete) throw new ModelError('模型流式响应中断，未接收到完成事件。', 'MODEL_STREAM_INCOMPLETE');
    if (!text.trim()) throw new ModelError('模型未返回可用的正文。', 'MODEL_EMPTY');
    return text;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function retryDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

interface AttemptBudget { used: number; max: number }
interface ModelOptions {
  signal?: AbortSignal; maxTokens?: number; fetcher?: typeof fetch; onActivity?: (characters: number) => void;
  /** Shared by transport throttling and JSON correction, never renewed inside one node. */
  budget?: AttemptBudget;
}
function tokenUsage(value: unknown): ModelCallRecord['usage'] {
  if (!record(value)) return;
  const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
  const usage = { promptTokens: integer(value.prompt_tokens), completionTokens: integer(value.completion_tokens), totalTokens: integer(value.total_tokens) };
  return Object.values(usage).some(v => v !== undefined) ? usage : undefined;
}
export async function callModel(system: string, user: string, options: ModelOptions = {}): Promise<string> {
  const config = snapshotModelConfig(), apiKey = config.apiKey;
  if (!config.configured) throw new ModelError('尚未配置模型密钥。请在项目 .env.local 中填写 LLM_API_KEY，重启服务后使用模型创作。', 'MODEL_NOT_CONFIGURED', undefined, false, false);
  const fetcher = options.fetcher || fetch, context = execution.getStore();
  const budget = options.budget || { used: 0, max: 2 };
  while (budget.used < budget.max) {
    if (options.signal?.aborted) throw new ModelError('任务已取消。', 'CANCELLED');
    const queued = Date.now();
    let release: () => void;
    try { release = await modelSlots.acquire(context?.jobId || 'legacy', options.signal); }
    catch { throw new ModelError('任务已取消。', 'CANCELLED'); }
    // Inputs can expire or be edited while waiting behind other jobs. Revalidate after
    // the slot is ours, before even recording an attempt or contacting the provider.
    try {
      if (options.signal?.aborted) throw new ModelError('任务已取消。', 'CANCELLED');
      context?.beforeDispatch?.();
    } catch (error) { release(); throw error; }
    const start = Date.now();
    const call: ModelCallRecord = { id: randomUUID(), stage: (typeof context?.stage === 'function' ? context.stage() : context?.stage) || 'model', platform: context?.platform,
      attempt: ++budget.used, queuedAt: new Date(queued).toISOString(), startedAt: new Date(start).toISOString(), queueMs: start - queued, outcome: 'dispatched' };
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    let lastChunk = start, idle = 0, dispatched = false, retry = false, retryMs = 0;
    const emit = () => context?.onCall?.(structuredClone(call));
    const observe: StreamObserver = {
      onChunk: () => { const now = Date.now(); idle = Math.max(idle, now - lastChunk); lastChunk = now; },
      onContent: () => { call.firstContentMs ??= Date.now() - start; },
      onUsage: value => { call.usage = tokenUsage(value); },
    };
    try {
      // Commit the dispatched ledger before contacting a paid service. A failed commit prevents dispatch.
      emit(); signal.throwIfAborted(); dispatched = true;
      const response = await fetcher(`${config.baseUrl}/chat/completions`, {
        method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey!}` },
        body: JSON.stringify({ model: config.name, max_tokens: options.maxTokens ?? 6000, stream: true,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }), signal,
      });
      call.firstResponseMs = Date.now() - start; call.upstreamStatus = response.status;
      const requestId = response.headers.get('x-request-id') || response.headers.get('request-id') || response.headers.get('cf-ray');
      if (requestId) {
        const safe = redact(requestId, apiKey);
        if (/^[a-zA-Z0-9_.:-]{1,120}$/.test(safe) && !safe.includes('redacted')) call.requestId = safe;
      }
      if (await exhaustedModelAccounts(response)) throw new ModelError('模型接口返回 HTTP 503：服务商报告当前模型的可用账号池已耗尽，请联系网关服务商恢复该模型线路。', 'MODEL_CAPACITY', 503, false, true);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const hint = response.status === 401 || response.status === 403 ? '请检查密钥和该模型的调用权限。'
          : response.status === 429 ? '服务限流，请稍后重试。'
          : [504, 524].includes(response.status) ? '上游处理超时，结果不确定；主动重试可能再次产生消耗。' : '请检查模型服务状态与协议配置。';
        retry = response.status === 429 && budget.used < budget.max;
        retryMs = Math.min(3000, Math.max(500, Number(response.headers.get('retry-after')) * 1000 || 1000));
        throw new ModelError(`模型接口返回 HTTP ${response.status}。${hint}`, 'MODEL_HTTP', response.status, response.status >= 500, ![401, 403].includes(response.status));
      }
      let text: string;
      if (response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
        text = await readChatCompletionStream(response, options.onActivity, observe);
      } else {
        const body = await readBoundedBody(response, observe);
        let data: unknown;
        try { data = JSON.parse(body); } catch { throw new ModelError('中转站返回了非 JSON 响应，请确认 Chat Completions 协议可用。', 'MODEL_PROTOCOL'); }
        if (record(data) && data.usage) observe.onUsage?.(data.usage);
        const choice = choiceFrom(data);
        if (!choice || !record(choice.message)) throw new ModelError('中转站响应缺少 Chat Completions message 字段。', 'MODEL_PROTOCOL');
        text = checkTextMessage(choice.message);
        if (text) observe.onContent?.();
        if (!checkFinishReason(choice.finish_reason)) throw new ModelError('模型响应缺少正常完成标记。', 'MODEL_STREAM_INCOMPLETE');
        if (!text.trim()) throw new ModelError('模型未返回可用的正文。', 'MODEL_EMPTY');
        options.onActivity?.(text.length);
      }
      signal.throwIfAborted(); call.outcome = 'succeeded';
      return text;
    } catch (error) {
      let failure: unknown = error;
      if (options.signal?.aborted) failure = new ModelError('任务已取消。已派发请求的服务方结果可能尚未确定。', 'CANCELLED', call.upstreamStatus, dispatched, true);
      else if (timeout.aborted) failure = new ModelError(`模型调用超时（${Math.round(config.timeoutMs / 1000)} 秒），结果不确定；主动重试可能再次产生消耗。`, 'MODEL_TIMEOUT', call.upstreamStatus, true, true);
      else if (error instanceof ModelError) {
        if (error.code === 'MODEL_STREAM_INCOMPLETE') error.outcomeUnknown = true;
        error.upstreamStatus ??= call.upstreamStatus;
      } else if (dispatched) failure = new ModelError(`模型连接失败：${redact(error instanceof Error ? error.message : '网络异常', apiKey)}；结果不确定，主动重试可能再次产生消耗。`, 'MODEL_NETWORK', call.upstreamStatus, true, true);
      call.outcome = failure instanceof ModelError && failure.outcomeUnknown ? 'unknown' : 'failed';
      call.code = failure instanceof ModelError ? failure.code : 'STATE_ERROR';
      if (!retry || options.signal?.aborted || timeout.aborted) throw failure;
    } finally {
      call.endedAt = new Date().toISOString(); call.totalMs = Date.now() - start;
      call.maxIdleMs = Math.max(idle, Date.now() - lastChunk);
      try { emit(); } finally { release(); }
    }
    // Retry only explicit throttling, after releasing the scarce HTTP slot.
    try { await retryDelay(retryMs, options.signal || new AbortController().signal); }
    catch { throw new ModelError('任务已取消。', 'CANCELLED'); }
  }
  throw new ModelError('本步骤已达到两次模型请求上限，请检查输出后主动重试。', 'MODEL_ATTEMPT_LIMIT');
}

export async function completeJson<TSchema extends z.ZodTypeAny>(system: string, user: string, schema: TSchema, signal?: AbortSignal, maxTokens?: number, onActivity?: (characters: number) => void): Promise<z.output<TSchema>> {
  let validation = '';
  const budget = { used: 0, max: 2 };
  while (budget.used < budget.max) {
    const text = await callModel(
      `${system}\n只输出一个完整 JSON 对象，不输出 Markdown 围栏、思考过程或解释。`,
      validation ? `${user}\n\n上一次输出格式不符合要求：${validation}。请重新生成完整 JSON。` : user,
      { signal, maxTokens, onActivity, budget },
    );
    try { return schema.parse(parseModelJson(text)); }
    catch (error) {
      validation = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0, 1200) : 'JSON 解析失败';
      if (budget.used >= budget.max) throw new ModelError(`模型输出结构校验失败：${validation}`, 'MODEL_SCHEMA');
    }
  }
  throw new ModelError('模型输出校验失败。', 'MODEL_SCHEMA');
}
