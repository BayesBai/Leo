import dotenv from 'dotenv';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createWorkflowClient } from '../src/api/client.js';
import { PLATFORMS, type AppStatus, type OutlineResult, type Product, type RenderBundle, type RunResult } from '../shared/types.js';
dotenv.config({ path: '.env.local' }); dotenv.config();
process.env.AGENT_STATE_DIR ||= path.resolve('.local-state', `verification-${Date.now()}`);
const { modelConfig, DEFAULT_MODEL_BASE_URL, DEFAULT_MODEL_NAME } = await import('../server/model.js');
const { createApp } = await import('../server/index.js');
const { closeStateStore } = await import('../server/state-store.js');
const config = modelConfig();
if (config.baseUrl !== DEFAULT_MODEL_BASE_URL || config.name !== DEFAULT_MODEL_NAME || !config.configured) throw new Error(`请先在本机配置 ${DEFAULT_MODEL_BASE_URL} 和 ${DEFAULT_MODEL_NAME} 的有效 Key。`);
const app = await createApp({ apiOnly: true }); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const client = createWorkflowClient((url, init) => fetch(new URL(url, base), init));
const began = Date.now(); let phase = 'status';
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), endpoint: `${config.baseUrl}/chat/completions`, model: config.name, source: 'local', success: false, imaCalled: false };
const signal = AbortSignal.timeout(15 * 60_000);
const stages: { phase: string; elapsedMs: number }[] = []; report.stages = stages;
class VerificationError extends Error {}
function check(condition: unknown, reason: string): asserts condition { if (!condition) throw new VerificationError(reason); }
function samePlatforms(values: readonly string[]) { return values.length === PLATFORMS.length && new Set(values).size === PLATFORMS.length && PLATFORMS.every(p => values.includes(p)); }
async function stage<T>(name: string, action: () => Promise<T>): Promise<T> {
  phase = name; const start = Date.now(); console.log(JSON.stringify({ phase: name, status: 'running', elapsedMs: start - began }));
  const result = await action(); const elapsedMs = Date.now() - start; stages.push({ phase: name, elapsedMs });
  console.log(JSON.stringify({ phase: name, status: 'done', stageElapsedMs: elapsedMs, elapsedMs: Date.now() - began })); return result;
}
async function readArtifact(url: string, expectedHttp: number) {
  const target = new URL(url, base); check(target.origin === base && target.pathname.startsWith('/api/render-assets/'), 'unexpected_artifact_url');
  const response = await fetch(target, { signal, redirect: 'error' }); const bytes = (await response.arrayBuffer()).byteLength;
  check(response.status === expectedHttp && bytes > 0, 'artifact_http_or_empty_body'); return { http: response.status, bytes };
}
try {
  const status = await stage('status', () => client.api<AppStatus>('/api/status')); report.local = status.local;
  check(status.model.baseUrl === config.baseUrl && status.model.name === config.name && status.model.configured, 'runtime_model_mismatch');
  const { products } = await client.api<{ products: Product[] }>('/api/products');
  const product = products.find(p => /MateBook 14/.test(p.name) && /鸿蒙|HarmonyOS/.test(p.name + p.system) && p.imageCount >= 4) || products.find(p => p.imageCount >= 4);
  if (!product) throw new Error('缺少可供四渠道联调的授权本地资料及原图。');
  let outline = await stage('outline', () => client.api<OutlineResult>('/api/outlines', 'POST', { productId: product.id, audience: '大学新生', scene: '开学购机', goal: '到店体验', buyingStage: '对比选择', platforms: [...PLATFORMS], instructions: '完整保留事实中的适用条件。不写价格、补贴、亲测经历或虚构客户故事。各渠道表达简洁，符合渠道图片数量和文字容量。', mode: 'live', knowledgeSource: 'local' }, signal));
  check(samePlatforms(outline.platforms.map(p => p.platform)), 'outline_platforms_mismatch');
  const originalId = outline.id; const originalVersion = outline.version;
  outline = await stage('outline-revise', () => client.api<OutlineResult>(`/api/outlines/${outline.id}/revise`, 'POST', { version: outline.version, instructions: '保留各渠道结构及事实限定条件，精简重复的写作要点。' }, signal));
  check(outline.id === originalId && outline.version > originalVersion && samePlatforms(outline.platforms.map(p => p.platform)), 'revised_outline_binding_mismatch');
  const confirmed = await stage('confirm', () => client.api<OutlineResult>(`/api/outlines/${outline.id}/confirm`, 'POST', { version: outline.version }, signal));
  check(confirmed.id === outline.id && confirmed.version === outline.version && confirmed.status === 'confirmed', 'confirmed_outline_binding_mismatch');
  const pipelineStates = new Map<string, string>(); let repairExecuted = false; let reviewStarted = false;
  const result: RunResult = await stage('generate', () => client.generateFromOutline(outline.id, outline.version, signal, e => {
    if (e.step === 'repair' && e.status === 'running') repairExecuted = true;
    if (e.step === 'review' && e.status === 'running') reviewStarted = true;
    if (pipelineStates.get(e.step) === e.status) return;
    pipelineStates.set(e.step, e.status); console.log(JSON.stringify({ phase: `generate:${e.step}`, status: e.status, elapsedMs: Date.now() - began, pipelineElapsedMs: e.elapsedMs }));
  }));
  check(result.outline?.id === outline.id && result.outline.version === outline.version && samePlatforms(result.drafts.map(d => d.platform)) && samePlatforms(result.strategies.map(s => s.platform)), 'run_outline_or_platforms_mismatch');
  report.outlineBindingVerified = true; report.reviewExecuted = reviewStarted && result.review.reviewedBy === 'rules+model'; report.repairExecuted = repairExecuted;
  check(report.reviewExecuted, 'model_review_not_executed');
  report.reviewStatus = result.review.status; report.reviewedBy = result.review.reviewedBy; report.draftCount = result.drafts.length;
  report.issues = result.review.issues.map(i => ({ severity: i.severity, category: i.category, target: i.target, resolution: i.resolution, platform: i.platform }));
  const templates = { xiaohongshu: 'xhs-cream', wechat: 'wechat-editorial', moments: 'moments-square', poster: 'poster-paper' };
  const renders: unknown[] = []; report.renders = renders;
  for (const draft of result.drafts) {
    await stage(`render-${draft.platform}`, async () => {
      const bundle = await client.api<RenderBundle>('/api/render', 'POST', { runId: result.id, revision: result.revision, platform: draft.platform, selectedTitleIndex: 0, templateId: templates[draft.platform] }, signal);
      check(bundle.runId === result.id && bundle.revision === result.revision && bundle.platform === draft.platform && bundle.reviewStatus === result.review.status && bundle.artifacts.length > 0, 'render_binding_or_artifacts_mismatch');
      const blocked = result.review.status === 'blocked'; const artifacts = [];
      for (const a of bundle.artifacts) {
        const preview = await readArtifact(a.previewUrl, 200);
        if (blocked) check(!a.downloadUrl, 'blocked_download_url_exposed'); else check(a.downloadUrl, 'download_url_missing');
        const downloadUrl = a.downloadUrl || `${a.previewUrl}?download=1`;
        const download = await readArtifact(downloadUrl, blocked ? 409 : 200);
        artifacts.push({ format: a.format, ...preview, downloadHttp: download.http, downloadBytes: download.bytes, width: a.width, height: a.height });
      }
      let zip: { http: number; bytes: number } | undefined;
      if (blocked) check(!bundle.zipUrl, 'blocked_zip_exposed');
      else { check(bundle.zipUrl, 'zip_url_missing'); zip = await readArtifact(bundle.zipUrl, 200); }
      renders.push({ platform: draft.platform, artifacts, zip, downloadGateVerified: blocked });
    });
  }
  report.workflowCompleted = true; report.publicationPassed = result.review.status === 'passed'; report.exportAllowed = result.review.status !== 'blocked'; report.success = true;
} catch (error) {
  const e = error as Error & { status?: number; code?: string; kind?: string };
  report.failure = { phase, http: e.status, code: e.code, kind: e.kind, upstreamHttp: /\bHTTP\s+(\d{3})\b/.exec(e.message)?.[1], reason: e instanceof VerificationError ? e.message : e.name === 'AbortError' || e.name === 'TimeoutError' ? 'operation_aborted_or_timed_out' : 'request_failed' };
  process.exitCode = 1;
} finally {
  report.elapsedMs = Date.now() - began;
  await mkdir('output/relay-verification', { recursive: true });
  await writeFile('output/relay-verification/summary.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeStateStore();
}
