import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { listProducts } from '../server/knowledge.js';
import { runPipeline } from '../server/pipeline.js';
import { renderRun } from '../server/render/index.js';
import { stateStore } from '../server/state-store.js';

test('ima evidence expiring while queued for a render slot cannot produce a fresh asset or export', async () => {
  const product = (await listProducts())[0];
  const result = await runPipeline({ productId: product.id, audience: '学生', scene: '模拟排版排队', goal: '到店体验', buyingStage: '对比选择', platforms: ['moments'], instructions: '', mode: 'demo', knowledgeSource: 'local' });
  const first = { ...result, id: randomUUID() }; const second = { ...result, id: randomUUID() };
  const pending = structuredClone(result); pending.id = randomUUID();
  // A protocol-only ima envelope around synthetic test evidence; no ima request is made.
  pending.brief.knowledgeSource = 'ima'; pending.evidence.sourceMode = 'ima'; pending.evidence.retrievedAt = new Date().toISOString();
  for (const item of [...pending.evidence.facts, ...pending.evidence.images, ...pending.evidence.sources]) item.sourceMode = 'ima';
  const request = (runId: string) => ({ runId, revision: 1, platform: 'moments' as const, selectedTitleIndex: 0, templateId: 'moments-square' });
  const originalNow = Date.now;
  let results: PromiseSettledResult<Awaited<ReturnType<typeof renderRun>>>[];
  try {
    // Both local jobs acquire the two slots synchronously; the third validates then waits.
    const renders = [renderRun(first, request(first.id)), renderRun(second, request(second.id)), renderRun(pending, request(pending.id))];
    Date.now = () => originalNow() + 31 * 60_000;
    results = await Promise.allSettled(renders);
  } finally { Date.now = originalNow; }
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'fulfilled');
  assert.equal(results[2].status, 'rejected');
  assert.equal((results[2] as PromiseRejectedResult).reason.status, 410);
  assert.ok(!stateStore().entries<{ runId: string }>('renderBundles').some(([, bundle]) => bundle.runId === pending.id));
});
