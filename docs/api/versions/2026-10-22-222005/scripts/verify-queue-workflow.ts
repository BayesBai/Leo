/** One paid four-channel cold run. No automatic retry endpoint, including outcome-unknown failures. */
import dotenv from 'dotenv';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PLATFORMS, type BackgroundJob, type Product } from '../shared/types.js';
dotenv.config({ path: '.env.local', quiet: true } as dotenv.DotenvConfigOptions); dotenv.config({ quiet: true } as dotenv.DotenvConfigOptions);
process.env.AGENT_STATE_DIR = path.resolve('.local-state', `queue-verification-${Date.now()}`);
process.env.AGENT_RENDER_DIR = path.join(process.env.AGENT_STATE_DIR, 'render');
const { createApp } = await import('../server/index.js');
const { closeStateStore } = await import('../server/state-store.js');
const { modelConfig, DEFAULT_MODEL_BASE_URL, DEFAULT_MODEL_NAME } = await import('../server/model.js');
const { closeRenderRuntime } = await import('../server/render/layouts.js');
const config = modelConfig();
if (!config.configured || config.name !== DEFAULT_MODEL_NAME || config.baseUrl !== DEFAULT_MODEL_BASE_URL) throw new Error('请先在本机配置指定模型与网关。');
const began = Date.now(); let phase = 'startup'; const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), model: config.name, baseUrl: config.baseUrl, coldState: true, success: false, imaCalled: false, firstPreviewMs: null };
const app = await createApp({ apiOnly: true }); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const signal = AbortSignal.timeout(15 * 60_000); const allCalls: BackgroundJob['calls'] = [];
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(base + url, { signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(value.message || `HTTP ${response.status}`); return value;
}
async function wait(id: string) {
  let last = '';
  while (true) {
    signal.throwIfAborted(); const { job } = await api<{ job: BackgroundJob }>(`/api/jobs/${id}`);
    const state = JSON.stringify(job.channels.map(c => [c.platform, c.stage, c.status]));
    if (state !== last) { last = state; console.log(JSON.stringify({ phase, elapsedMs: Date.now() - began, status: job.status, channels: job.channels.map(c => ({ platform: c.platform, stage: c.stage, status: c.status })) })); }
    if (job.renderBundles.length && report.firstPreviewMs === null) report.firstPreviewMs = Date.now() - began;
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) { allCalls.push(...job.calls); return job; }
    await new Promise(r => setTimeout(r, 1000));
  }
}
try {
  const { products } = await api<{ products: Product[] }>('/api/products');
  const product = products.find(p => /MateBook 14/.test(p.name) && /鸿蒙|HarmonyOS/.test(p.name + p.system) && p.imageCount >= 4) || products.find(p => p.imageCount >= 4);
  if (!product) throw new Error('缺少授权本地资料与四渠道图片。');
  phase = 'outline'; const submitted = await api<{ job: BackgroundJob }>('/api/jobs', { idempotencyKey: randomUUID(), kind: 'outline', brief: { productId: product.id, audience: '大学新生', scene: '开学购机', goal: '到店体验', buyingStage: '对比选择', platforms: [...PLATFORMS], mode: 'live', knowledgeSource: 'local', instructions: '完整保留所用事实的适用条件。不写价格、补贴、亲测或虚构客户。保持各渠道表达简洁，每段只选最相关的一条依据，必要限制优先于字数。标题、段落标题、导语与CTA不写参数或性能保证，采用到店核对的选购建议。' } });
  const planned = await wait(submitted.job.id); report.outlineMs = Date.now() - began;
  if (planned.status !== 'completed' || !planned.outline) throw new Error(planned.error?.message || '大纲任务未完成');
  phase = 'confirm'; const outline = planned.outline; await api(`/api/outlines/${outline.id}/confirm`, { version: outline.version });
  phase = 'generate'; const generationBegan = Date.now(); const generated = await api<{ job: BackgroundJob }>('/api/jobs', { idempotencyKey: randomUUID(), kind: 'generate', outlineId: outline.id, version: outline.version });
  const completed = await wait(generated.job.id); report.generateMs = Date.now() - generationBegan;
  report.jobStatus = completed.status; report.channels = completed.channels.map(c => ({ platform: c.platform, status: c.status, stage: c.stage, error: c.error && { code: c.error.code, upstreamStatus: c.error.upstreamStatus, outcomeUnknown: c.error.outcomeUnknown, retryable: c.error.retryable } }));
  if (!completed.result) throw new Error(completed.error?.message || '未完成全部渠道终审，未发布正式成稿。');
  report.review = { status: completed.result.review.status, reviewedBy: completed.result.review.reviewedBy, issues: completed.result.review.issues.map(i => ({ severity: i.severity, category: i.category, platform: i.platform, target: i.target, resolution: i.resolution })) };
  report.outlineBindingVerified = completed.result.outline?.id === outline.id && completed.result.outline.version === outline.version;
  const artifacts = [];
  for (const bundle of completed.renderBundles) {
    const reads = [];
    for (const a of bundle.artifacts) {
      const r = await fetch(base + a.previewUrl, { signal }); const data = Buffer.from(await r.arrayBuffer());
      let actualSize: { width?: number; height?: number } | undefined;
      if (a.format === 'png') { const sharp = (await import('sharp')).default; const meta = await sharp(data).metadata(); actualSize = { width: meta.width, height: meta.height }; }
      const download = await fetch(base + (a.downloadUrl || a.previewUrl + '?download=1'), { signal });
      reads.push({ format: a.format, previewHttp: r.status, bytes: data.length, downloadHttp: download.status, downloadBytes: (await download.arrayBuffer()).byteLength, actualSize });
    }
    let zip; if (bundle.zipUrl) { const r = await fetch(base + bundle.zipUrl, { signal }); const data = new Uint8Array(await r.arrayBuffer()); const { unzipSync } = await import('fflate'); zip = { http: r.status, bytes: data.length, files: Object.keys(unzipSync(data)).length }; }
    artifacts.push({ platform: bundle.platform, publication: bundle.publication, artifacts: reads, zip });
  }
  report.artifacts = artifacts; report.success = completed.status === 'completed' && completed.result.drafts.length === 4 && completed.renderBundles.length === 4 && !!report.outlineBindingVerified;
  report.runtimePointers = undefined; // Never include local record IDs or resource URLs in the summary.
} catch (error) { report.failedPhase = phase; report.error = error instanceof Error ? error.message : 'verification_failed'; }
finally {
  report.elapsedMs = Date.now() - began; report.httpAttempts = allCalls.length;
  report.calls = allCalls.map(({ id: _id, requestId: _requestId, queuedAt: _queuedAt, startedAt: _startedAt, endedAt: _endedAt, ...call }) => ({ ...call, usage: call.usage || 'unknown' }));
  report.repairAttempts = allCalls.filter(c => c.stage === 'repair').length;
  await mkdir('output/queue-verification', { recursive: true }); await writeFile('output/queue-verification/summary.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ phase: 'finished', success: report.success, elapsedMs: report.elapsedMs, httpAttempts: report.httpAttempts, firstPreviewMs: report.firstPreviewMs, failedPhase: report.failedPhase }));
  server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await closeRenderRuntime(); closeStateStore();
  if (!report.success) process.exitCode = 1;
}
