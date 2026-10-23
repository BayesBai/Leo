import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { CanvaConnectionStatus, ExternalDesign, Platform } from '../../shared/types.js';
import { runtimeId, stateStore, stateDirectory } from '../state-store.js';
import { boundedBytes, CanvaError, CanvaMcp, jsonObject, providerFailure, responseJson, type JsonObject } from './canva-http.js';
export { CanvaError } from './canva-http.js';

const REST = 'https://api.canva.com/rest/v1';
const OAUTH_TTL = 10 * 60_000;
const SCOPES = 'design:content:read design:content:write design:meta:read';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
type Tokens = { accessToken: string; refreshToken: string; expiresAt: number; configHash: string; generation: string; connectionId: string; refreshing?: string };
type PendingAuth = { verifier: string; expiresAt: number; configHash: string; redirectUri: string };
function storedTokens(): Tokens | undefined {
  const token = stateStore().get<Tokens>('canvaCredentials', 'user');
  if (token && (typeof token.accessToken !== 'string' || !token.accessToken || typeof token.refreshToken !== 'string' || !token.refreshToken || !Number.isFinite(token.expiresAt)
    || typeof token.configHash !== 'string' || typeof token.generation !== 'string' || typeof token.connectionId !== 'string' || token.refreshing !== undefined && typeof token.refreshing !== 'string')) throw new CanvaError('本机 Canva 授权记录损坏，已保留原文件，请检查后重新连接。', 'CANVA_STATE_CORRUPT', 503);
  return token;
}
function config() {
  const clientId = process.env.CANVA_CLIENT_ID?.trim() || ''; const clientSecret = process.env.CANVA_CLIENT_SECRET?.trim() || '';
  const redirectUri = process.env.CANVA_REDIRECT_URI?.trim() || 'http://127.0.0.1:3000/api/integrations/canva/callback';
  let validRedirect = false;
  try { const u = new URL(redirectUri); validRedirect = !u.username && !u.password && !u.hash && !u.search && u.pathname === '/api/integrations/canva/callback' && (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))); } catch { /* returned as not configured */ }
  return { clientId, clientSecret, redirectUri, configured: Boolean(clientId && clientSecret && validRedirect), hash: sha(`${clientId}\0${clientSecret}\0${redirectUri}`) };
}
function requireConfig() { const c = config(); if (!c.configured) throw new CanvaError('尚未配置 Canva 开发应用 Client ID、Client Secret 或正确的回调地址。', 'CANVA_NOT_CONFIGURED', 422); return c; }
export function canvaConnectionStatus(): CanvaConnectionStatus {
  const c = config(); const token = storedTokens();
  const connected = Boolean(c.configured && token?.configHash === c.hash && token.refreshToken && !token.refreshing);
  return { configured: c.configured, connected, redirectUri: c.redirectUri,
    message: !c.configured ? '请先配置 Canva 开发应用凭证并在开发者门户启用 MCP。' : connected ? 'Canva 已授权；真实导入、编辑和导出将在生成时检查。' : token?.refreshing ? '上次令牌刷新结果不确定，请重新连接 Canva。' : '请连接 Canva 并授权本机后端。' };
}
/** Opaque OAuth-session identity; changes on reauthorization, stays stable across token refresh. */
export function canvaConnectionIdentity(): string | undefined {
  const token = storedTokens();
  return token?.configHash === config().hash ? token.connectionId : undefined;
}
export function beginCanvaConnection(): { authorizationUrl: string; expiresAt: string } {
  const c = requireConfig(); const state = randomBytes(32).toString('base64url'); const verifier = randomBytes(64).toString('base64url');
  const expiresAt = Date.now() + OAUTH_TTL;
  stateStore().update(b => {
    const pending = b.canvaOAuth ||= {}; for (const [key, raw] of Object.entries(pending)) if ((raw as PendingAuth).expiresAt < Date.now()) delete pending[key];
    pending[sha(state)] = { verifier, expiresAt, configHash: c.hash, redirectUri: c.redirectUri } satisfies PendingAuth;
  });
  const url = new URL('https://www.canva.com/api/oauth/authorize');
  for (const [key, value] of Object.entries({ response_type: 'code', client_id: c.clientId, redirect_uri: c.redirectUri, scope: SCOPES, state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') })) url.searchParams.set(key, value);
  return { authorizationUrl: url.toString(), expiresAt: new Date(expiresAt).toISOString() };
}
async function exchange(fields: Record<string, string>): Promise<Tokens> {
  const c = requireConfig(); let response: Response;
  try { response = await fetch(`${REST}/oauth/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), signal: AbortSignal.timeout(30_000), redirect: 'error' }); }
  catch { throw new CanvaError('Canva 令牌交换结果不确定，请重新授权。', 'CANVA_OAUTH_UNKNOWN', 502, true); }
  const data = await responseJson(response);
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || typeof data.expires_in !== 'number' || data.expires_in <= 0) throw new CanvaError('Canva 令牌响应不完整，请重新授权。', 'CANVA_OAUTH_PROTOCOL');
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000, configHash: c.hash, generation: randomUUID(), connectionId: randomUUID() };
}
export async function completeCanvaConnection(input: { code?: string; state?: string; error?: string }): Promise<CanvaConnectionStatus> {
  const c = requireConfig(); const pending = input.state ? stateStore().get<PendingAuth>('canvaOAuth', sha(input.state)) : undefined;
  if (pending && (typeof pending.verifier !== 'string' || !Number.isFinite(pending.expiresAt) || typeof pending.configHash !== 'string' || typeof pending.redirectUri !== 'string')) throw new CanvaError('本机 Canva 授权临时记录损坏，已保留原文件。', 'CANVA_STATE_CORRUPT', 503);
  if (!pending || pending.expiresAt < Date.now() || pending.configHash !== c.hash) throw new CanvaError('Canva 授权 state 无效或已过期，请从工作台重新连接。', 'CANVA_OAUTH_STATE', 400);
  // Consume before a network request. An uncertain authorization exchange is never replayed.
  stateStore().remove('canvaOAuth', sha(input.state!));
  if (input.error || !input.code) throw new CanvaError('Canva 授权未完成，请重新连接。', 'CANVA_OAUTH_DENIED', 400);
  const token = await exchange({ grant_type: 'authorization_code', code: input.code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri });
  stateStore().set('canvaCredentials', 'user', token);
  return canvaConnectionStatus();
}
let refreshing: Promise<string> | undefined;
async function accessToken(): Promise<string> {
  const c = requireConfig(); const token = storedTokens();
  if (!token || token.configHash !== c.hash) throw new CanvaError('请先连接并授权 Canva。', 'CANVA_NOT_CONNECTED', 422);
  if (refreshing) return refreshing;
  if (token.refreshing) throw new CanvaError('上次 Canva 令牌刷新结果不确定，请重新连接。', 'CANVA_OAUTH_UNKNOWN', 409, true);
  if (token.expiresAt > Date.now() + 60_000) return token.accessToken;
  stateStore().set('canvaCredentials', 'user', { ...token, refreshing: runtimeId });
  refreshing = (async () => {
    const next = await exchange({ grant_type: 'refresh_token', refresh_token: token.refreshToken });
    const current = storedTokens();
    if (!current || current.generation !== token.generation) throw new CanvaError('Canva 已断开或重新连接，旧刷新结果已丢弃。', 'CANVA_CONNECTION_CHANGED', 409);
    stateStore().set('canvaCredentials', 'user', { ...next, connectionId: token.connectionId }); return next.accessToken;
  })();
  try { return await refreshing; } finally { refreshing = undefined; }
}
export async function disconnectCanva(): Promise<CanvaConnectionStatus> {
  const token = storedTokens(); const c = config();
  stateStore().update(b => { delete b.canvaCredentials?.user; b.canvaOAuth = {}; });
  // Local access is revoked immediately even if Canva is unavailable. Never retain
  // or echo credentials to make a failed remote revocation look successful.
  if (token && c.configured) {
    try { const response = await fetch(`${REST}/oauth/revoke`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: token.refreshToken }), signal: AbortSignal.timeout(15_000), redirect: 'error' });
      if (!response.ok) throw providerFailure(response.status); await response.body?.cancel();
    } catch { return { ...canvaConnectionStatus(), message: '本机 Canva 已断开；远端撤销未确认，可到 Canva 账号中撤销应用授权。' }; }
  }
  return canvaConnectionStatus();
}

export interface CanvaFile { bytes: Buffer; sha256: string; mime: 'image/png' | 'application/zip'; name: string }
export interface CanvaInspection { text: string; textElementCount: number; imageElementCount: number; pageCount: number; textHash: string; imageHash: string }
export interface CanvaCheckpoint {
  operationId: string; inputHash: string; expiresAt: string; connectionId: string;
  phase: 'import_dispatched' | 'import_pending' | 'imported' | 'edit_dispatched' | 'verified' | 'export_dispatched' | 'exported';
  importJobId?: string; design?: ExternalDesign; inspection?: CanvaInspection; transactionId?: string;
  files?: { path: string; sha256: string; mime: CanvaFile['mime']; name: string }[];
}
export interface CanvaImportInput {
  operationId: string; bytes: Buffer; title: string; platform: Platform; expiresAt: string;
  verificationEdit: { from: string; to: string }; expectedText?: string[]; expectedImageCount?: number;
  width?: number; height?: number; checkpoint?: CanvaCheckpoint;
  onCheckpoint?: (checkpoint: CanvaCheckpoint) => void | Promise<void>; signal?: AbortSignal; expectedConnectionId?: string;
}
function assertUnexpired(expiresAt: string) { if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) throw new CanvaError('成品或 Canva 同步资源已过期，请主动重新排版。', 'CANVA_ASSET_EXPIRED', 410); }
async function boundToken(connectionId: string): Promise<string> {
  const token = await accessToken();
  if (canvaConnectionIdentity() !== connectionId) throw new CanvaError('Canva 账号授权已变化，已停止此设计的后续请求。', 'CANVA_CONNECTION_CHANGED', 409);
  return token;
}
/** Read-only preflight, intended before any paid image generation. OAuth alone
 * does not prove that the developer app enabled MCP or exposes editing tools. */
export async function verifyCanvaConnection(signal?: AbortSignal): Promise<{ connected: true; checkedAt: string; tools: string[] }> {
  await accessToken(); const connectionId = canvaConnectionIdentity()!;
  const mcp = new CanvaMcp(() => boundToken(connectionId), signal); await mcp.connect();
  const tools = ['get-design-content', 'start-editing-transaction', 'perform-editing-operations', 'commit-editing-transaction', 'cancel-editing-transaction', 'export-design'];
  for (const tool of tools) mcp.schema(tool);
  return { connected: true, checkedAt: new Date().toISOString(), tools };
}
async function rest(pathname: string, init: RequestInit, signal?: AbortSignal, connectionId?: string): Promise<JsonObject> {
  const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${connectionId ? await boundToken(connectionId) : await accessToken()}`);
  try { const response = await fetch(`${REST}${pathname}`, { ...init, headers, signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]), redirect: 'error' }); return await responseJson(response); }
  catch (error) { if (error instanceof CanvaError) throw error; throw new CanvaError('Canva REST 连接中断或超时，结果不确定。', 'CANVA_NETWORK', 502, init.method !== 'GET'); }
}
async function pause(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted(); await new Promise<void>((resolve, reject) => { const timer = setTimeout(done, ms); function done() { signal?.removeEventListener('abort', abort); resolve(); } function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); } signal?.addEventListener('abort', abort, { once: true }); });
}
function safeEditUrl(value: unknown, id: string): string {
  try { const url = new URL(String(value)); if (url.protocol === 'https:' && (url.hostname === 'www.canva.com' || url.hostname === 'canva.com') && !url.username && !url.password) return url.toString(); } catch { /* canonical fallback */ }
  return `https://www.canva.com/design/${encodeURIComponent(id)}/edit`;
}
function inspect(content: JsonObject, transaction: JsonObject): CanvaInspection {
  const richtexts = Array.isArray(transaction.richtexts) ? transaction.richtexts : [];
  const fills = Array.isArray(transaction.fills) ? transaction.fills.filter((f: JsonObject) => f.type === 'image') : [];
  const text = typeof content.text === 'string' ? content.text : richtexts.map((t: JsonObject) => (t.regions || []).map((r: JsonObject) => r.text || '').join('')).join('\n');
  const normalized = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
  // Position, size, page order and revision metadata are deliberately excluded.
  const texts = richtexts.map((t: JsonObject) => normalized((t.regions || []).map((r: JsonObject) => r.text || '').join(''))).sort();
  const images = fills.map((f: JsonObject) => `${f.asset_id || ''}:${f.editable === false ? 'locked' : 'editable'}`).sort();
  if (fills.some((f: JsonObject) => typeof f.asset_id !== 'string')) throw new CanvaError('Canva 未返回可核对的图片素材标识。', 'CANVA_CONTENT_UNKNOWN');
  return { text, textElementCount: richtexts.length, imageElementCount: fills.length, pageCount: Array.isArray(transaction.pages) ? transaction.pages.length : content.metadata?.page_count || 0,
    textHash: sha(JSON.stringify(texts.length ? texts : [normalized(text)])), imageHash: sha(JSON.stringify(images)) };
}
function contentHash(inspection: CanvaInspection) { return sha(`${inspection.textHash}:${inspection.imageHash}`); }
async function readAndInspect(mcp: CanvaMcp, designId: string) {
  const content = await mcp.call('get-design-content', { design_id: designId, content_types: ['richtexts'] }, '读取已导入设计的中文文本以核对渠道交付');
  const opened = await mcp.call('start-editing-transaction', { design_id: designId }, '检查真实产品图片层与中文文字层是否可独立编辑');
  const transactionId = opened.transaction?.transaction_id || opened.transaction?.id;
  if (typeof transactionId !== 'string') throw new CanvaError('Canva 编辑事务未返回 transaction_id。');
  return { content, opened, transactionId, inspection: inspect(content, opened) };
}
async function cancelTransaction(mcp: CanvaMcp, transactionId: string) {
  await mcp.call('cancel-editing-transaction', { transaction_id: transactionId }, '关闭未修改的 Canva 检查事务');
}
async function downloadExport(url: string, signal?: AbortSignal): Promise<CanvaFile> {
  let parsed: URL; try { parsed = new URL(url); } catch { throw new CanvaError('Canva 导出地址无效。'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !(parsed.hostname === 'canva.com' || parsed.hostname.endsWith('.canva.com'))) throw new CanvaError('Canva 导出地址不在官方域名范围内。', 'CANVA_EXPORT_HOST');
  // Never forward OAuth tokens to signed export/CDN URLs and never follow a
  // redirect that could turn provider data into a request to a private host.
  let response: Response;
  try { response = await fetch(parsed, { signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]), redirect: 'error' }); }
  catch { throw new CanvaError('Canva 导出文件连接失败，请主动同步；签名地址不会写入诊断信息。', 'CANVA_EXPORT_DOWNLOAD', 502); }
  if (!response.ok) throw new CanvaError('Canva 导出文件读取失败，请主动重新同步。', 'CANVA_EXPORT_DOWNLOAD', 502, false, response.status);
  let bytes: Buffer;
  try { bytes = await boundedBytes(response, 64 * 1024 * 1024); }
  catch (error) { if (error instanceof CanvaError) throw error; throw new CanvaError('Canva 导出文件流中断，请主动同步。', 'CANVA_EXPORT_DOWNLOAD', 502); }
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!png && !zip) throw new CanvaError('Canva 导出文件并非预期 PNG 或多页 ZIP。', 'CANVA_EXPORT_FORMAT');
  return { bytes, sha256: sha(bytes), mime: png ? 'image/png' : 'application/zip', name: png ? 'canva.png' : 'canva.zip' };
}
async function exportFiles(mcp: CanvaMcp, designId: string, size: { width?: number; height?: number }, signal?: AbortSignal): Promise<CanvaFile[]> {
  const schema = mcp.schema('export-design');
  const intent = '将已核对的分层 Canva 设计导出 PNG 并回收到本机交付';
  const args: JsonObject = { design_id: designId };
  for (const [key, value] of Object.entries(size)) if (value !== undefined && schema.properties?.[key]) args[key] = value;
  const format = ['png', { type: 'png' }].find(value => mcp.accepts('export-design', { ...args, format: value }, intent));
  if (format === undefined) throw new CanvaError('Canva 当前导出工具的 PNG 参数不在支持的协议范围内。', 'CANVA_TOOL_SCHEMA');
  args.format = format;
  const result = await mcp.call('export-design', args, intent);
  const job = result.job;
  if (!job || job.status !== 'success' || !Array.isArray(job.urls) || !job.urls.length || job.urls.length > 10) throw new CanvaError('Canva 导出尚未完成，保留原设计，请主动同步获取结果。', 'CANVA_EXPORT_PENDING', 409, true);
  const files: CanvaFile[] = [];
  for (let i = 0; i < job.urls.length; i++) { if (typeof job.urls[i] !== 'string') throw new CanvaError('Canva 导出地址格式异常。'); const file = await downloadExport(job.urls[i], signal); file.name = file.mime === 'image/png' ? `canva-${i + 1}.png` : `canva-${i + 1}.zip`; files.push(file); }
  return files;
}
async function persistFiles(operationId: string, files: CanvaFile[]): Promise<NonNullable<CanvaCheckpoint['files']>> {
  const directory = path.join(stateDirectory(), 'canva-exports', sha(operationId)); await mkdir(directory, { recursive: true, mode: 0o700 });
  const saved: NonNullable<CanvaCheckpoint['files']> = [];
  for (const file of files) { const destination = path.join(directory, `${file.sha256}.${file.mime === 'image/png' ? 'png' : 'zip'}`); const temporary = `${destination}.${randomUUID()}.tmp`; await writeFile(temporary, file.bytes, { mode: 0o600 }); await rename(temporary, destination); saved.push({ path: destination, sha256: file.sha256, mime: file.mime, name: file.name }); }
  return saved;
}
async function loadFiles(files: NonNullable<CanvaCheckpoint['files']>): Promise<CanvaFile[]> {
  const result: CanvaFile[] = [];
  const root = path.join(stateDirectory(), 'canva-exports');
  for (const file of files) {
    if (typeof file.path !== 'string' || path.dirname(path.dirname(path.resolve(file.path))) !== root || !/^[a-f0-9]{64}\.(png|zip)$/.test(path.basename(file.path))) throw new CanvaError('Canva 缓存记录的文件路径损坏，已保留原记录。', 'CANVA_CACHE_CORRUPT', 503);
    const bytes = await readFile(file.path).catch(() => { throw new CanvaError('Canva 本机导出缓存缺失，请主动同步。', 'CANVA_EXPORT_CACHE', 409); });
    if (sha(bytes) !== file.sha256) throw new CanvaError('Canva 本机导出缓存校验失败，已保留文件。', 'CANVA_CACHE_CORRUPT', 503);
    result.push({ bytes, ...file });
  }
  return result;
}
function importFingerprint(input: CanvaImportInput) { return sha(Buffer.concat([input.bytes, Buffer.from(JSON.stringify({ title: input.title, platform: input.platform, edit: input.verificationEdit, expectedText: input.expectedText, expectedImageCount: input.expectedImageCount, width: input.width, height: input.height }))])); }
const activeImports = new Map<string, { signature: string; promise: Promise<{ design: ExternalDesign; inspection: CanvaInspection; files: CanvaFile[] }> }>();
export function importCanvaPptx(input: CanvaImportInput): Promise<{ design: ExternalDesign; inspection: CanvaInspection; files: CanvaFile[] }> {
  const signature = importFingerprint(input); const current = activeImports.get(input.operationId);
  if (current) return current.signature === signature ? current.promise : Promise.reject(new CanvaError('Canva 操作 ID 已用于另一份分层文件。', 'CANVA_VERSION_CONFLICT', 409));
  const promise = doImport(input).finally(() => activeImports.delete(input.operationId)); activeImports.set(input.operationId, { signature, promise }); return promise;
}
async function doImport(input: CanvaImportInput): Promise<{ design: ExternalDesign; inspection: CanvaInspection; files: CanvaFile[] }> {
  assertUnexpired(input.expiresAt); requireConfig(); await accessToken(); input.signal?.throwIfAborted();
  const connectionId = canvaConnectionIdentity()!;
  if (input.expectedConnectionId && input.expectedConnectionId !== connectionId) throw new CanvaError('任务绑定的 Canva 账号授权已变化，请重新确认后创建排版任务。', 'CANVA_CONNECTION_CHANGED', 409);
  if (!input.operationId || input.verificationEdit.from === input.verificationEdit.to || !input.verificationEdit.from || !input.verificationEdit.to || !input.bytes.length) throw new CanvaError('Canva 分层导入缺少有效文件或真实文字替换操作。', 'CANVA_IMPORT_INPUT', 422);
  const inputHash = importFingerprint(input);
  const stored = stateStore().get<CanvaCheckpoint>('canvaOperations', input.operationId);
  let checkpoint = stored || input.checkpoint;
  if (checkpoint && checkpoint.connectionId !== connectionId) throw new CanvaError('Canva 检查点属于另一次账号授权，请重新确认后创建排版任务。', 'CANVA_CONNECTION_CHANGED', 409);
  if (checkpoint && (checkpoint.inputHash !== inputHash || checkpoint.operationId !== input.operationId)) throw new CanvaError('Canva 检查点与当前分层文件不一致，请创建新的排版操作。', 'CANVA_VERSION_CONFLICT', 409);
  if (checkpoint) assertUnexpired(checkpoint.expiresAt);
  const commit = async (change: Partial<CanvaCheckpoint>) => {
    checkpoint = { operationId: input.operationId, inputHash, expiresAt: input.expiresAt, connectionId, ...checkpoint, ...change } as CanvaCheckpoint;
    stateStore().set('canvaOperations', input.operationId, checkpoint); await input.onCheckpoint?.(structuredClone(checkpoint));
  };
  if (checkpoint?.phase === 'exported' && checkpoint.design && checkpoint.inspection && checkpoint.files) return { design: checkpoint.design, inspection: checkpoint.inspection, files: await loadFiles(checkpoint.files) };
  if (checkpoint?.phase === 'import_dispatched' && !checkpoint.importJobId) throw new CanvaError('上次 Canva 导入已派发但未收到作业 ID，结果不确定；请先在 Canva 检查已有设计。', 'CANVA_IMPORT_UNKNOWN', 409, true);
  if (checkpoint?.phase === 'edit_dispatched' || checkpoint?.phase === 'export_dispatched') throw new CanvaError('上次 Canva 编辑或导出结果未确认，请使用同步入口核对原设计。', 'CANVA_OPERATION_UNKNOWN', 409, true);
  if (!checkpoint) {
    await commit({ phase: 'import_dispatched' });
    const title = Array.from(input.title).slice(0, 50).join('') || 'Virgo';
    const created = await rest('/imports', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Import-Metadata': JSON.stringify({ title_base64: Buffer.from(title).toString('base64'), mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }) }, body: new Uint8Array(input.bytes) }, input.signal, connectionId);
    if (typeof created.job?.id !== 'string') throw new CanvaError('Canva 导入已响应但缺少作业 ID，结果不确定。', 'CANVA_IMPORT_UNKNOWN', 502, true);
    await commit({ phase: 'import_pending', importJobId: created.job.id });
  }
  if (!checkpoint!.design) {
    for (let attempt = 0; attempt < 90; attempt++) {
      assertUnexpired(checkpoint!.expiresAt);
      const result = await rest(`/imports/${encodeURIComponent(checkpoint!.importJobId!)}`, { method: 'GET' }, input.signal, connectionId); const job = result.job;
      if (job?.status === 'failed') throw new CanvaError('Canva 无法导入分层文件，请保留原文件检查字体与素材。', 'CANVA_IMPORT_FAILED');
      if (job?.status === 'success') {
        const designs = job.result?.designs;
        if (!Array.isArray(designs) || designs.length !== 1 || typeof designs[0].id !== 'string') throw new CanvaError('Canva 导入未返回唯一设计，请检查远端结果。', 'CANVA_IMPORT_DESIGNS');
        const design: ExternalDesign = { id: designs[0].id, editUrl: safeEditUrl(designs[0].urls?.edit_url, designs[0].id), platform: input.platform, status: 'imported' };
        await commit({ phase: 'imported', design }); break;
      }
      if (job?.status !== 'in_progress') throw new CanvaError('Canva 导入作业状态不符合协议。');
      await pause(2_000, input.signal);
    }
    if (!checkpoint!.design) throw new CanvaError('Canva 导入仍在处理中，已保存作业 ID；稍后续跑只查询原作业。', 'CANVA_IMPORT_PENDING', 409);
  }
  const mcp = new CanvaMcp(() => boundToken(connectionId), input.signal); await mcp.connect();
  if (checkpoint!.phase !== 'verified') {
    const read = await readAndInspect(mcp, checkpoint!.design!.id);
    if (!read.inspection.textElementCount || read.inspection.imageElementCount < Math.max(1, input.expectedImageCount || 1)) {
      await cancelTransaction(mcp, read.transactionId); throw new CanvaError('Canva 未保留所需的独立中文文字层与产品图片层，禁止按成功交付。', 'CANVA_LAYERS_INVALID');
    }
    const target = read.opened.richtexts.find((text: JsonObject) => (text.regions || []).map((region: JsonObject) => region.text || '').join('') === input.verificationEdit.from);
    if (!target || typeof target.element_id !== 'string') { await cancelTransaction(mcp, read.transactionId); throw new CanvaError('Canva 导入后的标题占位层无法定位，未执行不确定编辑。', 'CANVA_EDIT_TARGET'); }
    await commit({ phase: 'edit_dispatched', transactionId: read.transactionId });
    mcp.schema('perform-editing-operations');
    const operation = { type: 'replace_text', element_id: target.element_id, text: input.verificationEdit.to };
    const result = await mcp.call('perform-editing-operations', { transaction_id: read.transactionId, page_index: target.page_index, operations: [operation] }, '将导入文件的标题占位层替换为已审核的精确中文标题');
    if (!Array.isArray(result.edit_operation_results) || !result.edit_operation_results.length || result.edit_operation_results.some((item: JsonObject) => item.status !== 'success')) throw new CanvaError('Canva 文字编辑操作未全部成功。', 'CANVA_EDIT_FAILED');
    const committed = await mcp.call('commit-editing-transaction', { transaction_id: read.transactionId }, '保存刚才的真实中文标题编辑');
    if (committed.transaction?.status !== 'committed') throw new CanvaError('Canva 编辑事务未确认提交，保留原设计等待同步。', 'CANVA_EDIT_UNKNOWN', 409, true);
    const checked = await readAndInspect(mcp, checkpoint!.design!.id); await cancelTransaction(mcp, checked.transactionId);
    const comparable = (value: string) => value.normalize('NFC').replace(/\s+/g, '');
    const actualText = comparable(checked.inspection.text);
    if (!actualText.includes(comparable(input.verificationEdit.to)) || actualText.includes(comparable(input.verificationEdit.from)) || (input.expectedText || []).some(text => !actualText.includes(comparable(text)))) throw new CanvaError('Canva 导入或编辑改变了应保留的中文内容，禁止交付。', 'CANVA_TEXT_MISMATCH');
    if (checked.inspection.imageHash !== read.inspection.imageHash || checked.inspection.imageElementCount < Math.max(1, input.expectedImageCount || 1)) throw new CanvaError('Canva 编辑后图片独立层发生变化，禁止交付。', 'CANVA_IMAGE_MISMATCH');
    const design = { ...checkpoint!.design!, status: 'verified' as const, contentHash: contentHash(checked.inspection), syncedAt: new Date().toISOString() };
    await commit({ phase: 'verified', design, inspection: checked.inspection, transactionId: undefined });
    stateStore().set('canvaDesignBaselines', design.id, { inspection: checked.inspection, expiresAt: checkpoint!.expiresAt, connectionId });
  }
  assertUnexpired(checkpoint!.expiresAt); await commit({ phase: 'export_dispatched' });
  const files = await exportFiles(mcp, checkpoint!.design!.id, input, input.signal); const saved = await persistFiles(input.operationId, files);
  const design = { ...checkpoint!.design!, status: 'exported' as const };
  await commit({ phase: 'exported', design, files: saved });
  return { design, inspection: checkpoint!.inspection!, files };
}
export async function syncCanvaDesign(input: { design: ExternalDesign; expiresAt: string; width?: number; height?: number; signal?: AbortSignal; expectedConnectionId?: string }): Promise<{ design: ExternalDesign; inspection: CanvaInspection; contentChanged: boolean; files: CanvaFile[] }> {
  assertUnexpired(input.expiresAt); const baseline = stateStore().get<{ inspection: CanvaInspection; expiresAt: string; connectionId: string }>('canvaDesignBaselines', input.design.id);
  if (baseline) assertUnexpired(baseline.expiresAt);
  const connectionId = canvaConnectionIdentity();
  if (!connectionId || input.expectedConnectionId && input.expectedConnectionId !== connectionId || baseline && baseline.connectionId !== connectionId) throw new CanvaError('设计绑定的 Canva 账号授权已变化，请重新确认后创建排版任务。', 'CANVA_CONNECTION_CHANGED', 409);
  const mcp = new CanvaMcp(() => boundToken(connectionId), input.signal); await mcp.connect();
  const current = await readAndInspect(mcp, input.design.id); await cancelTransaction(mcp, current.transactionId);
  const hash = contentHash(current.inspection); const contentChanged = !baseline || contentHash(baseline.inspection) !== hash;
  const syncId = randomUUID();
  stateStore().set('canvaSyncOperations', syncId, { designId: input.design.id, expiresAt: baseline?.expiresAt || input.expiresAt, connectionId, phase: 'export_dispatched', contentHash: hash });
  const files = await exportFiles(mcp, input.design.id, input, input.signal);
  const saved = await persistFiles(syncId, files);
  stateStore().set('canvaSyncOperations', syncId, { designId: input.design.id, expiresAt: baseline?.expiresAt || input.expiresAt, connectionId, phase: 'exported', contentHash: hash, files: saved });
  // Do not advance the reviewed baseline on content changes. Only a subsequent
  // reviewed rerender/import establishes a new baseline.
  return { design: { ...input.design, status: contentChanged ? 'changed' : 'exported', contentHash: hash, syncedAt: new Date().toISOString() }, inspection: current.inspection, contentChanged, files };
}

/** Resource bytes expire after their original deadline; diagnostic checkpoints
 * stay seven days so a restart cannot accidentally treat a prior mutation as new. */
export async function pruneCanvaState(now = Date.now()) {
  const directories = new Set<string>(); const root = path.join(stateDirectory(), 'canva-exports');
  stateStore().update(b => {
    for (const bucket of ['canvaOperations', 'canvaSyncOperations']) for (const [id, raw] of Object.entries(b[bucket] || {})) {
      const record = raw as { expiresAt?: string; files?: { path: string }[] };
      const expires = Date.parse(record.expiresAt || ''); if (!Number.isFinite(expires) || expires > now) continue;
      for (const file of record.files || []) { const directory = path.dirname(file.path); if (path.dirname(directory) === root) directories.add(directory); }
      if (now - expires > 7 * 86400_000) delete b[bucket][id];
    }
    for (const [id, raw] of Object.entries(b.canvaDesignBaselines || {})) if (now - Date.parse((raw as { expiresAt: string }).expiresAt) > 7 * 86400_000) delete b.canvaDesignBaselines[id];
    for (const [id, raw] of Object.entries(b.canvaOAuth || {})) if ((raw as PendingAuth).expiresAt < now) delete b.canvaOAuth[id];
  });
  await Promise.all([...directories].map(directory => rm(directory, { recursive: true, force: true })));
}
