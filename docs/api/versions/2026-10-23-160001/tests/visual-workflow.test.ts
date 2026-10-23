import { imageConfigurationHash } from '../server/image-binding.js';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import type { Brief, Draft, Platform, ReviewReport, RunResult, RenderRequest } from '../shared/types.js';
import { listProducts } from '../server/knowledge.js';
import { createOutline, confirmOutline, confirmedOutline } from '../server/outlines.js';
import { saveDelivery, deliveryRenderSource } from '../server/deliveries.js';
import { stateStore } from '../server/state-store.js';
import { beginCanvaConnection, completeCanvaConnection } from '../server/integrations/canva.js';
import { renderVisualDelivery } from '../server/visual-workflow.js';
import type { JobContext, StoredJob } from '../server/job-store.js';
import { getRenderAsset } from '../server/render/index.js';
import { canvaMetadataResponse } from './fixtures/canva-metadata.js';

const nativeFetch = globalThis.fetch;
const envNames = ['IMAGE_API_KEY', 'IMAGE_BASE_URL', 'IMAGE_MODEL', 'CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET', 'CANVA_REDIRECT_URI'] as const;
const originalEnv = Object.fromEntries(envNames.map(key => [key, process.env[key]]));
const platforms: Platform[] = ['xiaohongshu', 'wechat', 'moments', 'poster'];
interface Design {
  id: string;
  texts: { element_id: string; page_index: number; regions: { type: string; text: string }[] }[];
  fills: { type: string; asset_id: string; element_id: string; page_index: number; editable: boolean }[];
  pages: { page_id: string; page_number: number; dimension: { width: number; height: number }; is_editable: boolean }[];
}
let calls: { url: string; method?: string; name?: string; data?: any }[];
let designs: Map<string, Design>;
let imports: Map<string, Design>;
let transactions: Map<string, Design>;
let exportBytes: Map<string, Buffer>;
let generated: Buffer;
let exported: Buffer;
let failedContentReads: number;
let failedImageRequests: number;
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }); }
function rpc(id: number, data: unknown) { return json({ jsonrpc: '2.0', id, result: { structuredContent: data } }); }
const decodeXml = (value: string) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function importedDesign(bytes: Uint8Array): Design {
  const archive = unzipSync(bytes); const id = `design-${designs.size + 1}`;
  const names = Object.keys(archive).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const design: Design = { id, texts: [], fills: [], pages: [] };
  assert.ok(names.length, 'the actual imported file must be a PPTX with independently readable slides');
  names.forEach((name, index) => {
    const xml = Buffer.from(archive[name]).toString('utf8');
    design.pages.push({ page_id: `${id}-p${index + 1}`, page_number: index + 1, dimension: { width: 1080, height: 1440 }, is_editable: true });
    for (const match of xml.matchAll(/<p:sp>[^]*?<\/p:sp>/g)) {
      const text = [...match[0].matchAll(/<a:t>([^]*?)<\/a:t>/g)].map(part => decodeXml(part[1])).join('\n');
      if (text) design.texts.push({ element_id: `${id}-t${design.texts.length + 1}`, page_index: index + 1, regions: [{ type: 'character', text }] });
    }
    for (const _match of xml.matchAll(/<p:pic>[^]*?<\/p:pic>/g)) design.fills.push({ type: 'image', asset_id: `${id}-image-${design.fills.length + 1}`, element_id: `${id}-i${design.fills.length + 1}`, page_index: index + 1, editable: true });
  });
  designs.set(id, design); return design;
}
const toolSchemas = [
  ['get-design-content', ['design_id', 'content_types']], ['start-editing-transaction', ['design_id']],
  ['perform-editing-operations', ['transaction_id', 'page_index', 'operations']], ['commit-editing-transaction', ['transaction_id']],
  ['cancel-editing-transaction', ['transaction_id']], ['export-design', ['design_id', 'format']],
] as const;
async function mockFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input); const data = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
  calls.push({ url, method: init?.method, name: data?.params?.name, data });
  const metadata = canvaMetadataResponse(url); if (metadata) return metadata;
  if (url.endsWith('/oauth/token')) return json({ access_token: 'test-canva-access', refresh_token: 'test-canva-refresh', expires_in: 3600 });
  if (url === 'https://api.canva.com/rest/v1/designs?limit=1') return json({ items: [] });
  if (url === 'https://ark.cn-beijing.volces.com/api/v3/images/generations') {
    assert.equal(data.model, 'doubao-seedream-5-0-pro-260628');
    assert.deepEqual(Object.keys(data).sort(), ['model', 'output_format', 'prompt', 'response_format', 'size', 'watermark']);
    assert.equal(data.response_format, 'b64_json'); assert.equal(data.watermark, false); assert.equal(data.output_format, 'png');
    assert.ok(['1024x1536', '1536x1024'].includes(data.size));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer sk-test-image-workflow-key');
    if (failedImageRequests > 0) { failedImageRequests--; throw new Error('synthetic uncertain image connection lost'); }
    return json({ data: [{ b64_json: generated.toString('base64') }], usage: { total_tokens: 11 } });
  }
  if (url === 'https://api.canva.com/rest/v1/imports') {
    const design = importedDesign(new Uint8Array(init?.body as Uint8Array)); const jobId = `import-${imports.size + 1}`; imports.set(jobId, design);
    return json({ job: { id: jobId, status: 'in_progress' } });
  }
  if (url.startsWith('https://api.canva.com/rest/v1/imports/')) {
    const design = imports.get(url.split('/').pop()!)!; assert.ok(design);
    return json({ job: { id: url.split('/').pop(), status: 'success', result: { designs: [{ id: design.id, urls: { edit_url: `https://www.canva.com/design/${design.id}/edit` } }] } } });
  }
  if (url === 'https://api.canva.com/connect/v1/mcp') {
    if (data.method === 'initialize') return json({ jsonrpc: '2.0', id: data.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } } });
    if (data.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (data.method === 'tools/list') return json({ jsonrpc: '2.0', id: data.id, result: { tools: toolSchemas.map(([name, required]) => ({ name, inputSchema: { type: 'object', required: [...required], properties: Object.fromEntries([...required].map(key => [key, key === 'page_index' ? { type: 'integer' } : ['operations', 'content_types'].includes(key) ? { type: 'array' } : { type: 'string' }])) } })) } });
    assert.equal(data.method, 'tools/call'); const { name, arguments: args } = data.params;
    if (name === 'get-design-content') {
      if (failedContentReads > 0) { failedContentReads--; return json({ jsonrpc: '2.0', id: data.id, error: { code: -32000, message: 'synthetic read failure' } }); }
      const design = designs.get(args.design_id)!;
      return rpc(data.id, { id: design.id, text: design.texts.map(item => item.regions.map(region => region.text).join('')).join('\n'), metadata: { page_count: design.pages.length } });
    }
    if (name === 'start-editing-transaction') { const design = designs.get(args.design_id)!; assert.ok(design); const tx = randomUUID(); transactions.set(tx, design); return rpc(data.id, { transaction: { transaction_id: tx, status: 'open' }, richtexts: design.texts, fills: design.fills, pages: design.pages }); }
    if (name === 'perform-editing-operations') {
      const design = transactions.get(args.transaction_id)!;
      for (const operation of args.operations) { const item = design.texts.find(item => item.element_id === operation.element_id)!; assert.ok(item); item.regions = [{ type: 'character', text: operation.text }]; }
      return rpc(data.id, { edit_operation_results: args.operations.map(() => ({ status: 'success' })) });
    }
    if (name === 'commit-editing-transaction') return rpc(data.id, { transaction: { id: args.transaction_id, status: 'committed' } });
    if (name === 'cancel-editing-transaction') return rpc(data.id, { transaction: { id: args.transaction_id, status: 'cancelled' } });
    if (name === 'export-design') {
      const design = designs.get(args.design_id)!;
      const urls = design.pages.map((_, index) => { const address = `https://export-download.canva.com/${design.id}-${index + 1}.png?signature=not-persisted`; exportBytes.set(address, exported); return address; });
      return rpc(data.id, { job: { id: `export-${design.id}`, status: 'success', urls } });
    }
    assert.fail(`unexpected MCP tool ${name}`);
  }
  if (exportBytes.has(url)) { assert.equal(new Headers(init?.headers).has('authorization'), false); return new Response(new Uint8Array(exportBytes.get(url)!), { headers: { 'content-type': 'image/png' } }); }
  assert.fail(`unexpected external request ${url}`);
}
beforeEach(async () => {
  calls = []; designs = new Map(); imports = new Map(); transactions = new Map(); exportBytes = new Map(); failedContentReads = 0; failedImageRequests = 0;
  generated = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#d6e5df' } }).png().toBuffer();
  exported = await sharp({ create: { width: 60, height: 80, channels: 3, background: '#edf2f0' } }).png().toBuffer();
  process.env.IMAGE_API_KEY = 'sk-test-image-workflow-key'; process.env.IMAGE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'; process.env.IMAGE_MODEL = 'doubao-seedream-5-0-pro-260628';
  process.env.CANVA_CLIENT_ID = 'test-canva-workflow'; process.env.CANVA_CLIENT_SECRET = 'test-canva-secret'; process.env.CANVA_REDIRECT_URI = 'http://127.0.0.1:3000/api/integrations/canva/callback';
  stateStore().update(b => { b.canvaCredentials = {}; b.canvaOAuth = {}; b.canvaOperations = {}; b.canvaDesignBaselines = {}; b.creativeMaterials = {}; });
  globalThis.fetch = mockFetch as typeof fetch;
  const url = new URL((await beginCanvaConnection()).authorizationUrl); await completeCanvaConnection({ code: 'test-code', state: url.searchParams.get('state')! });
});
afterEach(() => { globalThis.fetch = nativeFetch; for (const key of envNames) if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; });
async function fixture() {
  const product = (await listProducts())[0];
  const brief: Brief = { productId: product.id, audience: '大学生', scene: '纯模拟开学选择', goal: '预约到店核对', buyingStage: '对比', platforms, instructions: '', mode: 'demo', knowledgeSource: 'local' };
  const planned = await createOutline(brief); confirmOutline(planned.id, planned.version); const outline = confirmedOutline(planned.id, planned.version);
  const review: ReviewReport = { status: 'passed', issues: [], checks: [{ label: '模拟独立审核', status: 'pass', detail: '用于流程集成验证' }], reviewedBy: 'rules+model', factCount: 0, citedFactCount: 0, imageCount: 1 };
  const draft = (platform: Platform): Draft => ({ id: randomUUID(), platform, titles: ['先列出你的软件需求'], intro: '把学习场景带到店内，逐项观察。', blocks: [
    { id: 'b1', heading: '软件适配', text: '列出课程软件与文件类型，到店核对所选版本的适配情况。', factIds: [] },
    { id: 'b2', heading: '携带体验', text: '把日常用品放进背包，观察携带方式是否适合自己。', factIds: [] },
  ], cta: '带上自己的需求清单到店交流。', tags: ['开学准备'], images: [{ imageId: outline.evidence.images[0].id, afterBlock: 0, caption: '纯模拟同型号原图', reason: '核对产品素材的独立图片层' }] });
  const runId = randomUUID();
  const sources = new Map<Platform, { source: RunResult; request: RenderRequest }>();
  for (const platform of platforms) { const delivery = saveDelivery({ runId, outline, draft: draft(platform), review }); const source = deliveryRenderSource(delivery.id); sources.set(platform, { source, request: { runId, deliveryId: delivery.id, revision: 1, platform, selectedTitleIndex: 0, templateId: platform === 'xiaohongshu' ? 'xhs-cream' : platform === 'wechat' ? 'wechat-editorial' : platform === 'moments' ? 'moments-square' : 'poster-paper' } }); }
  const now = new Date().toISOString();
  const record: StoredJob = { inputHash: 'mock-input', configHash: 'mock-text-config', imageConfigHash: imageConfigurationHash(), runId, snapshot: outline, checkpoints: {}, pendingPaid: {}, job: { id: randomUUID(), idempotencyKey: randomUUID(), kind: 'generate', status: 'running', createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(), input: { kind: 'generate', outlineId: outline.id, version: outline.version }, model: { name: 'gpt-6.1-sol', baseUrl: 'https://relay.nccnxta.cn/v1' }, channels: platforms.map(platform => ({ platform, status: 'running', stage: 'render' })), calls: [], renderBundles: [] } };
  function context(target: StoredJob): JobContext { return { signal: new AbortController().signal, save() { stateStore().set('jobs', target.job.id, target); }, acknowledge() {}, call(call) { const index = target.job.calls.findIndex(item => item.id === call.id); if (index < 0) target.job.calls.push(structuredClone(call)); else target.job.calls[index] = structuredClone(call); } }; }
  const render = (platform: Platform, target = record) => { const value = sources.get(platform)!; return renderVisualDelivery(value.source, value.request, target, context(target)); };
  return { record, render, sources };
}
const countImages = () => calls.filter(call => call.url === 'https://ark.cn-beijing.volces.com/api/v3/images/generations').length;
const countImports = () => calls.filter(call => call.url === 'https://api.canva.com/rest/v1/imports').length;

test('real visual workflow modules share two generated assets across four channels and Moments uses no image API', async () => {
  const f = await fixture(); const moments = await f.render('moments');
  assert.equal(countImages(), 0); assert.equal(countImports(), 0); assert.equal(moments.artifacts[0].format, 'original');
  const [xhs, wechat, poster] = await Promise.all(['xiaohongshu', 'wechat', 'poster'].map(platform => f.render(platform as Platform)));
  assert.equal(countImages(), 2); assert.equal(countImports(), 3);
  assert.ok(xhs.artifacts.length >= 3 && xhs.artifacts.length <= 6); assert.equal(wechat.artifacts.some(item => item.format === 'wechat-richtext'), true);
  assert.deepEqual([poster.artifacts[0].width, poster.artifacts[0].height], [1080, 1920]);
  for (const bundle of [moments, xhs, wechat, poster]) { assert.equal(bundle.publication, 'released'); assert.ok(bundle.zipUrl); assert.ok(bundle.copyText); }
  assert.equal(f.record.job.calls.filter(call => call.stage === 'image' && call.outcome === 'succeeded').length, 2);
  assert.ok([...designs.values()].every(design => design.texts.some(item => item.regions.some(region => region.text === '先列出你的软件需求')) && design.fills.length >= 2));
});
test('a Canva read failure retains the paid image and imported design; manual continuation does not generate or import again', async () => {
  const f = await fixture(); failedContentReads = 1;
  await assert.rejects(f.render('xiaohongshu'), (e: any) => e.code === 'CANVA_PROVIDER');
  assert.equal(countImages(), 1); assert.equal(countImports(), 1);
  const image = structuredClone(f.record.checkpoints['image:main']);
  const cp = f.record.checkpoints['visual:xiaohongshu'] as any; assert.equal(cp.canva.phase, 'imported');
  const result = await f.render('xiaohongshu');
  assert.equal(result.publication, 'released'); assert.equal(countImages(), 1); assert.equal(countImports(), 1);
  assert.deepEqual(f.record.checkpoints['image:main'], image);
});
test('JSON checkpoint recovery reuses successful Canva export bytes and preserves original resource expiry', async () => {
  const f = await fixture(); const first = await f.render('poster'); const callsBefore = calls.length;
  const saved = stateStore().get<StoredJob>('jobs', f.record.job.id)!;
  assert.equal((saved.checkpoints['visual:poster'] as any).canva.phase, 'exported');
  const original = Date.now;
  try {
    Date.now = () => original() + 15_000;
    const repeated = await f.render('poster', saved);
    assert.equal(repeated.expiresAt, first.expiresAt); assert.equal(countImages(), 1); assert.equal(countImports(), 1);
    assert.equal(calls.length, callsBefore, 'restored successful stages should not invoke image, import, read/edit or export');
    assert.equal((await getRenderAsset(repeated.artifacts[0].id, true)).data.length > 0, true);
  } finally { Date.now = original; }
});
test('a new rerender record for another channel reuses the existing main visual and its original expiry', async () => {
  const f = await fixture(); const first = await f.render('xiaohongshu'); assert.equal(countImages(), 1);
  const next = structuredClone(f.record); next.job.id = randomUUID(); next.checkpoints = {}; next.job.calls = []; next.snapshot = undefined;
  const second = await f.render('wechat', next);
  assert.equal(countImages(), 1, 'a standalone WeChat rerender must reuse the same run main visual even without the full outline snapshot');
  assert.equal(countImports(), 2); assert.equal(second.expiresAt, first.expiresAt);
  assert.equal(second.artifacts.some(artifact => artifact.format === 'wechat-richtext'), true);
});
test('a late sibling channel never repeats an uncertain shared image request until an explicit retry round', async () => {
  const f = await fixture(); failedImageRequests = 1;
  await assert.rejects(f.render('xiaohongshu'), (e: any) => e.code === 'IMAGE_NETWORK' && e.outcomeUnknown);
  assert.equal(countImages(), 1);
  await assert.rejects(f.render('wechat'), (e: any) => e.outcomeUnknown === true);
  assert.equal(countImages(), 1, 'a later channel in the same job round cannot turn an uncertain shared request into another paid request');
  f.record.retrySequence = (f.record.retrySequence || 0) + 1;
  const result = await f.render('wechat'); assert.equal(result.publication, 'released'); assert.equal(countImages(), 2);
});
test('explicit visual regeneration bypasses shared cache once and its successful checkpoint prevents repeated charges', async () => {
  const f = await fixture(); await f.render('xiaohongshu');
  const next = structuredClone(f.record); next.job.id = randomUUID(); next.checkpoints = {}; next.job.calls = []; next.snapshot = undefined;
  f.sources.get('wechat')!.request.regenerateVisual = true;
  const generatedAgain = await f.render('wechat', next); assert.equal(countImages(), 2);
  const count = calls.length; const repeated = await f.render('wechat', next);
  assert.equal(countImages(), 2); assert.equal(calls.length, count); assert.equal(repeated.expiresAt, generatedAgain.expiresAt);
});
test('reauthorizing Canva while a visual stage is paused stops before another image dispatch', async () => {
  const f = await fixture(); failedContentReads = 1;
  await assert.rejects(f.render('xiaohongshu'));
  assert.equal(countImages(), 1);
  const url = new URL((await beginCanvaConnection()).authorizationUrl);
  await completeCanvaConnection({ code: 'second-account-code', state: url.searchParams.get('state')! });
  await assert.rejects(f.render('xiaohongshu'), (e: any) => e.code === 'CANVA_CONNECTION_CHANGED');
  assert.equal(countImages(), 1, 'an account switch cannot buy an image before the bound Canva account is checked');
});


test('visual dispatch rejects unbound legacy jobs and changed image credentials without spending', async () => {
  const f = await fixture(); delete f.record.imageConfigHash;
  await assert.rejects(f.render('xiaohongshu'), (error: any) => error.code === 'IMAGE_CONFIG_UNBOUND');
  assert.equal(countImages(), 0);
  const next = structuredClone(f.record); next.job.id = randomUUID(); next.checkpoints = {}; next.imageConfigHash = imageConfigurationHash();
  process.env.IMAGE_API_KEY = 'sk-test-image-new-credential';
  await assert.rejects(f.render('wechat', next), (error: any) => error.code === 'IMAGE_CONFIG_CHANGED');
  assert.equal(countImages(), 0); assert.equal(next.job.calls.length, 0);
});

test('shared main-visual cache scopes provider/model while successful old checkpoints stay reusable locally', async () => {
  const legacyUrl = 'https://relay.styxgate.top/v1/images/generations'; let legacyCalls = 0;
  process.env.IMAGE_BASE_URL = 'https://relay.styxgate.top/v1'; process.env.IMAGE_MODEL = 'gpt-image-2.5';
  globalThis.fetch = async (input, init) => {
    if (String(input) !== legacyUrl) return mockFetch(input, init);
    legacyCalls++; const body = JSON.parse(String(init?.body)); assert.equal(body.n, 1); assert.equal(body.model, 'gpt-image-2.5');
    return json({ data: [{ b64_json: generated.toString('base64') }] });
  };
  const f = await fixture(), old = await f.render('xiaohongshu'); assert.equal(legacyCalls, 1);
  process.env.IMAGE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'; process.env.IMAGE_MODEL = 'doubao-seedream-5-0-pro-260628'; globalThis.fetch = mockFetch as typeof fetch;
  const configuredBase = process.env.IMAGE_BASE_URL; process.env.IMAGE_BASE_URL = 'invalid-private-configuration'; const local = await f.render('xiaohongshu'); process.env.IMAGE_BASE_URL = configuredBase; assert.equal(local.id, old.id); assert.equal(local.expiresAt, old.expiresAt); assert.equal(countImages(), 0);
  const next = structuredClone(f.record); next.job.id = randomUUID(); next.job.calls = []; next.checkpoints = {}; next.imageConfigHash = imageConfigurationHash();
  const modern = await f.render('wechat', next); assert.equal(countImages(), 1, 'new provider must not silently receive cached old-model pixels');
  assert.equal(modern.creativeAssets![0].model, 'doubao-seedream-5-0-pro-260628'); assert.equal(modern.creativeAssets![0].provider, 'https://ark.cn-beijing.volces.com/api/v3');
});

test('old unscoped main-visual markers protect unknown results across providers but permit replacing a known rejection', async () => {
  process.env.IMAGE_BASE_URL = 'https://relay.styxgate.top/v1'; process.env.IMAGE_MODEL = 'gpt-image-2.5';
  globalThis.fetch = async (input, init) => {
    if (String(input) !== 'https://relay.styxgate.top/v1/images/generations') return mockFetch(input, init);
    throw new Error('synthetic legacy response lost');
  };
  const f = await fixture(); await assert.rejects(f.render('xiaohongshu'), (error: any) => error.outcomeUnknown === true);
  const [key, marker] = stateStore().entries<any>('creativeRequests').find(([, marker]) => marker.jobId === f.record.job.id)!; delete marker.providerFingerprint; stateStore().set('creativeRequests', key, marker);
  process.env.IMAGE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'; process.env.IMAGE_MODEL = 'doubao-seedream-5-0-pro-260628'; globalThis.fetch = mockFetch as typeof fetch;
  const next = structuredClone(f.record); next.job.id = randomUUID(); next.job.calls = []; next.checkpoints = {}; next.imageConfigHash = imageConfigurationHash();
  await assert.rejects(f.render('wechat', next), (error: any) => error.outcomeUnknown === true); assert.equal(countImages(), 0);
  marker.error = { ...marker.error, outcomeUnknown: false, upstreamStatus: 403, code: 'IMAGE_GATEWAY_BLOCKED' }; stateStore().set('creativeRequests', key, marker);
  const modern = await f.render('wechat', next); assert.equal(countImages(), 1); assert.equal(modern.creativeAssets![0].model, 'doubao-seedream-5-0-pro-260628');
});
