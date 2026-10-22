import dotenv from 'dotenv';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createWorkflowClient } from '../src/api/client.js';
import type { AppStatus, OutlineResult, Product, RenderBundle, RunResult } from '../shared/types.js';
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
try {
  const status = await client.api<AppStatus>('/api/status'); report.local = status.local;
  const { products } = await client.api<{ products: Product[] }>('/api/products');
  const product = products.find(p => /MateBook 14/.test(p.name) && /鸿蒙|HarmonyOS/.test(p.name + p.system) && p.imageCount >= 4) || products.find(p => p.imageCount >= 4);
  if (!product) throw new Error('缺少可供四渠道联调的授权本地资料及原图。');
  phase = 'outline'; console.log(JSON.stringify({ phase, elapsedMs: Date.now() - began }));
  let outline = await client.api<OutlineResult>('/api/outlines', 'POST', { productId: product.id, audience: '大学新生', scene: '开学购机', goal: '到店体验', buyingStage: '对比选择', platforms: ['xiaohongshu', 'wechat', 'moments', 'poster'], instructions: '完整保留事实中的适用条件。不写价格、补贴、亲测经历或虚构客户故事。各渠道表达简洁，符合渠道图片数量和文字容量。', mode: 'live', knowledgeSource: 'local' }, signal);
  phase = 'outline-revise'; outline = await client.api<OutlineResult>(`/api/outlines/${outline.id}/revise`, 'POST', { version: outline.version, instructions: '保留各渠道结构及事实限定条件，精简重复的写作要点。' }, signal);
  phase = 'confirm'; await client.api(`/api/outlines/${outline.id}/confirm`, 'POST', { version: outline.version }, signal);
  phase = 'generate'; const result: RunResult = await client.generateFromOutline(outline.id, outline.version, signal, e => { if (e.status === 'done') console.log(JSON.stringify({ phase: e.step, elapsedMs: Date.now() - began })); });
  report.reviewStatus = result.review.status; report.reviewedBy = result.review.reviewedBy; report.draftCount = result.drafts.length;
  report.issues = result.review.issues.map(i => ({ severity: i.severity, category: i.category, target: i.target, resolution: i.resolution, platform: i.platform }));
  const templates = { xiaohongshu: 'xhs-cream', wechat: 'wechat-editorial', moments: 'moments-square', poster: 'poster-paper' };
  const renders: unknown[] = []; report.renders = renders;
  for (const draft of result.drafts) {
    phase = `render-${draft.platform}`;
    const bundle = await client.api<RenderBundle>('/api/render', 'POST', { runId: result.id, revision: result.revision, platform: draft.platform, selectedTitleIndex: 0, templateId: templates[draft.platform] }, signal);
    const artifacts = [];
    for (const a of bundle.artifacts) { const r = await fetch(new URL(a.previewUrl, base), { signal }); const bytes = await r.arrayBuffer(); artifacts.push({ format: a.format, http: r.status, bytes: bytes.byteLength, width: a.width, height: a.height }); }
    let zipHttp: number | undefined; if (bundle.zipUrl) { const r = await fetch(new URL(bundle.zipUrl, base), { signal }); zipHttp = r.status; await r.arrayBuffer(); }
    renders.push({ platform: draft.platform, artifacts, zipHttp });
  }
  report.success = true;
} catch (error) {
  const e = error as Error & { status?: number; code?: string; kind?: string };
  report.failure = { phase, http: e.status, code: e.code, kind: e.kind, message: e.message };
  process.exitCode = 1;
} finally {
  report.elapsedMs = Date.now() - began;
  await mkdir('output/relay-verification', { recursive: true });
  await writeFile('output/relay-verification/summary.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeStateStore();
}
