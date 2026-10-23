import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { BackgroundJob, Brief } from '../shared/types.js';
import { createApp } from '../server/index.js';
import { confirmOutline, createOutline } from '../server/outlines.js';
import { listProducts } from '../server/knowledge.js';

async function until(check: () => boolean | Promise<boolean>) {
  for (let n = 0; n < 400; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('isolated operation did not settle');
}
const json = (body: unknown, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const completion = (output: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });

for (const cancel of [false, true]) test(`legacy generation protects outline mutations and Job retry until ${cancel ? 'cancel cleanup' : 'completion'}`, async () => {
  const native = globalThis.fetch;
  const product = (await listProducts())[0];
  const brief: Brief = { productId: product.id, audience: cancel ? '取消流程测试学生' : '完成流程测试学生', scene: '开学', goal: '到店体验', buyingStage: '对比选择', instructions: '', platforms: ['moments'], mode: 'demo', knowledgeSource: 'local' };
  const demo = await createOutline(brief);
  let failNextWrite = false, holdNextWrite = false, modelCalls = 0;
  let writerSignal: AbortSignal | undefined;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) return native(url, init);
    assert.equal(String(url), 'https://relay.nccnxta.cn/v1/chat/completions');
    modelCalls++;
    const system: string = JSON.parse(String(init?.body)).messages[0].content;
    if (system.includes('只策划可编辑大纲')) return completion({ platforms: demo.platforms });
    if (system.includes('独立的事实审稿员')) return completion({ summary: '纯模拟审稿', issues: [] });
    if (failNextWrite) { failNextWrite = false; return new Response('isolated upstream timeout', { status: 524 }); }
    if (holdNextWrite) { holdNextWrite = false; writerSignal = init?.signal || undefined; await held; }
    const platform = demo.platforms[0];
    return completion({ intro: platform.intro, blocks: platform.sections.map(section => ({ id: section.id, text: section.points.join('\n') })), cta: platform.cta, tags: [] });
  };
  const app = await createApp({ apiOnly: true });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const controller = new AbortController();
  let stream: Response | undefined;
  const job = async (id: string) => (await (await native(`${base}/api/jobs/${id}`)).json() as { job: BackgroundJob }).job;
  try {
    const outline = await createOutline({ ...brief, mode: 'live' }); confirmOutline(outline.id, outline.version);
    // Keep a retryable failed Job for the same outline before the legacy request starts.
    failNextWrite = true;
    const submitted = await native(`${base}/api/jobs`, json({ kind: 'generate', idempotencyKey: randomUUID(), outlineId: outline.id, version: outline.version }));
    assert.equal(submitted.status, 202);
    const failed = (await submitted.json() as { job: BackgroundJob }).job;
    await until(async () => (await job(failed.id)).status === 'failed');
    holdNextWrite = true;
    stream = await native(`${base}/api/generate-from-outline`, { ...json({ outlineId: outline.id, version: outline.version }), signal: controller.signal });
    assert.equal(stream.status, 200); await until(() => !!writerSignal);
    const callsWhileHeld = modelCalls;
    const assertLocked = async () => {
      const requests = [
        [`/api/outlines/${outline.id}`, json({ version: outline.version, platforms: outline.platforms }, 'PUT')],
        [`/api/outlines/${outline.id}/confirm`, json({ version: outline.version })],
        [`/api/outlines/${outline.id}/revise`, json({ version: outline.version, instructions: '精简' })],
        [`/api/jobs/${failed.id}/retry`, json({})],
      ] as const;
      for (const [route, request] of requests) assert.equal((await native(`${base}${route}`, request)).status, 409, route);
      assert.equal(modelCalls, callsWhileHeld, 'blocked writes and retry must not dispatch a model request');
      assert.equal((await job(failed.id)).status, 'failed');
    };
    await assertLocked();
    if (cancel) {
      controller.abort(); await until(() => !!writerSignal?.aborted);
      await assertLocked(); // The fake upstream deliberately holds cleanup after abort.
      release();
    } else {
      release();
      assert.match(await stream.text(), /"type":"result"/);
    }
    // Retry is admitted after legacy cleanup, even for the same confirmed version.
    await until(async () => (await native(`${base}/api/jobs/${failed.id}/retry`, json({}))).status === 200);
    await until(async () => ['completed', 'failed'].includes((await job(failed.id)).status));
    assert.equal((await job(failed.id)).status, 'completed');
    const saved = await native(`${base}/api/outlines/${outline.id}`, json({ version: outline.version, platforms: outline.platforms }, 'PUT'));
    assert.equal(saved.status, 200); assert.equal((await saved.json()).version, 2);
    const revised = await native(`${base}/api/outlines/${outline.id}/revise`, json({ version: 2, instructions: '精简' }));
    assert.equal(revised.status, 200); assert.equal((await revised.json()).version, 3);
    assert.equal((await native(`${base}/api/outlines/${outline.id}/confirm`, json({ version: 3 }))).status, 200);
  } finally {
    controller.abort(); release(); await stream?.body?.cancel().catch(() => {});
    globalThis.fetch = native; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
