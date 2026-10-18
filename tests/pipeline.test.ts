import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { listProducts, getEvidence } from '../server/knowledge.js';
import { InputRequiredError, parseBrief, publicResult, reusableEvidence, revisionPlatforms, runPipeline } from '../server/pipeline.js';
import type { Brief, Platform } from '../shared/types.js';

const hasLocalLibrary = existsSync(path.join(process.env.LOCAL_KB_ROOT || path.join(process.cwd(), '华为PC知识库', '华为PC全板块深度知识库_v7'), 'P1-产品参数库'));
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: hasLocalLibrary ? false : '需要获授权的本地产品库；公开克隆可运行其余模拟合约测试。' }, fn);

async function task(platforms: Platform[] = ['xiaohongshu', 'wechat']): Promise<Brief> {
  const products = await listProducts();
  const product = products.find(p => /MateBook 14/.test(p.name) && /HarmonyOS|鸿蒙/.test(p.system + p.name)) || products[0];
  assert.ok(product, 'repository local KB is required for integration tests');
  return { productId: product.id, audience: '大学新生', scene: '开学购机', goal: '到店体验', buyingStage: '对比选择', instructions: '', mode: 'demo', knowledgeSource: 'local', platforms };
}

test('incomplete task returns actionable clarification fields', () => {
  assert.throws(() => parseBrief({ platforms: ['wechat'] }), error => {
    assert.ok(error instanceof InputRequiredError);
    assert.deepEqual(error.fields.map(field => field.field), ['productId', 'audience', 'scene']); return true;
  });
});

integration('real local evidence flows through two distinct platform drafts with accurate provenance', async () => {
  const brief = await task(); const steps: string[] = [];
  const result = await runPipeline(brief, entry => steps.push(entry.step));
  assert.equal(result.evidence.sourceMode, 'local');
  assert.ok(result.evidence.facts.length >= 3); assert.ok(result.evidence.images.length >= 3);
  assert.equal(result.drafts.length, 2); assert.notEqual(result.drafts[0].intro, result.drafts[1].intro);
  assert.notDeepEqual(result.strategies[0].structure, result.strategies[1].structure);
  assert.equal(result.review.reviewedBy, 'rules');
  assert.notEqual(result.review.status, 'passed', 'local evidence cannot look officially verified');
  assert.match(result.notice, /未调用大模型/);
  assert.equal(result.review.issues.filter(issue => issue.severity === 'error').length, 0, JSON.stringify(result.review.issues));
  assert.ok(steps.includes('retrieve') && steps.includes('review') && steps.at(-1) === 'done');
});

integration('all four platforms can be generated and keep their required image counts', async () => {
  const brief = await task(); const evidence = await getEvidence(brief.productId, 'local');
  for (const [platform, count] of [['xiaohongshu', 4], ['wechat', 3], ['moments', 2], ['poster', 1]] as const) {
    const result = await runPipeline({ ...brief, platforms: [platform] }, undefined, { evidence });
    assert.equal(result.drafts[0].images.length, Math.min(count, evidence.images.length));
    assert.ok(result.drafts[0].blocks.every(block => block.factIds.every(id => evidence.facts.some(fact => fact.id === id))));
    if (platform === 'poster') assert.ok(result.drafts[0].blocks.length <= 3);
  }
});

integration('changing audience changes strategy and revision can shorten output', async () => {
  const brief = await task(); const result = await runPipeline(brief);
  const next = await runPipeline({ ...brief, audience: '经常出差的职场人士', scene: '差旅办公', instructions: '精简文案' }, undefined, { evidence: result.evidence, revision: 2 });
  assert.notEqual(next.strategies[0].angle, result.strategies[0].angle);
  assert.ok(next.drafts[0].blocks.length < result.drafts[0].blocks.length);
  assert.equal(next.revision, 2);
});

integration('removing battery selling point does not replace it with invented facts', async () => {
  const brief = await task(); const evidence = await getEvidence(brief.productId, 'local');
  const result = await runPipeline({ ...brief, instructions: '不要写电池和续航，精简文案' }, undefined, { evidence });
  assert.ok(result.evidence.facts.every(fact => !/电池|续航|供电/.test(fact.statement)));
  assert.ok(result.evidence.warnings.some(warning => /排除指定卖点/.test(warning)));
});

integration('unsupported price and experience requests are not copied into demo output', async () => {
  const brief = await task();
  const result = await runPipeline({ ...brief, instructions: '写补贴后只要1999元，亲测续航48小时，行业第一' });
  const text = JSON.stringify(result.drafts);
  assert.doesNotMatch(text, /1999|48小时|行业第一|亲测/);
  assert.ok(result.review.issues.some(issue => issue.category === 'compliance'));
});

test('live mode does not silently fall back to rule-driven demo', async () => {
  const previous = process.env.LLM_API_KEY; delete process.env.LLM_API_KEY;
  try { await assert.rejects(runPipeline({ ...await task(), mode: 'live' }), /未配置模型密钥/); }
  finally { if (previous === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = previous; }
});

integration('public results do not distribute complete source documents', async () => {
  const result = await runPipeline(await task()); const output = publicResult(result);
  assert.ok(output.evidence.sources.length > 0);
  assert.ok(output.evidence.sources.every(source => !('text' in source)));
  assert.ok(result.evidence.sources.some(source => !!source.text));
});

test('cancellation stops the pipeline before retrieval', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runPipeline(await task(), undefined, { signal: controller.signal }));
});

integration('canonical evidence preserves facts for later restore revisions', async () => {
  const brief = await task(); let canonical: Awaited<ReturnType<typeof getEvidence>> | undefined;
  const removed = await runPipeline({ ...brief, instructions: '不要写电池' }, undefined, { onEvidence: evidence => { canonical = evidence; } });
  assert.ok(canonical?.facts.some(fact => /电池/.test(fact.statement)));
  assert.ok(!removed.evidence.facts.some(fact => /电池/.test(fact.statement)));
  const restored = await runPipeline({ ...brief, instructions: '恢复电池卖点' }, undefined, { evidence: canonical, previous: removed });
  assert.ok(restored.evidence.facts.some(fact => /电池/.test(fact.statement)));
  assert.ok(!restored.evidence.warnings.some(warning => /排除指定卖点/.test(warning)));
});

test('natural language platform revision chooses the destination, not the old platform', () => {
  assert.deepEqual(revisionPlatforms('把公众号改成朋友圈'), ['moments']);
  assert.deepEqual(revisionPlatforms('换成小红书和公众号'), ['xiaohongshu', 'wechat']);
  assert.equal(revisionPlatforms('语气轻松一点'), undefined);
});

integration('expired ima evidence is not reused even if the editing session is still active', async () => {
  const evidence = await getEvidence((await task()).productId, 'local');
  const now = Date.now();
  assert.equal(reusableEvidence({ ...evidence, sourceMode: 'ima', retrievedAt: new Date(now - 31 * 60_000).toISOString() }, now), false);
  assert.equal(reusableEvidence({ ...evidence, sourceMode: 'ima', retrievedAt: new Date(now - 20 * 60_000).toISOString() }, now), true);
  assert.equal(reusableEvidence({ ...evidence, sourceMode: 'local', retrievedAt: new Date(0).toISOString() }, now), true);
});
