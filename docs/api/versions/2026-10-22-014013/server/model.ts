import { z } from 'zod';

export class ModelError extends Error {
  constructor(message: string, public code = 'MODEL_ERROR') { super(message); this.name = 'ModelError'; }
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

export function modelConfig() {
  const baseUrl = normalizeModelBaseUrl(process.env.LLM_BASE_URL || DEFAULT_MODEL_BASE_URL);
  return {
    configured: hasRealSecret(process.env.LLM_API_KEY),
    baseUrl,
    name: process.env.LLM_MODEL?.trim() || DEFAULT_MODEL_NAME,
    timeoutMs: Math.floor(Math.max(5_000, Math.min(Number(process.env.LLM_TIMEOUT_MS) || 180_000, 300_000))),
  };
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
async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body) throw new ModelError('模型响应为空。', 'MODEL_EMPTY');
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
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

/** Only final-answer text enters JSON validation; reasoning and tool data never do. */
export async function readChatCompletionStream(response: Response, onActivity?: (characters: number) => void): Promise<string> {
  if (!response.body) throw new ModelError('模型流式响应为空。', 'MODEL_EMPTY');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '', text = '', complete = false, doneMarker = false, lastActivity = 0, bytes = 0;
  function frame(raw: string) {
    const payload = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload) return;
    if (payload === '[DONE]') { doneMarker = true; return; }
    if (doneMarker) throw new ModelError('模型结束事件后仍返回内容。', 'MODEL_PROTOCOL');
    let data: unknown;
    try { data = JSON.parse(payload); }
    catch { throw new ModelError('模型流式事件不是有效 JSON。', 'MODEL_PROTOCOL'); }
    const choice = choiceFrom(data);
    if (!choice) return;
    if (choice.delta !== undefined && !record(choice.delta)) throw new ModelError('模型流式正文格式无效。', 'MODEL_PROTOCOL');
    const content = checkTextMessage(record(choice.delta) ? choice.delta : {});
    if (complete && content) throw new ModelError('模型正常结束后仍返回正文。', 'MODEL_PROTOCOL');
    text += content;
    complete = checkFinishReason(choice.finish_reason) || complete;
    if (text.length && (complete || Date.now() - lastActivity > 1500)) { lastActivity = Date.now(); onActivity?.(text.length); }
    if (text.length > RESPONSE_LIMIT || pending.length > RESPONSE_LIMIT) throw new ModelError('模型响应超过限制。', 'MODEL_RESPONSE_SIZE');
  }
  try {
    while (!doneMarker && !complete) {
      const { value, done } = await reader.read();
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

export async function callModel(
  system: string, user: string,
  options: { signal?: AbortSignal; maxTokens?: number; fetcher?: typeof fetch; onActivity?: (characters: number) => void } = {},
): Promise<string> {
  const config = modelConfig();
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!config.configured) throw new ModelError('尚未配置模型密钥。请在项目 .env.local 中填写 LLM_API_KEY，重启服务后使用模型创作。', 'MODEL_NOT_CONFIGURED');
  const fetcher = options.fetcher || fetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (options.signal?.aborted) throw new ModelError('任务已取消。', 'CANCELLED');
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    try {
      const response = await fetcher(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey!}`,
        },
        body: JSON.stringify({
          model: config.name, max_tokens: options.maxTokens ?? 6000,
          stream: true,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
        signal,
      });
      if (await exhaustedModelAccounts(response)) {
        throw new ModelError('模型接口返回 HTTP 503：服务商报告当前模型的可用账号池已耗尽，请联系网关服务商恢复该模型线路。', 'MODEL_CAPACITY');
      }
      if ([429, 502, 503, 504].includes(response.status) && attempt === 0) {
        await response.body?.cancel().catch(() => {});
        const wait = Math.min(3000, Math.max(500, Number(response.headers.get('retry-after')) * 1000 || 1000));
        await retryDelay(wait, signal);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const hint = response.status === 401 || response.status === 403 ? '请检查密钥和该模型的调用权限。'
          : response.status === 429 ? '服务限流，请稍后重试。' : '请检查模型服务状态与协议配置。';
        throw new ModelError(`模型接口返回 HTTP ${response.status}。${hint}`, 'MODEL_HTTP');
      }
      if (response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
        const text = await readChatCompletionStream(response, options.onActivity);
        signal.throwIfAborted();
        return text;
      }
      const body = await readBoundedBody(response);
      signal.throwIfAborted();
      let data: unknown;
      try { data = JSON.parse(body); }
      catch { throw new ModelError('中转站返回了非 JSON 响应，请确认 Chat Completions 协议可用。', 'MODEL_PROTOCOL'); }
      const choice = choiceFrom(data);
      if (!choice || !record(choice.message)) throw new ModelError('中转站响应缺少 Chat Completions message 字段。', 'MODEL_PROTOCOL');
      const text = checkTextMessage(choice.message);
      if (!checkFinishReason(choice.finish_reason)) throw new ModelError('模型响应缺少正常完成标记。', 'MODEL_STREAM_INCOMPLETE');
      if (!text.trim()) throw new ModelError('模型未返回可用的正文。', 'MODEL_EMPTY');
      options.onActivity?.(text.length);
      return text;
    } catch (error) {
      if (options.signal?.aborted) throw new ModelError('任务已取消。', 'CANCELLED');
      if (timeout.aborted) throw new ModelError(`模型调用超时（${Math.round(config.timeoutMs / 1000)} 秒），可调整 LLM_TIMEOUT_MS 后重试。`, 'MODEL_TIMEOUT');
      if (error instanceof ModelError) throw error;
      throw new ModelError(`模型连接失败：${redact(error instanceof Error ? error.message : '网络异常', apiKey)}`, 'MODEL_NETWORK');
    }
  }
  throw new ModelError('模型暂不可用，请稍后重试。');
}

export async function completeJson<TSchema extends z.ZodTypeAny>(system: string, user: string, schema: TSchema, signal?: AbortSignal, maxTokens?: number, onActivity?: (characters: number) => void): Promise<z.output<TSchema>> {
  let validation = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callModel(
      `${system}\n只输出一个完整 JSON 对象，不输出 Markdown 围栏、思考过程或解释。`,
      validation ? `${user}\n\n上一次输出格式不符合要求：${validation}。请重新生成完整 JSON。` : user,
      { signal, maxTokens, onActivity },
    );
    try { return schema.parse(parseModelJson(text)); }
    catch (error) {
      validation = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0, 1200) : 'JSON 解析失败';
      if (attempt === 1) throw new ModelError(`模型输出结构校验失败：${validation}`, 'MODEL_SCHEMA');
    }
  }
  throw new ModelError('模型输出校验失败。', 'MODEL_SCHEMA');
}
