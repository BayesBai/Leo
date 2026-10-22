import type { AppStatus, Brief, Platform, Product, RunResult, StreamEvent, TraceEntry } from '../../shared/types';

/** 生成或修改的终态。HTTP 200 只代表流已建立，业务结果以终态事件为准。 */
export type RunOutcome =
  | { type: 'result'; result: RunResult }
  | { type: 'needs_input'; message: string; fields: { field: string; question: string }[] }
  | { type: 'error'; message: string };

export interface RunHandlers { onProgress?: (entry: TraceEntry) => void }

export type ApiErrorKind = 'http' | 'expired' | 'busy' | 'network' | 'incomplete';

/** 请求失败。message 可直接展示；分支判断使用 status / kind，不依据中文文本。 */
export class ApiError extends Error {
  constructor(message: string, readonly kind: ApiErrorKind, readonly status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Api {
  /** 模拟模式下为 true，界面据此提示并隔离本地存储。 */
  readonly mock: boolean;
  getStatus(signal?: AbortSignal): Promise<AppStatus>;
  getProducts(signal?: AbortSignal): Promise<Product[]>;
  getSample(signal?: AbortSignal): Promise<RunResult>;
  verifyIma(signal?: AbortSignal): Promise<AppStatus>;
  generate(brief: Brief, handlers: RunHandlers, signal?: AbortSignal): Promise<RunOutcome>;
  revise(input: { runId: string; instructions: string; platforms?: Platform[] }, handlers: RunHandlers, signal?: AbortSignal): Promise<RunOutcome>;
}

async function readError(response: Response, fallback: string): Promise<{ message: string; body: unknown }> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    const message = typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : '';
    return { message: message || fallback, body };
  } catch { return { message: fallback, body: undefined }; }
}

function toApiError(response: Response, message: string): ApiError {
  const kind: ApiErrorKind = response.status === 410 ? 'expired' : response.status === 429 ? 'busy' : 'http';
  return new ApiError(message, kind, response.status);
}

async function getJson<T>(path: string, fallback: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, signal }); }
  catch (reason) {
    if (signal?.aborted) throw reason;
    throw new ApiError('网络连接异常，请检查服务后重试。', 'network');
  }
  if (!response.ok) throw toApiError(response, (await readError(response, `${fallback}（${response.status}）`)).message);
  return response.json() as Promise<T>;
}

/**
 * 读取 POST + fetch 的 SSE 流。只有 `data:` 行有意义，`: heartbeat` 等注释行被忽略；
 * 兼容 UTF-8 跨块、一块多事件、一事件跨块，以及 \n\n 与 \r\n\r\n 分隔。
 */
export async function readEventStream(body: ReadableStream<Uint8Array>, onEvent: (event: StreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let terminal = false;
  const frame = (text: string) => {
    const payload = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload || payload === '[DONE]') return;
    const event = JSON.parse(payload) as StreamEvent;
    if (event.type === 'result' || event.type === 'needs_input' || event.type === 'error') terminal = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        frame(pending.slice(0, match.index));
        pending = pending.slice(match.index + match[0].length);
      }
      if (done) break;
    }
    if (pending.trim()) frame(pending);
  } finally { reader.releaseLock(); }
  if (!terminal) throw new ApiError('连接未完成，没有收到完整结果。已有成稿已保留，请重试。', 'incomplete');
}

async function streamRun(path: string, payload: unknown, handlers: RunHandlers, signal?: AbortSignal): Promise<RunOutcome> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal });
  } catch (reason) {
    if (signal?.aborted) throw reason;
    throw new ApiError('网络连接异常，请检查服务后重试。', 'network');
  }
  if (!response.ok) {
    const { message, body } = await readError(response, `请求失败（${response.status}）`);
    if (response.status === 422 && body && typeof body === 'object' && (body as StreamEvent).type === 'needs_input') {
      const event = body as StreamEvent;
      return { type: 'needs_input', message: event.message || message, fields: event.fields || [] };
    }
    throw toApiError(response, message);
  }
  if (!response.body) throw new ApiError('浏览器未能读取流式响应，请刷新后重试。', 'incomplete');
  let outcome: RunOutcome | undefined;
  await readEventStream(response.body, event => {
    if (event.type === 'progress' && event.entry) handlers.onProgress?.(event.entry);
    else if (event.type === 'result' && event.result) outcome = { type: 'result', result: event.result };
    else if (event.type === 'needs_input') outcome = { type: 'needs_input', message: event.message || '请补充任务信息。', fields: event.fields || [] };
    else if (event.type === 'error') outcome = { type: 'error', message: event.message || '本次任务未完成，请稍后重试。' };
  });
  if (!outcome) throw new ApiError('连接未完成，没有收到完整结果。已有成稿已保留，请重试。', 'incomplete');
  return outcome;
}

export const realApi: Api = {
  mock: false,
  getStatus: signal => getJson<AppStatus>('/api/status', '连接状态暂时不可用', signal),
  getProducts: async signal => (await getJson<{ products: Product[] }>('/api/products', '产品列表载入失败', signal)).products,
  getSample: signal => getJson<RunResult>('/api/sample', '演示内容载入失败', signal),
  verifyIma: signal => getJson<AppStatus>('/api/connections/verify', '连接验证失败', signal, { method: 'POST' }),
  generate: (brief, handlers, signal) => streamRun('/api/generate', brief, handlers, signal),
  revise: (input, handlers, signal) => streamRun('/api/revise', input, handlers, signal),
};
