import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { RunResult, TraceEntry } from '../shared/types.js';
import { generateFromOutline } from '../src/api.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const product = { id: 'mock-pc', name: '纯模拟机型', system: '测试系统', category: '测试', description: '不包含真实产品事实', imageCount: 0 };
function result(): RunResult {
  return {
    id: 'mock-run', revision: 1, createdAt: '2026-10-18T08:00:00Z', notice: '纯模拟响应', product,
    brief: { productId: product.id, audience: '模拟客户', scene: '测试场景', goal: '到店体验', buyingStage: '对比选择', platforms: ['moments'], instructions: '', mode: 'demo', knowledgeSource: 'local' },
    evidence: { product, sourceMode: 'local', retrievedAt: '2026-10-18T08:00:00Z', facts: [], images: [], sources: [], warnings: [] },
    drafts: [{ id: 'mock-draft', platform: 'moments', titles: ['模拟标题'], intro: '中文跨字节分片', blocks: [{ id: 's1', heading: '模拟段落', text: '模拟正文', factIds: [] }], images: [], tags: ['模拟'], cta: '仅用于测试' }],
    strategies: [], trace: [], review: { status: 'blocked', issues: [], checks: [], factCount: 0, citedFactCount: 0, imageCount: 0, reviewedBy: 'rules' },
    outline: { id: 'mock-outline', version: 3 },
  };
}
const progress: TraceEntry = { step: 'write', status: 'running', label: '模拟写作', detail: '测试进度', at: '2026-10-18T08:00:00Z' };
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
function useStream(text: string, { fragmented = false, keepOpen = false } = {}) {
  let canceled = false;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(text);
      if (fragmented) for (let start = 0; start < bytes.length; start += 7) controller.enqueue(bytes.slice(start, start + 7));
      else controller.enqueue(bytes);
      if (!keepOpen) controller.close();
    },
    cancel() { canceled = true; },
  }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  return () => canceled;
}
const generate = (signal = new AbortController().signal, onProgress: (entry: TraceEntry) => void = () => {}) => generateFromOutline('mock-outline', 3, signal, onProgress);

test('frontend decodes fragmented UTF-8, CRLF, multiline data and comment heartbeats', async () => {
  const expected = result(); const entries: TraceEntry[] = [];
  const resultEvent = JSON.stringify({ type: 'result', result: expected });
  useStream(`: heartbeat\r\n\r\ndata: ${JSON.stringify({ type: 'progress', entry: progress })}\r\n\r\ndata: ${resultEvent.slice(0, 1)}\r\ndata: ${resultEvent.slice(1)}\r\n\r\n`, { fragmented: true });
  assert.deepEqual(await generate(undefined, entry => entries.push(entry)), expected);
  assert.deepEqual(entries, [progress]);
});

test('frontend completes on the terminal result and closes a stream left open by the server', async () => {
  const canceled = useStream(event({ type: 'result', result: result() }), { keepOpen: true });
  assert.equal((await generate()).id, 'mock-run'); assert.equal(canceled(), true);
});

test('frontend handles SSE errors and needs_input on an HTTP 200 response', async () => {
  for (const type of ['error', 'needs_input']) {
    const canceled = useStream(event({ type, message: '模拟失败信息' }), { keepOpen: true });
    await assert.rejects(generate(), /模拟失败信息/); assert.equal(canceled(), true);
  }
});

test('frontend rejects truncated or malformed streams without exposing the invalid payload', async () => {
  useStream(event({ type: 'progress', entry: progress })); await assert.rejects(generate(), /未收到完整正文/);
  useStream('data: secret-malformed-payload\n\n');
  await assert.rejects(generate(), error => error instanceof Error && /格式无效/.test(error.message) && !error.message.includes('secret-malformed-payload'));
  useStream(event({ type: 'result', result: { id: 'partial' } })); await assert.rejects(generate(), /正文结果不完整/);
  useStream(event({ type: 'progress', entry: { step: 'write' } })); await assert.rejects(generate(), /生成进度格式无效/);
});

test('frontend rejects results belonging to another confirmed outline or version', async () => {
  for (const outline of [{ id: 'other-outline', version: 3 }, { id: 'mock-outline', version: 2 }]) {
    useStream(event({ type: 'result', result: { ...result(), outline } }));
    await assert.rejects(generate(), /大纲版本不一致/);
  }
});

test('frontend handles pre-stream HTTP errors and rejects an HTML success page', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: '模拟大纲已经过期' }), { status: 410, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(generate(), /模拟大纲已经过期/);
  globalThis.fetch = async () => new Response('<html>wrong route</html>', { headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(generate(), /未返回正文事件流/);
});

test('frontend cancellation discards a buffered result and cancels the reader', async () => {
  const controller = new AbortController();
  const canceled = useStream(event({ type: 'progress', entry: progress }) + event({ type: 'result', result: result() }), { keepOpen: true });
  await assert.rejects(generate(controller.signal, () => controller.abort()), error => error instanceof DOMException && error.name === 'AbortError');
  assert.equal(canceled(), true);
});

test('frontend bounds an unterminated event instead of buffering indefinitely', async () => {
  const canceled = useStream(`data: ${'x'.repeat(2 * 1024 * 1024 + 1)}`, { keepOpen: true });
  await assert.rejects(generate(), /正文事件超过接收上限/); assert.equal(canceled(), true);
});

test('frontend bounds cumulative stream bytes even when every frame is small enough', async () => {
  const canceled = useStream(event({ type: 'future-event', padding: 'x'.repeat(1024 * 1024) }).repeat(9), { keepOpen: true });
  await assert.rejects(generate(), /正文流超过接收上限/); assert.equal(canceled(), true);
});
