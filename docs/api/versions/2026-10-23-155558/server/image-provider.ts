import { createHash, randomUUID } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import type { ModelCallRecord, Platform } from '../shared/types.js';
import { FairLimiter } from './fair-limiter.js';
import { hasRealSecret, ModelError, normalizeModelBaseUrl, providerBusinessError, redactProviderText, type ProviderErrorDetails } from './model.js';

export const DEFAULT_IMAGE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const DEFAULT_IMAGE_MODEL = 'doubao-seedream-5-0-pro-260628';
const MAX_IMAGE_BYTES = 25_000_000;
const MAX_RESPONSE_BYTES = 40_000_000;
const imageSlots = new FairLimiter(1);

export class ImageProviderError extends ModelError {
  constructor(message: string, code = 'IMAGE_ERROR', status?: number, uncertain = false, retryable = true, details: ProviderErrorDetails = {}) {
    super(message, code, status, uncertain, retryable, details); this.name = 'ImageProviderError';
  }
}
export interface ImageConfigSnapshot {
  configured: boolean; baseUrl: string; name: string; timeoutMs: number;
  /** Backend memory only. Do not serialize this snapshot into jobs or history. */
  apiKey?: string;
}
/** Ark has its own API root. Explicit legacy providers retain their /v1 contract. */
export function normalizeImageBaseUrl(raw: string): string {
  try {
    const parsed = new URL(raw.trim()), pathname = parsed.pathname.replace(/\/+$/, '');
    if (/\/images\/(?:generations|edits)$/i.test(pathname)) throw new Error('Not an API root');
    if (parsed.hostname === 'ark.cn-beijing.volces.com') {
      if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || !['', '/api/v3'].includes(pathname)) throw new Error('Invalid Ark API root');
      return `${parsed.origin}/api/v3`;
    }
    return normalizeModelBaseUrl(raw);
  } catch { throw new ImageProviderError('IMAGE_BASE_URL 必须是 HTTPS API 根地址；火山方舟使用 https://ark.cn-beijing.volces.com/api/v3，不能填写 /v1、完整生图接口、凭证或查询参数。', 'IMAGE_CONFIG', undefined, false, false); }
}
export function snapshotImageConfig(): ImageConfigSnapshot {
  const baseUrl = normalizeImageBaseUrl(process.env.IMAGE_BASE_URL || DEFAULT_IMAGE_BASE_URL);
  return { configured: hasRealSecret(process.env.IMAGE_API_KEY), baseUrl, name: process.env.IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL,
    timeoutMs: Math.floor(Math.max(1_000, Math.min(Number(process.env.IMAGE_TIMEOUT_MS) || 300_000, 300_000))), apiKey: process.env.IMAGE_API_KEY?.trim() };
}
export function imageConfig(): Omit<ImageConfigSnapshot, 'apiKey'> {
  const { configured, baseUrl, name, timeoutMs } = snapshotImageConfig(); return { configured, baseUrl, name, timeoutMs };
}
export interface GenerateImageOptions {
  prompt: string; signal?: AbortSignal; fetcher?: typeof fetch; config?: ImageConfigSnapshot;
  jobId?: string; platform?: Platform; stage?: string; size?: '1024x1024' | '1024x1536' | '1536x1024';
  /** These hooks must synchronously commit dispatch metadata before a paid request starts. */
  onCall?: (record: ModelCallRecord) => void; beforeDispatch?: () => void;
}
export interface GeneratedImage {
  buffer: Buffer; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; sha256: string;
  model: string; baseUrl: string; createdAt: string; width: number; height: number;
  requestId?: string; usage?: ModelCallRecord['usage']; call: ModelCallRecord;
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function safeId(value: unknown, key?: string): string | undefined {
  if (typeof value !== 'string') return;
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(value) && redactProviderText(value, key) === value ? value : undefined;
}
function imageUsage(raw: unknown): ModelCallRecord['usage'] {
  if (!object(raw)) return;
  const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const usage = { promptTokens: integer(raw.input_tokens ?? raw.prompt_tokens), completionTokens: integer(raw.output_tokens ?? raw.completion_tokens), totalTokens: integer(raw.total_tokens), generatedImages: integer(raw.generated_images) };
  return Object.values(usage).some(value => value !== undefined) ? usage : undefined;
}
async function bodyBytes(response: Response, limit: number, onChunk: () => void): Promise<Buffer> {
  if (!response.body) throw new ImageProviderError('生图服务没有返回响应内容，结果不确定。', 'IMAGE_EMPTY', response.status, true);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value?.byteLength) { onChunk(); bytes += value.byteLength; if (bytes > limit) throw new ImageProviderError('生图响应超过本机安全大小限制，请检查服务商输出。', 'IMAGE_RESPONSE_SIZE', response.status, true); chunks.push(value); }
      if (done) return Buffer.concat(chunks);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function cloudflareBlocked(response: Response, bytes: Buffer): boolean {
  if (response.status !== 403) return false;
  const html = bytes.subarray(0, 64_000).toString('utf8');
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/html') && !/^\s*(?:<!doctype\s+html|<html\b)/i.test(html)) return false;
  const cloudflare = /\bcloudflare\b/i.test(response.headers.get('server') || '') || /\bcloudflare\b/i.test(html);
  return cloudflare && (/<title\b[^>]*>[^<]*(?:Attention Required|Access denied|Just a moment)[^<]*<\/title>/i.test(html)
    || /\bcf-error-details\b|\bcf-chl-|\bcf_chl_|Sorry, you have been blocked/i.test(html));
}
function permittedAssetUrl(raw: string): URL {
  try {
    const url = new URL(raw); const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
      || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.includes(':')
      || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes('.')) throw new Error();
    return url;
  } catch { throw new ImageProviderError('生图服务返回了不允许的图片地址，未访问该地址。', 'IMAGE_PROTOCOL', undefined, true, false, { category: 'protocol', diagnosticId: randomUUID() }); }
}

/** One user-triggered attempt. Unknown outcomes pause; callers alone own checkpoint acknowledgement. */
export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImage> {
  const config = options.config ? { ...options.config, baseUrl: normalizeImageBaseUrl(options.config.baseUrl) } : snapshotImageConfig();
  if (!config.configured || !hasRealSecret(config.apiKey)) throw new ImageProviderError('尚未配置生图密钥，请在本机终端隐藏输入 IMAGE_API_KEY。文本与朋友圈任务可以继续使用。', 'IMAGE_NOT_CONFIGURED', undefined, false, true);
  if (!options.prompt.trim() || options.prompt.length > 60_000) throw new ImageProviderError('生图提示词为空或超过限制，请先完成结构化设计简报。', 'IMAGE_PROMPT', undefined, false, false);
  if (options.signal?.aborted) throw new ImageProviderError('生图任务已取消。', 'CANCELLED', undefined, false, false);
  const queued = Date.now(); let release: () => void;
  try { release = await imageSlots.acquire(options.jobId || 'image', options.signal); }
  catch { throw new ImageProviderError('生图任务已取消。', 'CANCELLED', undefined, false, false); }
  try { options.signal?.throwIfAborted(); options.beforeDispatch?.(); }
  catch (error) { release(); throw error; }
  const started = Date.now(); const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const call: ModelCallRecord = { id: randomUUID(), stage: options.stage || 'image', platform: options.platform, attempt: 1,
    queuedAt: new Date(queued).toISOString(), startedAt: new Date(started).toISOString(), queueMs: started - queued, outcome: 'dispatched' };
  const emit = () => options.onCall?.(structuredClone(call));
  let dispatched = false, lastChunk = started, idle = 0;
  const activity = () => { const now = Date.now(); idle = Math.max(idle, now - lastChunk); lastChunk = now; call.firstContentMs ??= now - started; };
  try {
    emit(); signal.throwIfAborted(); dispatched = true;
    const fetcher = options.fetcher || fetch;
    const ark = config.baseUrl === DEFAULT_IMAGE_BASE_URL;
    const response = await fetcher(`${config.baseUrl}/images/generations`, { method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey!}` },
      // Seedream 5.0 pro is single-image and non-streaming by default. It does
      // not accept n, stream or sequential_image_generation parameters.
      body: JSON.stringify({ model: config.name, prompt: options.prompt, size: options.size || '1024x1536', output_format: 'png',
        ...(ark ? { response_format: 'b64_json', watermark: false } : { n: 1 }) }),
    });
    call.firstResponseMs = Date.now() - started; call.upstreamStatus = response.status;
    call.requestId = safeId(response.headers.get('x-tt-logid') || response.headers.get('x-request-id') || response.headers.get('request-id') || response.headers.get('cf-ray'), config.apiKey);
    const bytes = await bodyBytes(response, MAX_RESPONSE_BYTES, activity); let data: unknown;
    if (cloudflareBlocked(response, bytes)) throw new ImageProviderError('生图网关的 Cloudflare 防火墙拒绝了请求（HTTP 403）。这不能证明 API Key 无效；请联系网关服务商检查防火墙与访问策略，未自动重试。', 'IMAGE_GATEWAY_BLOCKED', response.status, false, false,
      { category: 'unknown', providerCode: 'cloudflare_gateway_blocked', providerType: 'gateway_firewall', requestId: call.requestId, diagnosticId: randomUUID() });
    try { data = JSON.parse(bytes.toString('utf8')); }
    catch {
      if (!response.ok) throw new ImageProviderError(`生图接口返回 HTTP ${response.status}，未自动重试。${response.status >= 500 ? '结果不确定，主动重试可能再次产生消耗。' : '请检查网关、凭证和模型权限。'}`, 'IMAGE_HTTP', response.status, response.status >= 500, ![401, 403].includes(response.status),
        { requestId: call.requestId, diagnosticId: randomUUID(), category: [401, 403].includes(response.status) ? 'authentication' : response.status === 429 ? 'rate_limit' : 'unknown' });
      throw new ImageProviderError('生图接口没有返回有效 JSON，结果不确定；请检查 Images API 协议。', 'IMAGE_PROTOCOL', response.status, true, false, { category: 'protocol', requestId: call.requestId, diagnosticId: randomUUID() });
    }
    const business = providerBusinessError(data, { status: response.status, requestId: call.requestId, requestKey: config.apiKey, code: 'IMAGE_PROVIDER', label: '生图服务' });
    if (business) throw new ImageProviderError(business.message, business.code, business.upstreamStatus, business.outcomeUnknown, business.retryable, business);
    if (!response.ok) throw new ImageProviderError(`生图接口返回 HTTP ${response.status}，未自动重试。`, 'IMAGE_HTTP', response.status, response.status >= 500, ![401, 403].includes(response.status),
      { requestId: call.requestId, diagnosticId: randomUUID(), category: [401, 403].includes(response.status) ? 'authentication' : response.status === 429 ? 'rate_limit' : 'unknown' });
    if (!object(data) || !Array.isArray(data.data) || data.data.length !== 1 || !object(data.data[0])) throw new ImageProviderError('生图服务未返回单张有效素材，结果不确定。', 'IMAGE_PROTOCOL', response.status, true, false, { category: 'protocol', diagnosticId: randomUUID() });
    call.usage = imageUsage(data.usage); const asset = data.data[0]; let buffer: Buffer;
    if (typeof asset.b64_json === 'string') {
      if (!asset.b64_json.length || asset.b64_json.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(asset.b64_json)) throw new ImageProviderError('生图服务的图片编码无效或过大。', 'IMAGE_PROTOCOL', response.status, true, false);
      buffer = Buffer.from(asset.b64_json, 'base64');
    } else if (typeof asset.url === 'string') {
      const url = permittedAssetUrl(asset.url);
      // Signed result URLs are fetched once, without forwarding the API credential, then discarded.
      const assetResponse = await fetcher(url.toString(), { redirect: 'error', signal });
      if (!assetResponse.ok) { await assetResponse.body?.cancel().catch(() => {}); throw new ImageProviderError('已生成素材但图片回收失败，请检查诊断信息后主动恢复，勿直接重复生图。', 'IMAGE_RECOVERY', assetResponse.status, true); }
      buffer = await bodyBytes(assetResponse, MAX_IMAGE_BYTES, activity);
    } else throw new ImageProviderError('生图服务没有返回图片编码或图片地址。', 'IMAGE_PROTOCOL', response.status, true, false);
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new ImageProviderError('生图素材为空或超过大小限制。', 'IMAGE_RESPONSE_SIZE', response.status, true, false);
    let metadata: Metadata;
    try { metadata = await sharp(buffer, { limitInputPixels: 25_000_000 }).metadata(); }
    catch { throw new ImageProviderError('生图素材不能解码为有效图片，请检查服务商输出。', 'IMAGE_PROTOCOL', response.status, true, false); }
    if (!metadata.width || !metadata.height || !['png', 'jpeg', 'webp'].includes(metadata.format || '')) throw new ImageProviderError('生图素材必须是有效 PNG、JPEG 或 WebP 图片。', 'IMAGE_PROTOCOL', response.status, true, false);
    signal.throwIfAborted(); call.outcome = 'succeeded';
    return { buffer, mimeType: `image/${metadata.format}` as GeneratedImage['mimeType'], width: metadata.width, height: metadata.height, sha256: createHash('sha256').update(buffer).digest('hex'),
      model: config.name, baseUrl: config.baseUrl, createdAt: new Date().toISOString(), requestId: call.requestId, usage: call.usage, call };
  } catch (error) {
    let failure: unknown = error;
    if (options.signal?.aborted) failure = new ImageProviderError('生图任务已取消。已派发请求的结果可能仍在服务商处理，请勿盲目重复生成。', 'CANCELLED', call.upstreamStatus, dispatched, true, { diagnosticId: randomUUID(), requestId: call.requestId });
    else if (timeout.aborted) failure = new ImageProviderError(`生图调用超时（${Math.round(config.timeoutMs / 1000)} 秒），结果不确定；主动重试可能再次产生消耗。`, 'IMAGE_TIMEOUT', call.upstreamStatus, true, true, { diagnosticId: randomUUID(), requestId: call.requestId });
    else if (!(error instanceof ModelError) && dispatched) failure = new ImageProviderError(`生图连接失败：${redactProviderText(error instanceof Error ? error.message : '网络异常', config.apiKey)}；结果不确定，未自动重试。`, 'IMAGE_NETWORK', call.upstreamStatus, true, true, { diagnosticId: randomUUID(), requestId: call.requestId });
    if (failure instanceof ModelError) { failure.upstreamStatus ??= call.upstreamStatus; failure.requestId ??= call.requestId; call.requestId ??= failure.requestId; }
    call.outcome = failure instanceof ModelError && failure.outcomeUnknown ? 'unknown' : 'failed'; call.code = failure instanceof ModelError ? failure.code : 'STATE_ERROR';
    throw failure;
  } finally {
    call.endedAt = new Date().toISOString(); call.totalMs = Date.now() - started; call.maxIdleMs = Math.max(idle, Date.now() - lastChunk);
    try { emit(); } finally { release(); }
  }
}
