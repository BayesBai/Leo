import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.js';
import { createOutline, confirmOutline } from '../server/outlines.js';
import { listProducts } from '../server/knowledge.js';
import type { BackgroundJob, Brief, OutlineResult } from '../shared/types.js';
import { stateStore } from '../server/state-store.js';
async function waitJob(base: string, id: string, check: (j: BackgroundJob) => boolean = j => ['completed', 'failed'].includes(j.status)) {
  for (let n = 0; n < 600; n++) { const r = await fetch(`${base}/api/jobs/${id}`); const { job } = await r.json() as { job: BackgroundJob }; if (check(job)) return job; await new Promise(r => setTimeout(r, 20)); }
  assert.fail('job did not finish');
}
const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('Job HTTP workflow: durable submit, disconnected subscription, snapshot binding, independent delivery and failed-review-only resume without image credentials', async () => {
  const native = globalThis.fetch; const app = await createApp({ apiOnly: true }); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let releaseSlow = () => {};
  try {
    const product = (await listProducts())[0];
    const brief: Brief = { productId: product.id, audience: '学生', scene: '开学', goal: '到店体验', buyingStage: '对比选择', instructions: '', platforms: ['moments', 'poster'], mode: 'demo', knowledgeSource: 'local' };
    const outline = await createOutline(brief); const liveOutline = { ...outline, brief: { ...brief, mode: 'live' as const } };
    // Generate an authentic bound live outline using deterministic per-channel model responses.
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith(base)) return native(url, init);
      const body = JSON.parse(String(init?.body)); const user: string = body.messages[1].content;
      const platform = user.includes('"platforms":["moments"]') ? 'moments' : 'poster';
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ platforms: liveOutline.platforms.filter(p => p.platform === platform) }) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
    };
    const planned = await createOutline(liveOutline.brief); confirmOutline(planned.id, planned.version);
    let writes = 0, reviews = 0; let failReview = true;
    const slow = new Promise<void>(r => { releaseSlow = r; });
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith(base)) return native(url, init);
      const body = JSON.parse(String(init?.body)); const system: string = body.messages[0].content; const user: string = body.messages[1].content;
      const platform = user.includes('"platforms":["moments"]') ? 'moments' : 'poster';
      if (system.includes('只策划可编辑大纲')) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ platforms: planned.platforms.filter(p => p.platform === platform) }) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
      if (system.includes('独立的事实审稿员')) {
        reviews++;
        if (platform === 'poster') { await slow; if (failReview) return new Response('upstream timeout', { status: 524 }); }
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: '模拟独立审稿完成', issues: [] }) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
      }
      writes++;
      const p = planned.platforms.find(p => p.platform === platform)!;
      const output = { intro: p.intro, blocks: p.sections.map(s => ({ id: s.id, text: s.points.join('；') })), cta: p.cta, tags: [] };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
    };
    const key = `http-${randomUUID()}`; const request = { kind: 'generate', idempotencyKey: key, outlineId: planned.id, version: planned.version };
    const invalidTitle = await fetch(`${base}/api/jobs`, json({ ...request, idempotencyKey: randomUUID(), renders: [{ platform: 'moments', templateId: 'moments-square', selectedTitleIndex: 1 }, { platform: 'poster', templateId: 'poster-paper', selectedTitleIndex: 0 }] }));
    assert.equal(invalidTitle.status, 400); assert.equal(writes, 0); assert.equal(reviews, 0);
    const submitted = await fetch(`${base}/api/jobs`, json(request)); assert.equal(submitted.status, 202); const { job: queued } = await submitted.json() as { job: BackgroundJob };
    assert.equal(queued.outline?.id, planned.id);
    const again = await fetch(`${base}/api/jobs`, json(request)); assert.equal((await again.json()).job.id, queued.id);
    const lookup = await fetch(`${base}/api/jobs?idempotencyKey=${key}`); assert.equal((await lookup.json()).jobs[0].id, queued.id);
    const conflict = await fetch(`${base}/api/jobs`, json({ ...request, version: planned.version + 1 })); assert.equal(conflict.status, 409);
    const settings = await fetch(`${base}/api/connections/settings`, json({ model: 'should-not-change' })); assert.equal(settings.status, 409);
    const edit = await fetch(`${base}/api/outlines/${planned.id}/confirm`, json({ version: planned.version })); assert.equal(edit.status, 409);
    const controller = new AbortController(); const stream = await fetch(`${base}/api/jobs/events`, { signal: controller.signal }); const reader = stream.body!.getReader();
    const first = await reader.read(); assert.match(new TextDecoder().decode(first.value), /snapshot/); controller.abort(); await reader.cancel().catch(() => {});
    const early = await waitJob(base, queued.id, j => !!j.channels.find(c => c.platform === 'moments')?.preview?.bundle);
    assert.equal(early.result, undefined); assert.equal(early.status, 'running');
    const bundle = early.channels.find(c => c.platform === 'moments')!.preview!.bundle!;
    assert.equal(bundle.publication, 'released'); assert.ok(bundle.zipUrl); assert.ok(bundle.copyText);
    for (const a of bundle.artifacts) { assert.ok(a.downloadUrl); assert.equal((await fetch(base + a.previewUrl)).status, 200); assert.equal((await fetch(base + a.previewUrl + '?download=1')).status, 200); }
    releaseSlow();
    const failed = await waitJob(base, queued.id); assert.equal(failed.status, 'failed'); assert.equal(failed.result, undefined);
    assert.equal(failed.channels.find(c => c.platform === 'poster')?.error?.upstreamStatus, 524); assert.equal(failed.channels.find(c => c.platform === 'poster')?.error?.outcomeUnknown, true);
    assert.equal(writes, 2); assert.equal(reviews, 2); failReview = false;
    assert.equal((await fetch(`${base}/api/jobs/${queued.id}/retry`, json({}))).status, 200);
    const completed = await waitJob(base, queued.id); assert.equal(completed.status, 'failed');
    assert.equal(completed.channels.find(c=>c.platform==='poster')?.error?.code,'CANVA_NOT_CONNECTED'); assert.equal(writes, 2); assert.equal(reviews, 3);
    assert.equal(completed.result?.drafts.length, 2); assert.equal(completed.result?.outline?.version, planned.version);
    const blocked = completed.result!.review.status === 'blocked';
    assert.equal(completed.renderBundles.length, 1);
    for (const b of completed.renderBundles) { assert.equal(b.publication, blocked ? 'blocked' : 'released'); for (const a of b.artifacts) { assert.equal((await fetch(base + a.previewUrl)).status, 200); assert.equal((await fetch(base + a.previewUrl + '?download=1')).status, blocked ? 409 : 200); } }
    // Old pending preview handles never turn into clean downloads during promotion.
    for (const a of bundle.artifacts) assert.equal((await fetch(base + a.previewUrl + '?download=1')).status, 200);
    assert.equal(completed.calls.length, 5); assert.equal(completed.calls.filter(c => c.stage === 'write').length, 2);
    assert.ok(!JSON.stringify(stateStore().entries('jobs')).includes(process.env.LLM_API_KEY!));
    const list = await fetch(`${base}/api/jobs`); const listed = (await list.json()).jobs.find((j: BackgroundJob) => j.id === queued.id);
    assert.equal(listed.detailOmitted, true); assert.equal(listed.result, undefined); assert.deepEqual(listed.calls, []);
    const ai = await fetch(`${base}/api/jobs`, json({ kind: 'outline-revise', idempotencyKey: randomUUID(), outlineId: planned.id, version: planned.version, instructions: '只精简海报', platforms: ['poster'] }));
    assert.equal(ai.status, 202); const { job: aiJob } = await ai.json() as { job: BackgroundJob };
    const revised = await waitJob(base, aiJob.id); assert.equal(revised.status, 'completed'); assert.equal(revised.outline?.version, planned.version + 1);
    assert.equal(revised.calls.length, 1); assert.equal(revised.calls[0].platform, 'poster'); assert.equal(revised.calls[0].stage, 'outline');
  } finally { releaseSlow(); globalThis.fetch = native; server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
