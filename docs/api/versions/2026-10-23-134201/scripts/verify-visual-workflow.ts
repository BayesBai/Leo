/**
 * One real four-channel acceptance against the already running local backend.
 * No .env reads, embedded credentials, service restart, retries, image probes or regeneration.
 * The fixed ignored session file is the only source of submission keys across invocations.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS, type AppStatus, type BackgroundJob, type ChannelDelivery, type JobSubmit, type ModelCallRecord, type OutlineResult, type Platform, type Product, type RenderBundle } from '../shared/types.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'output', 'visual-verification');
const sessionPath = path.join(directory, 'session.json');
const summaryPath = path.join(directory, 'summary.json');
const lockPath = path.join(directory, 'runner.lock');
const usage = `一次真实四渠道验收（只连接已运行的本机后端，不读取密钥）\n\n生成大纲：\n  npx tsx scripts/verify-visual-workflow.ts --execute\n阅读 output/visual-verification/outline.json 后，明确确认该版大纲并继续：\n  npx tsx scripts/verify-visual-workflow.ts --execute --confirm-outline\n\n可选：--base http://127.0.0.1:3000 --product-id <本机产品 ID> --poll-minutes 30\n重复执行只读取并恢复同一组任务；失败节点不会自动重试，未知提交不会再次派发。\n运行状态与私有成品仅保存在忽略的 output/visual-verification/。没有重置或额外整组试验开关。`;
const args = process.argv.slice(2);
const allowed = new Set(['--execute', '--confirm-outline', '--base', '--product-id', '--poll-minutes', '--help']);
let base = 'http://127.0.0.1:3000', productId = '', pollMinutes = 30;
for (let i = 0; i < args.length; i++) {
  const argument = args[i];
  if (!allowed.has(argument)) throw new Error(`未知参数 ${argument}。请使用 --help。`);
  if (['--base', '--product-id', '--poll-minutes'].includes(argument)) {
    const value = args[++i]; if (!value || value.startsWith('--')) throw new Error(`${argument} 缺少参数。`);
    if (argument === '--base') base = value;
    else if (argument === '--product-id') productId = value;
    else { pollMinutes = Number(value); if (!Number.isFinite(pollMinutes) || pollMinutes < 1 || pollMinutes > 60) throw new Error('--poll-minutes 必须为 1–60。'); }
  }
}
if (args.includes('--help') || !args.includes('--execute')) { console.log(usage); process.exit(0); }
const parsedBase = new URL(base);
if (!['http:', 'https:'].includes(parsedBase.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsedBase.hostname) || parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash || !['', '/'].includes(parsedBase.pathname)) throw new Error('--base 只允许不含凭证和路径的本机 HTTP(S) 服务地址。');
base = parsedBase.origin;
if (!/^output\/$/m.test(await readFile(path.join(root, '.gitignore'), 'utf8'))) throw new Error('output/ 未在项目 Git 忽略清单中，未开始验收。');

interface Submission { key: string; input?: JobSubmit; dispatchedAt?: string; jobId?: string }
interface Session {
  schemaVersion: 1; base: string; createdAt: string; updatedAt: string;
  outline: Submission; generation: Submission; product?: { id: string; name: string };
  outlineReadyAt?: string; approvedVersion?: number; approvedAt?: string;
  outlineCalls: ModelCallRecord[]; generationCalls: ModelCallRecord[];
  firstReviewedCopyMs?: number; firstVisualPreviewMs?: number; firstReadyDeliveryMs?: number;
  generationStartedAt?: string; verifiedBundles: Record<string, BundleCheck>; completedAt?: string;
}
interface BundleCheck {
  platform: Platform; bundleId: string; checkedAt: string; publication?: RenderBundle['publication']; expiresAt: string;
  reviewStatus: RenderBundle['reviewStatus']; artifacts: Record<string, unknown>[]; zip?: Record<string, unknown>;
  canva: { id: string; status: string; contentHash?: string }[];
}
class CheckError extends Error { constructor(message: string, readonly code = 'ACCEPTANCE_CHECK') { super(message); this.name = 'CheckError'; } }
function check(value: unknown, message: string, code?: string): asserts value { if (!value) throw new CheckError(message, code); }
function safe(message: string) { return message.replace(/\bsk-[\w.~+\/-]+={0,2}/g, '[redacted]').replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]').replace(/https?:\/\/[^\s<>"']+\?[^\s<>"']+/g, '[temporary URL redacted]').slice(0, 800); }
async function atomic(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
await mkdir(directory, { recursive: true, mode: 0o700 });
// A dead process may leave a lock, but a live runner must never dispatch beside another one.
try {
  const old = JSON.parse(await readFile(lockPath, 'utf8')) as { pid?: number };
  check(Number.isSafeInteger(old.pid) && old.pid! > 0, '验收锁损坏，已保留原文件，请人工核对。');
  try { process.kill(old.pid!, 0); throw new CheckError('已有验收进程运行中，未开始第二组。', 'RUNNER_ACTIVE'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
  await rm(lockPath);
} catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
const lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); await lock.close();

let session: Session | undefined; let phase = 'preflight'; const invokedAt = Date.now();
const report: Record<string, unknown> = { invokedAt: new Date(invokedAt).toISOString(), success: false, imaCalled: false, manualVisualInspection: 'pending', paidGroupsAllowed: 1, timingNotes: '按一秒轮询观测；脚本中断后恢复的观测值包含空档，不作为固定速度承诺。' };
const timeout = AbortSignal.timeout(pollMinutes * 60_000);
const persist = async () => { check(session, '验收状态尚未初始化。'); session.updatedAt = new Date().toISOString(); await atomic(sessionPath, session); };
async function api<T>(route: string, method = 'GET', body?: unknown): Promise<T> {
  check(route.startsWith('/api/') && !route.startsWith('//'), '仅允许访问本机项目 API。');
  const signal = AbortSignal.any([timeout, AbortSignal.timeout(route.endsWith('/canva/verify') ? 180_000 : 20_000)]);
  const response = await fetch(base + route, { method, redirect: 'error', signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json().catch(() => undefined);
  if (!response.ok) throw new CheckError(safe(value?.message || `本机 API 返回 HTTP ${response.status}。`), `HTTP_${response.status}`);
  check(value && typeof value === 'object', '本机 API 返回非 JSON 对象。'); return value as T;
}
async function lookup(submission: Submission) {
  return (await api<{ jobs: BackgroundJob[] }>(`/api/jobs?idempotencyKey=${encodeURIComponent(submission.key)}`)).jobs[0];
}
async function submitOnce(submission: Submission): Promise<BackgroundJob> {
  if (submission.jobId) return (await api<{ job: BackgroundJob }>(`/api/jobs/${encodeURIComponent(submission.jobId)}`)).job;
  if (submission.dispatchedAt) {
    const found = await lookup(submission);
    check(found, '此前提交结果仍不确定；未找到对应幂等键。不会再次提交，请在任务中心人工核对。', 'SUBMISSION_UNKNOWN');
    submission.jobId = found.id; await persist(); return found;
  }
  check(submission.input, '缺少持久化任务输入快照。');
  submission.dispatchedAt = new Date().toISOString(); await persist();
  try {
    const { job } = await api<{ job: BackgroundJob }>('/api/jobs', 'POST', submission.input);
    submission.jobId = job.id; await persist(); return job;
  } catch (error) {
    // Only a read by the already committed key is permitted after a lost acknowledgement.
    const found = await lookup(submission).catch(() => undefined);
    if (!found) throw new CheckError('任务提交响应未确认，已保留原幂等键；不会盲目重建或重发付费任务。', 'SUBMISSION_UNKNOWN');
    submission.jobId = found.id; await persist(); return found;
  }
}
function assetTarget(route: string) {
  const url = new URL(route, base);
  check(url.origin === base && url.pathname.startsWith('/api/render-assets/') && !url.username && !url.password, '成品地址不属于本机成品接口。'); return url;
}
async function readAsset(route: string) {
  const response = await fetch(assetTarget(route), { redirect: 'error', signal: AbortSignal.any([timeout, AbortSignal.timeout(60_000)]) });
  check(response.ok, `成品读取失败 HTTP ${response.status}。`, `ARTIFACT_${response.status}`);
  check(response.body, '成品响应为空。'); const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const { done, value } = await reader.read(); if (value) { length += value.byteLength; check(length <= 100_000_000, '本机成品超过验收读取大小限制。'); chunks.push(value); } if (done) break; } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  check(length, '成品文件为空。'); const bytes = Buffer.concat(chunks); return { bytes, http: response.status, type: response.headers.get('content-type'), sha256: createHash('sha256').update(bytes).digest('hex') };
}
async function verifyBundle(bundle: RenderBundle) {
  if (session!.verifiedBundles[bundle.id]) return;
  check(bundle.publication === 'released' && bundle.reviewStatus !== 'blocked', '渠道尚未获得独立导出资格。');
  const files = path.join(directory, 'artifacts', bundle.platform); await mkdir(files, { recursive: true, mode: 0o700 });
  const checked: BundleCheck = { platform: bundle.platform, bundleId: bundle.id, publication: bundle.publication, reviewStatus: bundle.reviewStatus, expiresAt: bundle.expiresAt, checkedAt: new Date().toISOString(), artifacts: [], canva: (bundle.externalDesigns || []).map(design => ({ id: design.id, status: design.status, contentHash: design.contentHash })) };
  if (bundle.platform !== 'moments') check(checked.canva.length && checked.canva.every(design => design.status === 'exported' && !!design.contentHash), '渠道缺少真实 Canva 内容核对、实际编辑与导出记录。', 'CANVA_PROOF_MISSING');
  else check(!checked.canva.length, '朋友圈不应创建 Canva 文字拼图。');
  const images = bundle.artifacts.filter(artifact => artifact.format !== 'wechat-richtext');
  check(bundle.platform === 'xiaohongshu' ? images.length >= 3 && images.length <= 6 : bundle.platform === 'moments' ? images.length >= 1 && images.length <= 3 : bundle.platform === 'poster' ? images.length === 1 : images.length >= 1, '渠道图片数量不符合制作要求。');
  if (bundle.platform === 'wechat') check(bundle.artifacts.some(artifact => artifact.format === 'wechat-richtext'), '公众号缺少可复制 HTML 正文。');
  for (const [index, artifact] of bundle.artifacts.entries()) {
    const preview = await readAsset(artifact.previewUrl); check(artifact.downloadUrl, '已通过渠道缺少正式下载地址。');
    const download = await readAsset(artifact.downloadUrl); check(download.sha256 === preview.sha256, '预览与正式下载文件内容不一致。');
    let dimensions: { width?: number; height?: number; format?: string } | undefined;
    if (artifact.format === 'wechat-richtext') {
      const html = preview.bytes.toString('utf8'); check(!/审核中[，,]\s*仅供预览|发布前复核|review-watermark|审核状态[：:]/i.test(html), '公众号正文仍有审核标签。');
      check(/<(?:section|p|h[1-6])\b/i.test(html), '公众号正文不是可读的 HTML 排版。');
    } else {
      const sharp = (await import('sharp')).default; const metadata = await sharp(preview.bytes).metadata();
      dimensions = { width: metadata.width, height: metadata.height, format: metadata.format };
      check(['png', 'jpeg', 'webp'].includes(metadata.format || '') && metadata.width && metadata.height, '成品无法解析为有效图片。');
      if (bundle.platform === 'moments') check(artifact.format === 'original' && artifact.sourceImageIds.length === 1, '朋友圈没有直接交付精选原图。');
      else {
        const [width, height] = bundle.platform === 'wechat' ? [1200, 510] : bundle.platform === 'poster' ? [1080, 1920] : [1080, 1440];
        check(metadata.width === width && metadata.height === height, '渠道成品画幅不符合约定。');
      }
    }
    const filename = `${index + 1}.${artifact.format === 'wechat-richtext' ? 'html' : dimensions?.format === 'jpeg' ? 'jpg' : dimensions?.format || 'png'}`;
    await writeFile(path.join(files, filename), preview.bytes, { mode: 0o600 });
    checked.artifacts.push({ format: artifact.format, role: artifact.role, http: preview.http, downloadHttp: download.http, bytes: preview.bytes.length, sha256: preview.sha256, dimensions, filename });
  }
  check(bundle.zipUrl, '通过渠道缺少成品与来源附件 ZIP。'); const zip = await readAsset(bundle.zipUrl); const { unzipSync } = await import('fflate');
  let unpacked = 0; const entries = unzipSync(zip.bytes, { filter: entry => { unpacked += entry.originalSize; check(unpacked <= 150_000_000, '成品 ZIP 解压体积异常。'); return true; } });
  check(Object.keys(entries).length >= 2, '成品 ZIP 缺少正文或来源附件。');
  checked.zip = { http: zip.http, bytes: zip.bytes.length, sha256: zip.sha256, files: Object.keys(entries).length };
  await writeFile(path.join(files, 'delivery.zip'), zip.bytes, { mode: 0o600 });
  session!.verifiedBundles[bundle.id] = checked; await persist();
}
async function waitFor(submission: Submission, kind: 'outline' | 'generation') {
  let previous = ''; let job = await submitOnce(submission); let readFailures = 0;
  while (true) {
    timeout.throwIfAborted();
    session![kind === 'outline' ? 'outlineCalls' : 'generationCalls'] = job.calls;
    if (kind === 'generation') {
      const elapsed = Date.now() - Date.parse(session!.generationStartedAt!);
      if (session!.firstReviewedCopyMs === undefined && job.channels.some(channel => channel.delivery?.copyText && channel.delivery.review.status !== 'blocked')) session!.firstReviewedCopyMs = elapsed;
      if (session!.firstVisualPreviewMs === undefined && job.renderBundles.some(bundle => bundle.artifacts.length)) session!.firstVisualPreviewMs = elapsed;
      if (session!.firstReadyDeliveryMs === undefined && job.channels.some(channel => channel.delivery?.status === 'ready')) session!.firstReadyDeliveryMs = elapsed;
      for (const bundle of job.renderBundles) if (bundle.publication === 'released') await verifyBundle(bundle);
    }
    await persist(); await atomic(path.join(directory, `${kind}-job.json`), job);
    const state = JSON.stringify(job.channels.map(channel => [channel.platform, channel.stage, channel.status]));
    if (state !== previous) { previous = state; console.log(JSON.stringify({ phase: kind, status: job.status, observedElapsedMs: Date.now() - invokedAt, channels: job.channels.map(({ platform, stage, status }) => ({ platform, stage, status })) })); }
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 1000));
    try { job = (await api<{ job: BackgroundJob }>(`/api/jobs/${encodeURIComponent(submission.jobId!)}`)).job; readFailures = 0; }
    catch (error) { if (++readFailures >= 3) throw error; /* Only polling is retried; no mutation is replayed. */ }
  }
}
try {
  try { session = JSON.parse(await readFile(sessionPath, 'utf8')) as Session; }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new CheckError('验收状态文件损坏或不可读，已保留原件；不会创建另一组。', 'SESSION_CORRUPT'); }
  if (session) {
    check(session.schemaVersion === 1 && session.base === base && typeof session.outline?.key === 'string' && typeof session.generation?.key === 'string' && session.verifiedBundles && Array.isArray(session.outlineCalls) && Array.isArray(session.generationCalls), '已有验收状态不兼容或服务地址已变化，未新建任务。', 'SESSION_MISMATCH');
    check(session.outline.input?.kind === 'outline' && session.outline.input.idempotencyKey === session.outline.key && (!session.generation.input || session.generation.input.kind === 'generate' && session.generation.input.idempotencyKey === session.generation.key), '已有任务输入快照不兼容，未覆盖原记录。', 'SESSION_CORRUPT');
    if (productId) check(session.product?.id === productId, '此验收组已绑定另一产品，不能重建付费任务。');
    if (session.completedAt) { report.success = true; report.alreadyCompleted = true; report.completedAt = session.completedAt; console.log(JSON.stringify({ phase: 'already-completed', summary: summaryPath })); process.exitCode = 0; }
  }
  if (!session?.completedAt) {
    const hadOutlineForApproval = !!session?.outlineReadyAt;
    check(!args.includes('--confirm-outline') || hadOutlineForApproval, '请先运行 --execute 生成大纲并阅读 outline.json，再使用 --confirm-outline。未开始付费调用。');
    const status = await api<AppStatus>('/api/status');
    check(status.model.configured && status.model.name === 'gpt-6.1-sol' && status.model.baseUrl === 'https://relay.nccnxta.cn/v1', '文本网关或 gpt-6.1-sol 尚未正确配置。');
    check(status.image?.configured && status.image.name === 'gpt-image-2.5' && status.image.baseUrl === 'https://relay.styxgate.top/v1', '独立生图网关或精确模型标识尚未正确配置。');
    check(status.canva?.configured && status.canva.connected, '请先完成 Canva 开发应用配置和账号 OAuth 授权。');
    check(status.local.available, '缺少授权本地产品资料。');
    const verified = await api<{ connected: boolean; tools: string[] }>('/api/integrations/canva/verify', 'POST', {});
    check(verified.connected && ['get-design-content', 'perform-editing-operations', 'export-design'].every(tool => verified.tools.includes(tool)), 'Canva MCP 真实连接或编辑导出工具尚未可用。');
    report.config = { model: status.model.name, textBase: status.model.baseUrl, imageModel: status.image.name, imageBase: status.image.baseUrl, canvaMcpVerified: true, canvaTools: verified.tools };
    if (!session) {
      const { products } = await api<{ products: Product[] }>('/api/products');
      const available = products.filter(product => product.imageCount >= 1);
      const preferred = available.find(product => /matebookpros/i.test(product.name.replace(/[^a-z0-9]/gi, '')));
      const product = productId ? available.find(product => product.id === productId) : preferred || available[0];
      check(product, '未找到具有有效同型号原图的本地产品，未开始模型调用。');
      const key = randomUUID();
      const input: JobSubmit = { kind: 'outline', idempotencyKey: key, brief: { productId: product.id, audience: '大学新生', scene: '开学季电脑选购', goal: '到店体验', buyingStage: '对比选择', platforms: [...PLATFORMS], mode: 'live', knowledgeSource: 'local', instructions: '严格使用本次同型号资料和原图，完整保留所用事实的适用条件。不写未经核实的价格、权益、亲测经历或客户故事。小红书按信息分组形成3–6页并单独设计封面；公众号正文适合手机阅读；朋友圈保持自然短文与1–3张原图；海报只突出一个核心信息和行动引导。标题、导语、段落标题与CTA采用到店核对的选购建议，避免参数堆砌或性能保证。' } };
      session = { schemaVersion: 1, base, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), outline: { key, input }, generation: { key: randomUUID() }, product: { id: product.id, name: product.name }, outlineCalls: [], generationCalls: [], verifiedBundles: {} };
      await persist();
    }
    phase = 'outline'; const planned = await waitFor(session.outline, 'outline');
    check(planned.status === 'completed' && planned.outline, planned.error?.message || '大纲步骤未完成；未重试或创建新任务。', planned.error?.code || 'OUTLINE_INCOMPLETE');
    await atomic(path.join(directory, 'outline.json'), planned.outline);
    if (!session.outlineReadyAt) { session.outlineReadyAt = new Date().toISOString(); await persist(); }
    if (!session.approvedVersion && !args.includes('--confirm-outline')) {
      report.awaitingOutlineApproval = true; report.outlineSnapshot = path.join(directory, 'outline.json');
      console.log('大纲已保存。请阅读 output/visual-verification/outline.json，确认后使用相同命令追加 --confirm-outline；不会重新生成大纲。');
    } else {
      phase = 'confirm'; const latest = await api<OutlineResult>(`/api/outlines/${encodeURIComponent(planned.outline.id)}`);
      if (!session.approvedVersion) { session.approvedVersion = latest.version; session.approvedAt = new Date().toISOString(); await atomic(path.join(directory, 'approved-outline.json'), latest); await persist(); }
      check(latest.version === session.approvedVersion, '已批准大纲版本发生变化，需要人工核对；未调用正文模型。');
      const confirmed = latest.status === 'confirmed' ? latest : await api<OutlineResult>(`/api/outlines/${encodeURIComponent(latest.id)}/confirm`, 'POST', { version: session.approvedVersion });
      check(confirmed.status === 'confirmed' && confirmed.version === session.approvedVersion, '大纲确认版本不一致。');
      phase = 'generation';
      if (!session.generation.input) { session.generation.input = { kind: 'generate', idempotencyKey: session.generation.key, outlineId: confirmed.id, version: confirmed.version }; session.generationStartedAt = new Date().toISOString(); await persist(); }
      const completed = await waitFor(session.generation, 'generation');
      report.channels = completed.channels.map(channel => ({ platform: channel.platform, status: channel.status, stage: channel.stage, review: channel.delivery?.review, error: channel.error, deliveryId: channel.deliveryId }));
      check(completed.status === 'completed' && completed.result, completed.error?.message || '至少一个渠道尚未完成；已保留检查点，未自动重试。', completed.error?.code || 'GENERATION_INCOMPLETE');
      check(completed.result.outline?.id === confirmed.id && completed.result.outline.version === confirmed.version && completed.result.drafts.length === 4 && PLATFORMS.every(platform => completed.result!.drafts.some(draft => draft.platform === platform)), '完整稿件集与人工确认的大纲版本不一致。');
      for (const platform of PLATFORMS) {
        const channel = completed.channels.find(channel => channel.platform === platform); check(channel?.deliveryId, '渠道缺少独立交付引用。');
        const { delivery } = await api<{ delivery: ChannelDelivery }>(`/api/deliveries/${channel.deliveryId}`);
        check(delivery.status === 'ready' && delivery.review.reviewedBy === 'rules+model' && delivery.bundle, '渠道未完成独立模型审稿或正式视觉交付。'); await verifyBundle(delivery.bundle);
      }
      const imageCalls = session.generationCalls.filter(call => call.stage === 'image');
      check(imageCalls.length === 2 && imageCalls.every(call => call.outcome === 'succeeded') && !imageCalls.some(call => call.platform === 'moments'), '正常四渠道流程没有恰好复用两份成功 AI 素材；请核对调用记录，未补发任何请求。', 'IMAGE_CALL_COUNT');
      session.completedAt = new Date().toISOString(); await persist(); report.success = true; report.outlineBindingVerified = true;
    }
  }
} catch (error) {
  report.failedPhase = phase; report.failure = { code: error instanceof CheckError ? error.code : error instanceof Error ? error.name : 'UNKNOWN', message: safe(error instanceof Error ? error.message : 'verification_failed') };
  console.error(JSON.stringify({ phase: 'stopped', failedPhase: phase, ...(report.failure as object), resume: 'npx tsx scripts/verify-visual-workflow.ts --execute' }));
  process.exitCode = 1;
} finally {
  try { if (session && Array.isArray(session.outlineCalls) && Array.isArray(session.generationCalls) && session.outline && session.generation && session.verifiedBundles) {
    const calls = [...session.outlineCalls, ...session.generationCalls];
    Object.assign(report, { createdAt: session.createdAt, totalObservedMs: Date.now() - Date.parse(session.createdAt), invocationMs: Date.now() - invokedAt,
      firstReviewedCopyMs: session.firstReviewedCopyMs, firstVisualPreviewMs: session.firstVisualPreviewMs, firstReadyDeliveryMs: session.firstReadyDeliveryMs,
      outlineJobId: session.outline.jobId, generationJobId: session.generation.jobId, httpAttempts: calls.length, textHttpAttempts: calls.filter(call => call.stage !== 'image').length, imageHttpAttempts: calls.filter(call => call.stage === 'image').length,
      repairAttempts: calls.filter(call => call.stage === 'repair').length, calls: calls.map(call => ({ ...call, usage: call.usage || 'unknown' })), bundles: Object.values(session.verifiedBundles), manualVisualInspection: 'pending' });
    if (!report.alreadyCompleted) await atomic(summaryPath, report);
  } else await atomic(summaryPath, { ...report, invocationMs: Date.now() - invokedAt }); }
  finally { await rm(lockPath, { force: true }); }
  console.log(JSON.stringify({ phase: 'finished', success: report.success, awaitingOutlineApproval: report.awaitingOutlineApproval || false, firstReadyDeliveryMs: session?.firstReadyDeliveryMs, summary: summaryPath, manualVisualInspection: 'pending' }));
}
