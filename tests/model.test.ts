import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { callModel, hasRealSecret, modelConfig, parseModelJson, readMessageStream } from '../server/model.js';
import { briefSchema, draftSchema, modelReviewSchema } from '../server/schemas.js';

function configure() {
  const previous = { key: process.env.LLM_API_KEY, base: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL };
  process.env.LLM_API_KEY = 'unit-test-secret-do-not-log';
  process.env.LLM_BASE_URL = 'https://api.openai-next.com/v1/';
  process.env.LLM_MODEL = 'claude-opus-5';
  return () => {
    for (const [field, value] of Object.entries({ LLM_API_KEY: previous.key, LLM_BASE_URL: previous.base, LLM_MODEL: previous.model })) {
      if (value === undefined) delete process.env[field]; else process.env[field] = value;
    }
  };
}

test('masked keys are never considered a configured model credential', () => {
  for (const key of ['', '***', '<API Key>', 'your_api_key', undefined]) assert.equal(hasRealSecret(key), false);
  assert.equal(hasRealSecret('a-real-key'), true);
});

test('normalizes root and /v1 base URLs without duplicating the API path', () => {
  const restore = configure();
  try { assert.equal(modelConfig().baseUrl, 'https://api.openai-next.com'); }
  finally { restore(); }
});

test('sends Anthropic Messages protocol and extracts only final text blocks', async () => {
  const restore = configure();
  try {
    const fakeFetch: typeof fetch = async (url, init) => {
      assert.equal(String(url), 'https://api.openai-next.com/v1/messages');
      const headers = init!.headers as Record<string, string>;
      assert.equal(headers['anthropic-version'], '2023-06-01');
      assert.equal(headers['x-api-key'], 'unit-test-secret-do-not-log');
      const body = JSON.parse(String(init!.body));
      assert.equal(body.model, 'claude-opus-5'); assert.equal(body.stream, true);
      assert.equal(body.system, 'system'); assert.equal(body.messages[0].content, 'user');
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'not exposed' }, { type: 'text', text: '{"ok":true}' }] }), { status: 200 });
    };
    assert.equal(await callModel('system', 'user', { fetcher: fakeFetch }), '{"ok":true}');
  } finally { restore(); }
});

test('authentication failures are explicit and never echo provider responses', async () => {
  const restore = configure();
  try {
    await assert.rejects(callModel('s', 'u', { fetcher: async () => new Response('unit-test-secret-do-not-log', { status: 401 }) }), error => {
      assert.match(String(error), /HTTP 401/); assert.doesNotMatch(String(error), /unit-test-secret/); return true;
    });
  } finally { restore(); }
});

test('truncated model output cannot proceed to generation', async () => {
  const restore = configure();
  try {
    await assert.rejects(callModel('s', 'u', { fetcher: async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"drafts":[' }] })) }), /长度上限/);
  } finally { restore(); }
});

test('missing model credential fails before attempting a network call', async () => {
  const restore = configure(); delete process.env.LLM_API_KEY;
  try {
    let calls = 0;
    await assert.rejects(callModel('s', 'u', { fetcher: async () => { calls++; throw new Error('must not call'); } }), /尚未配置/);
    assert.equal(calls, 0);
  } finally { restore(); }
});

test('parses a single JSON object and rejects incomplete or mixed output', () => {
  assert.deepEqual(parseModelJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.throws(() => parseModelJson('prefix {"ok":true}'), /完整 JSON/);
  assert.throws(() => parseModelJson('{"drafts":['), /完整 JSON/);
});

test('input rejects duplicate platforms and a misleading demo/ima combination', () => {
  const input = { productId: 'pc-test', audience: '学生', scene: '开学', platforms: ['wechat', 'wechat'] };
  assert.equal(briefSchema.safeParse(input).success, false);
  assert.equal(briefSchema.safeParse({ ...input, platforms: ['wechat'], mode: 'demo', knowledgeSource: 'ima' }).success, false);
  assert.equal(briefSchema.safeParse({ ...input, platforms: ['wechat'], mode: 'live', knowledgeSource: 'ima' }).success, true);
});

test('draft schema accepts a cover at -1 and rejects invalid image positions', () => {
  const draft = { platform: 'wechat', titles: ['选购指南'], intro: '', blocks: [{ id: 'b1', heading: '', text: '核对自己的任务。', factIds: [] }], cta: '到店了解', tags: [], images: [{ imageId: 'i1', afterBlock: -1, caption: '', reason: '' }] };
  assert.equal(draftSchema.safeParse(draft).success, true);
  assert.equal(draftSchema.safeParse({ ...draft, images: [{ ...draft.images[0], afterBlock: -2 }] }).success, false);
});

test('native SSE parser handles split Chinese bytes and ignores thinking/signature deltas', async () => {
  const events = [
    { type: 'message_start', message: { content: [] } },
    { type: 'content_block_start', content_block: { type: 'thinking' } },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'must never return' } },
    { type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'private' } },
    { type: 'content_block_start', content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"标题":"开学' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '选机"}' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ];
  const bytes = new TextEncoder().encode(events.map(event => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(''));
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5)); controller.close(); } });
  const result = await readMessageStream(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
  assert.deepEqual(JSON.parse(result), { 标题: '开学选机' });
  assert.doesNotMatch(result, /private|must never/);
});

test('native SSE cannot publish an incomplete or truncated response', async () => {
  const frames = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  const text = { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"ok":true}' } };
  await assert.rejects(readMessageStream(frames([text])), /未接收到完成事件/);
  await assert.rejects(readMessageStream(frames([text, { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, { type: 'message_stop' }])), /长度上限/);
  await assert.rejects(readMessageStream(frames([{ type: 'error', error: { message: 'secret-provider-detail' } } ])), error => { assert.doesNotMatch(String(error), /secret-provider-detail/); return true; });
});

test('model review normalizes unassigned null locations without weakening issue validation', () => {
  const review = modelReviewSchema.parse({ summary: '需核对', issues: [{ severity: 'warning', category: 'fact', message: '资料缺少依据', suggestion: '补充来源', platform: null, factId: null, blockId: null }] });
  assert.equal(review.issues[0].platform, undefined);
  assert.equal(review.issues[0].factId, undefined);
  assert.equal(modelReviewSchema.safeParse({ summary: '', issues: [{ severity: 'always-pass', category: 'fact' }] }).success, false);
});
