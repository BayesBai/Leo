import { z } from 'zod';

export class ModelError extends Error {
  constructor(message: string, public code = 'MODEL_ERROR') { super(message); this.name = 'ModelError'; }
}

export function hasRealSecret(value: string | undefined): boolean {
  return !!value?.trim() && !/^(\*+|<.*>|your[-_ ].*|填.*|sk-你的.*)$/i.test(value.trim());
}

export function modelConfig() {
  const raw = process.env.LLM_BASE_URL || 'https://api.openai-next.com';
  let baseUrl = 'https://api.openai-next.com';
  try {
    const parsed = new URL(raw);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('Invalid base URL');
    }
    baseUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}`;
  } catch { throw new ModelError('LLM_BASE_URL 必须是有效的 HTTP(S) 服务地址，不能包含凭证或查询参数。', 'MODEL_CONFIG'); }
  return {
    configured: hasRealSecret(process.env.LLM_API_KEY),
    baseUrl,
    name: process.env.LLM_MODEL || 'claude-opus-5',
    timeoutMs: Math.max(5_000, Math.min(Number(process.env.LLM_TIMEOUT_MS) || 180_000, 300_000)),
  };
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  try { return JSON.parse(trimmed); }
  catch { throw new ModelError('模型未返回完整 JSON，已停止使用该输出。', 'MODEL_JSON'); }
}

function redact(message: string): string {
  const key = process.env.LLM_API_KEY;
  return (key ? message.split(key).join('[redacted]') : message).replace(/sk-[a-zA-Z0-9_-]{8,}/g, '[redacted]').slice(0, 250);
}

/** Accumulate Messages SSE text only. Thinking/signature blocks never enter the returned result. */
export async function readMessageStream(response: Response, onActivity?: (characters: number) => void): Promise<string> {
  if (!response.body) throw new ModelError('模型流式响应为空。', 'MODEL_EMPTY');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '', text = '', complete = false, stopReason = '', lastActivity = 0;
  function frame(raw: string) {
    const payload = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload || payload === '[DONE]') return;
    let data: Record<string, any>;
    try { data = JSON.parse(payload); }
    catch { throw new ModelError('模型流式事件不是有效 JSON。', 'MODEL_PROTOCOL'); }
    if (data.type === 'error') throw new ModelError('模型在流式生成时返回服务错误，请稍后重试。', 'MODEL_PROVIDER');
    if (data.type === 'content_block_start' && data.content_block?.type === 'text' && typeof data.content_block.text === 'string') text += data.content_block.text;
    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && typeof data.delta.text === 'string') text += data.delta.text;
    if (data.type === 'message_delta' && typeof data.delta?.stop_reason === 'string') stopReason = data.delta.stop_reason;
    if (data.type === 'message_stop') complete = true;
    if (text.length && (complete || Date.now() - lastActivity > 1500)) { lastActivity = Date.now(); onActivity?.(text.length); }
    if (text.length > 2_000_000 || pending.length > 2_000_000) throw new ModelError('模型响应超过限制。', 'MODEL_RESPONSE_SIZE');
  }
  try {
    while (!complete) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (pending.length > 2_000_000) throw new ModelError('模型响应超过限制。', 'MODEL_RESPONSE_SIZE');
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        frame(pending.slice(0, match.index)); pending = pending.slice(match.index + match[0].length);
      }
      if (done) { if (pending.trim()) frame(pending); break; }
    }
    if (!complete) throw new ModelError('模型流式响应中断，未接收到完成事件。', 'MODEL_STREAM_INCOMPLETE');
    if (stopReason === 'max_tokens') throw new ModelError('模型输出达到长度上限，请减少平台数量或缩短任务后重试。', 'MODEL_TRUNCATED');
    if (!text.trim()) throw new ModelError('模型未返回可用的正文。', 'MODEL_EMPTY');
    return text;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function callModel(
  system: string, user: string,
  options: { signal?: AbortSignal; maxTokens?: number; fetcher?: typeof fetch; onActivity?: (characters: number) => void } = {},
): Promise<string> {
  const config = modelConfig();
  if (!config.configured) throw new ModelError('尚未配置模型密钥。请在项目 .env.local 中填写 LLM_API_KEY，重启服务后使用模型创作。', 'MODEL_NOT_CONFIGURED');
  const fetcher = options.fetcher || fetch;
  for (let attempt = 0; attempt < 2; attempt++) {
    options.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    try {
      const response = await fetcher(`${config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.LLM_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.name, max_tokens: options.maxTokens || 6000,
          stream: true, system,
          messages: [{ role: 'user', content: user }],
        }),
        signal,
      });
      if ([429, 502, 503, 504].includes(response.status) && attempt === 0) {
        await response.body?.cancel();
        const wait = Math.min(3000, Math.max(500, Number(response.headers.get('retry-after')) * 1000 || 1000));
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, wait);
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
        });
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const hint = response.status === 401 || response.status === 403 ? '请检查密钥和该模型的调用权限。'
          : response.status === 429 ? '服务限流，请稍后重试。' : '请检查模型服务状态与协议配置。';
        throw new ModelError(`模型接口返回 HTTP ${response.status}。${hint}`, 'MODEL_HTTP');
      }
      if (response.headers.get('content-type')?.includes('text/event-stream')) return await readMessageStream(response, options.onActivity);
      const body = await response.text();
      if (body.length > 2_000_000) throw new ModelError('模型响应超过限制。', 'MODEL_RESPONSE_SIZE');
      let data: { content?: { type?: string; text?: string }[]; stop_reason?: string; error?: unknown };
      try { data = JSON.parse(body); }
      catch { throw new ModelError('中转站返回了非 JSON 响应，请确认 Messages 协议可用。', 'MODEL_PROTOCOL'); }
      if (data.error) throw new ModelError('中转站返回模型业务错误，请检查控制台状态。', 'MODEL_PROVIDER');
      if (data.stop_reason === 'max_tokens') throw new ModelError('模型输出达到长度上限，请减少平台数量或缩短任务后重试。', 'MODEL_TRUNCATED');
      if (!Array.isArray(data.content)) throw new ModelError('中转站响应缺少 Messages content 字段。', 'MODEL_PROTOCOL');
      const text = data.content.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
      if (!text.trim()) throw new ModelError('模型未返回可用的正文。', 'MODEL_EMPTY');
      options.onActivity?.(text.length);
      return text;
    } catch (error) {
      if (options.signal?.aborted) throw new ModelError('任务已取消。', 'CANCELLED');
      if (timeout.aborted) throw new ModelError(`模型调用超时（${Math.round(config.timeoutMs / 1000)} 秒），可调整 LLM_TIMEOUT_MS 后重试。`, 'MODEL_TIMEOUT');
      if (error instanceof ModelError) throw error;
      throw new ModelError(`模型连接失败：${redact(error instanceof Error ? error.message : '网络异常')}`, 'MODEL_NETWORK');
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
