import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import type { Brief, Draft, ModelCallRecord, Platform, ReviewReport } from '../shared/types.js';
import { listProducts, getAsset } from '../server/knowledge.js';
import { createOutline, confirmOutline, confirmedOutline } from '../server/outlines.js';
import { saveDelivery, deliveryDetail, deliveryRenderSource, updateDeliveryBundle, revokeDelivery } from '../server/deliveries.js';
import { getRenderAsset, getRunBundles, renderRun } from '../server/render/index.js';
import { markPreview } from '../server/render/preview-watermark.js';
import { withModelExecution } from '../server/model.js';
import { stateStore } from '../server/state-store.js';

const report = (blocked = false): ReviewReport => ({ status: blocked ? 'blocked' : 'passed', issues: blocked ? [{ id: 'synthetic-block', severity: 'error', category: 'fact', platform: 'poster', message: '纯模拟海报阻断', suggestion: '重新核对纯模拟条件' }] : [], checks: [{ label: '纯模拟审核结果', status: blocked ? 'fail' : 'pass', detail: '仅用于离线接口与门禁测试' }], reviewedBy: 'rules', factCount: 1, citedFactCount: 1, imageCount: 1 });
const denied = (error: unknown) => !!error && typeof error === 'object' && 'status' in error && error.status === 409;
async function fixture() {
  const product = (await listProducts())[0];
  const brief: Brief = { productId: product.id, audience: '学生', scene: '纯模拟开学选择', goal: '到店核对', buyingStage: '对比', platforms: ['moments', 'wechat', 'poster'], instructions: '', mode: 'demo', knowledgeSource: 'local' };
  const value = await createOutline(brief); confirmOutline(value.id, value.version);
  const outline = confirmedOutline(value.id, value.version);
  const draft = (platform: Platform): Draft => ({ id: randomUUID(), platform, titles: ['先列出你的软件需求'], intro: '这是纯模拟场景文案。',
    blocks: [{ id: 'b1', heading: '先核对配置', text: '实际适配条件与所选销售版本有关，请到店逐项核对。', factIds: [] }], cta: '带上自己的软件清单到店交流。', tags: [],
    images: [{ imageId: outline.evidence.images[0].id, afterBlock: 0, caption: '纯模拟同型号产品图', reason: '用于验证图片字节与归属' }] });
  const runId = randomUUID();
  const delivery = (platform: Platform, blocked = false) => saveDelivery({ runId, outline, draft: draft(platform), review: report(blocked) });
  return { outline, runId, delivery };
}
const request = (id: string, runId: string, platform: Platform) => ({ deliveryId: id, runId, revision: 1, platform, selectedTitleIndex: 0, templateId: platform === 'moments' ? 'moments-square' : platform === 'wechat' ? 'wechat-editorial' : 'poster-paper' });

test('passed Moments exports independently when a sibling poster is blocked; images retain original bytes', async () => {
  const f = await fixture(); const moment = f.delivery('moments'), poster = f.delivery('poster', true);
  const momentBundle = await renderRun(deliveryRenderSource(moment.id), request(moment.id, f.runId, 'moments'));
  const posterBundle = await renderRun(deliveryRenderSource(poster.id), request(poster.id, f.runId, 'poster'));
  updateDeliveryBundle(moment.id, momentBundle); updateDeliveryBundle(poster.id, posterBundle);
  assert.equal(deliveryDetail(moment.id).status, 'ready'); assert.equal(deliveryDetail(poster.id).status, 'blocked');
  assert.equal(momentBundle.publication, 'released'); assert.ok(momentBundle.zipUrl); assert.ok(momentBundle.copyText);
  assert.equal(posterBundle.publication, 'blocked'); assert.equal(posterBundle.copyText, ''); assert.equal(posterBundle.zipUrl, undefined);
  for (const artifact of momentBundle.artifacts) {
    assert.equal(artifact.format, 'original');
    const rendered = await getRenderAsset(artifact.id, true);
    const image = f.outline.evidence.images.find(image => image.id === artifact.sourceImageIds[0])!;
    const original = await getAsset(image.url.split('/').pop()!);
    assert.deepEqual(rendered.data, original.data, 'Moments must deliver source bytes, not a generated text collage');
  }
  await assert.rejects(getRenderAsset(posterBundle.artifacts[0].id, true), denied);
  const cleanPreview = await getRenderAsset(posterBundle.artifacts[0].id);
  assert.equal((await sharp(cleanPreview.data).metadata()).width, 1080);
  assert.ok((await getRenderAsset(momentBundle.artifacts[0].id, true)).data.length);
  assert.equal(getRunBundles(f.runId).length, 2);
});

test('new article output has no review labels while preserving factual conditions and separate provenance', async () => {
  const f = await fixture(); const delivery = f.delivery('wechat'); const source = deliveryRenderSource(delivery.id);
  source.notice = '审核中，仅供预览 · 本地资料 · 内容检查通过 · 发布前复核';
  const bundle = await renderRun(source, request(delivery.id, f.runId, 'wechat'));
  const article = bundle.artifacts.find(artifact => artifact.format === 'wechat-richtext')!;
  const asset = await getRenderAsset(article.id, true);
  const dom = new JSDOM(asset.data.toString('utf8'));
  try {
    const text = dom.window.document.body.textContent!;
    assert.doesNotMatch(text, /审核中|仅供预览|本地资料|检查通过|发布前复核/);
    assert.ok(text.includes(source.drafts[0].blocks[0].text));
    assert.ok(text.includes(source.drafts[0].cta));
  } finally { dom.window.close(); }
  const cover = bundle.artifacts.find(artifact => artifact.role === 'cover')!;
  assert.deepEqual([cover.width, cover.height], [1200, 510]);
  assert.equal((await sharp((await getRenderAsset(cover.id, true)).data).metadata()).height, 510);
});

test('explicit cleanup of a valid legacy preview uses saved copy and original source, new handles and original expiry without a model request', async () => {
  const f = await fixture(); const delivery = f.delivery('moments'); const source = deliveryRenderSource(delivery.id);
  const input = request(delivery.id, f.runId, 'moments');
  const { deliveryId: _deliveryId, ...legacyInput } = input;
  const legacy = await renderRun(source, legacyInput, undefined, { publication: 'preview' });
  const legacyArtifact = await getRenderAsset(legacy.artifacts[0].id);
  const marked = await markPreview(legacyArtifact.data, 'png', '审核中，仅供预览');
  const saved = stateStore().get<{ file: string }>('renderAssets', legacy.artifacts[0].id)!;
  await writeFile(saved.file, marked);
  stateStore().set('renderBundles', legacy.id, { ...legacy, rendererVersion: 2 });
  assert.deepEqual(await readFile(saved.file), marked);
  const calls: ModelCallRecord[] = [];
  const now = Date.now; let clean;
  try {
    Date.now = () => now() + 15_000;
    clean = await withModelExecution({ onCall: call => calls.push(call) }, () => renderRun(source, input, undefined, { expiresAt: legacy.expiresAt }));
  } finally { Date.now = now; }
  assert.equal(calls.length, 0); assert.notEqual(clean.id, legacy.id); assert.equal(clean.expiresAt, legacy.expiresAt);
  assert.notEqual(clean.artifacts[0].id, legacy.artifacts[0].id); assert.equal(clean.publication, 'released');
  const original = await getAsset(f.outline.evidence.images[0].url.split('/').pop()!);
  assert.deepEqual((await getRenderAsset(clean.artifacts[0].id, true)).data, original.data);
  assert.notDeepEqual((await getRenderAsset(clean.artifacts[0].id, true)).data, marked);
  await assert.rejects(getRenderAsset(legacy.artifacts[0].id, true), denied);
  updateDeliveryBundle(delivery.id, clean);
  assert.equal(deliveryDetail(delivery.id).bundle?.id, clean.id);
  const cached = await renderRun(source, input, undefined, { expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
  assert.equal(cached.id, clean.id); assert.equal(cached.expiresAt, legacy.expiresAt, 'cache hits cannot extend a resource lifetime');
});

test('revoking changed Canva text or product layers closes already issued artifact and ZIP downloads', async () => {
  const f = await fixture(); const delivery = f.delivery('moments');
  const preRevocationSource = deliveryRenderSource(delivery.id);
  const bundle = await renderRun(preRevocationSource, request(delivery.id, f.runId, 'moments'));
  updateDeliveryBundle(delivery.id, bundle);
  const zipHandle = bundle.zipUrl!.split('/').pop()!.split('?')[0];
  assert.ok((await getRenderAsset(bundle.artifacts[0].id, true)).data.length); assert.ok((await getRenderAsset(zipHandle, true)).data.length);
  const expiresAt = deliveryDetail(delivery.id).expiresAt;
  const revoked = revokeDelivery(delivery.id);
  assert.equal(revoked.status, 'blocked'); assert.equal(revoked.copyText, ''); assert.equal(revoked.expiresAt, expiresAt);
  assert.equal(revoked.bundle?.publication, 'blocked'); assert.equal(revoked.bundle?.zipUrl, undefined);
  for (const artifact of bundle.artifacts) await assert.rejects(getRenderAsset(artifact.id, true), denied);
  await assert.rejects(getRenderAsset(zipHandle, true), denied);
  const { deliveryId: _deliveryId, ...legacyInput } = request(delivery.id, f.runId, 'moments');
  await assert.rejects(renderRun(preRevocationSource, legacyInput), denied, 'legacy requests cannot create fresh export handles after this channel is revoked');
  assert.ok((await getRenderAsset(bundle.artifacts[0].id)).data.length, 'blocked content remains readable in preview');
});
