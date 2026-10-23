import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import type { Brief, RunResult } from '../shared/types.js';
import { listProducts } from '../server/knowledge.js';
import { createOutline, confirmOutline, confirmedOutline } from '../server/outlines.js';
import { runPipeline } from '../server/pipeline.js';
import { getRenderAsset, getRunBundles, publishRunBundles, renderRun } from '../server/render/index.js';
import { renderWechatArticle } from '../server/render/wechat.js';

async function run(): Promise<RunResult> {
  const product = (await listProducts())[0];
  const brief: Brief = { productId: product.id, audience: '学生', scene: '开学', goal: '到店体验', buyingStage: '对比选择', platforms: ['moments'], instructions: '', mode: 'demo', knowledgeSource: 'local' };
  const outline = await createOutline(brief); confirmOutline(outline.id, outline.version);
  return runPipeline(brief, undefined, { outline: confirmedOutline(outline.id, outline.version), evidence: outline.evidence });
}
const request = (result: RunResult) => ({ runId: result.id, revision: result.revision, platform: 'moments' as const, selectedTitleIndex: 0, templateId: 'moments-square' });
const denied = (error: unknown) => !!error && typeof error === 'object' && 'status' in error && error.status === 409;

test('pending preview has clean bytes, cannot download, caches without renewing expiry, then atomically releases new handles', async () => {
  const result = await run(), input = request(result);
  const preview = await renderRun(result, input, undefined, { publication: 'preview' });
  assert.equal(preview.publication, 'preview'); assert.equal(preview.copyText, ''); assert.equal(preview.zipUrl, undefined);
  assert.ok(preview.artifacts.every(a => !a.downloadUrl));
  const oldHandle = preview.artifacts[0].id;
  const marked = await getRenderAsset(oldHandle); assert.ok(marked.data.length > 0);
  await assert.rejects(getRenderAsset(oldHandle, true), denied);
  const cached = await renderRun(result, input, undefined, { publication: 'preview' });
  assert.equal(cached.id, preview.id); assert.equal(cached.expiresAt, preview.expiresAt);
  const incomplete = { ...result, brief: { ...result.brief, platforms: ['moments', 'poster'] as Brief['platforms'] } };
  await assert.rejects(publishRunBundles(incomplete), denied);
  await assert.rejects(getRenderAsset(oldHandle, true), denied);
  const bundles = await publishRunBundles(result), released = bundles.find(b => b.id === preview.id)!;
  assert.equal(released.publication, 'released'); assert.equal(released.expiresAt, preview.expiresAt);
  assert.ok(released.copyText); assert.ok(released.zipUrl); assert.notEqual(released.artifacts[0].id, oldHandle);
  const clean = await getRenderAsset(released.artifacts[0].id, true); assert.deepEqual(clean.data, marked.data);
  // A previously disclosed preview URL remains unexportable even after publication.
  await assert.rejects(getRenderAsset(oldHandle, true), denied);
  assert.deepEqual((await getRenderAsset(oldHandle)).data, marked.data);
  const zip = await getRenderAsset(released.zipUrl!.split('/').pop()!.split('?')[0], true);
  assert.match(strFromU8(unzipSync(zip.data)['来源与审核.md']), /整组终审/);
  assert.equal((await renderRun(result, input)).id, released.id);
});

test('one global blocking issue prevents all published downloads and copy, without losing previews', async () => {
  const result = await run(); result.id = randomUUID();
  const preview = await renderRun(result, request(result), undefined, { publication: 'preview' });
  result.review = { ...result.review, status: 'blocked', issues: [{ id: 'block', severity: 'error', category: 'fact', message: '整组存在阻断事实问题', suggestion: '请核实' }] };
  const bundle = (await publishRunBundles(result)).find(b => b.id === preview.id)!;
  assert.equal(bundle.publication, 'blocked'); assert.equal(bundle.copyText, ''); assert.equal(bundle.zipUrl, undefined);
  for (const item of bundle.artifacts) { assert.equal(item.downloadUrl, undefined); await assert.rejects(getRenderAsset(item.id, true), denied); assert.ok((await getRenderAsset(item.id)).data.length); }
});

test('expired render cache is not reused and resource reads never extend original expiry', async () => {
  const result = await run(); result.id = randomUUID();
  const bundle = await renderRun(result, request(result));
  await getRenderAsset(bundle.artifacts[0].id);
  assert.equal(getRunBundles(result.id)[0].expiresAt, bundle.expiresAt);
  const original = Date.now;
  try {
    const future = Date.parse(bundle.expiresAt) + 1; Date.now = () => future;
    assert.equal(getRunBundles(result.id).length, 0);
    const fresh = await renderRun(result, request(result));
    assert.notEqual(fresh.id, bundle.id); assert.ok(Date.parse(fresh.expiresAt) > future);
  } finally { Date.now = original; }
});

test('rich text contains exact content and no review watermark or footer', async () => {
  const result=await run();const draft={...result.drafts[0],platform:'wechat' as const,images:[]};
  const html=await renderWechatArticle(draft,draft.titles[0],[],{id:'wechat-editorial',platform:'wechat',name:'test',width:1200,height:510},'审核中，仅供预览');
  assert.doesNotMatch(html,/审核中|发布前复核|检查通过|本地资料/);assert.match(html,/section/);
});
