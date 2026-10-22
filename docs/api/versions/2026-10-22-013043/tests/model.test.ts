import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { callModel, completeJson, DEFAULT_MODEL_BASE_URL, DEFAULT_MODEL_NAME, hasRealSecret, ModelError, modelConfig, normalizeModelBaseUrl, parseModelJson, readChatCompletionStream } from '../server/model.js';
import { initializeConnectionPolicy, updateConnections } from '../server/connections.js';
import { briefSchema, draftSchema, modelReviewSchema } from '../server/schemas.js';

function configure() {
  const fields = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_THINKING', 'LLM_TIMEOUT_MS'] as const;
  const previous = fields.map(field => [field, process.env[field]] as const);
  process.env.LLM_API_KEY = 'unit-test-secret-do-not-log';
  process.env.LLM_BASE_URL = 'https://relay.nccnxta.cn/v1/';
  process.env.LLM_MODEL = 'gemini-4-argon';
  delete process.env.LLM_THINKING; delete process.env.LLM_TIMEOUT_MS;
  return () => { for (const [field, value] of previous) { if (value === undefined) delete process.env[field]; else process.env[field] = value; } };
}
function completion(content: unknown, finish_reason: unknown = 'stop', extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ choices: [{ index: 0, finish_reason, message: { role: 'assistant', content, ...extra } }] }), { headers: { 'Content-Type': 'application/json' } });
}
function chunk(content: unknown, finish_reason: unknown = null, extra: Record<string, unknown> = {}) {
  return { choices: [{ index: 0, delta: { content, ...extra }, finish_reason }] };
}
function frames(events: unknown[]) {
  return new Response(events.map(event => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}
const code = (expected: string) => (error: unknown) => error instanceof ModelError && error.code === expected;

test('masked and documentation example keys never count as configured credentials', () => {
  for (const key of ['', '***', '<API Key>', 'your_api_key', 'sk-your-api-key', 'sk-xxx', undefined]) assert.equal(hasRealSecret(key), false);
  assert.equal(hasRealSecret('a-real-key'), true);
});
test('relay defaults and canonical API roots retain proxy prefixes and reject unsafe URLs', () => {
  const restore = configure();
  try {
    delete process.env.LLM_BASE_URL; delete process.env.LLM_MODEL;
    assert.equal(DEFAULT_MODEL_BASE_URL, 'https://relay.nccnxta.cn/v1'); assert.equal(DEFAULT_MODEL_NAME, 'gemini-4-argon');
    assert.equal(modelConfig().baseUrl, DEFAULT_MODEL_BASE_URL); assert.equal(modelConfig().name, DEFAULT_MODEL_NAME);
    for (const base of ['https://relay.nccnxta.cn', 'https://relay.nccnxta.cn/', 'https://relay.nccnxta.cn/v1/']) assert.equal(normalizeModelBaseUrl(base), DEFAULT_MODEL_BASE_URL);
    assert.equal(normalizeModelBaseUrl('https://proxy.invalid/prefix/'), 'https://proxy.invalid/prefix/v1');
    assert.equal(normalizeModelBaseUrl('http://127.0.0.1:3001/v1'), 'http://127.0.0.1:3001/v1');
    for (const base of ['https://user:password@relay.nccnxta.cn/v1', 'https://relay.nccnxta.cn/v1?key=secret', 'https://relay.nccnxta.cn/#fragment', 'https://relay.nccnxta.cn/v1/chat/completions', 'https://relay.nccnxta.cn/v1/messages', 'http://external.invalid/v1', 'file:///tmp/model']) assert.throws(() => normalizeModelBaseUrl(base), code('MODEL_CONFIG'));
    process.env.LLM_TIMEOUT_MS = '999999'; assert.equal(modelConfig().timeoutMs, 300000);
    process.env.LLM_TIMEOUT_MS = '1'; assert.equal(modelConfig().timeoutMs, 5000);
  } finally { restore(); }
});
test('sends Chat Completions Bearer and system/user messages without legacy fields', async () => {
  const restore = configure();
  try {
    process.env.LLM_THINKING = 'disabled';
    const fakeFetch: typeof fetch = async (url, init) => {
      assert.equal(String(url), 'https://relay.nccnxta.cn/v1/chat/completions'); assert.equal(init!.redirect, 'error');
      const headers = init!.headers as Record<string, string>;
      assert.equal(headers.Authorization, 'Bearer unit-test-secret-do-not-log');
      assert.equal(headers['anthropic-version'], undefined); assert.equal(headers['x-api-key'], undefined);
      const body = JSON.parse(String(init!.body));
      assert.equal(body.model, 'gemini-4-argon'); assert.equal(body.stream, true); assert.equal(body.max_tokens, 3500);
      assert.equal(body.thinking, undefined); assert.equal(body.system, undefined);
      assert.deepEqual(body.messages, [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }]);
      return completion('{"ok":true}', 'stop', { reasoning_content: 'private reasoning' });
    };
    assert.equal(await callModel('system', 'user', { maxTokens: 3500, fetcher: fakeFetch }), '{"ok":true}');
  } finally { restore(); }
});
test('authentication failures never echo provider responses and are not retried', async () => {
  const restore = configure(); let calls = 0;
  try {
    await assert.rejects(callModel('s', 'u', { fetcher: async () => { calls++; return new Response('unit-test-secret-do-not-log', { status: 401 }); } }), error => {
      assert.match(String(error), /HTTP 401/); assert.doesNotMatch(String(error), /unit-test-secret/); return true;
    }); assert.equal(calls, 1);
  } finally { restore(); }
});
test('HTTP 503 JSON account exhaustion explains gateway capacity without retries or raw details', async () => {
  const restore = configure(); let calls = 0;
  try {
    await assert.rejects(callModel('s', 'u', { fetcher: async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: 'All available accounts exhausted', type: 'server_error', code: null, debug: 'unit-test-secret-do-not-log private-provider-detail' } }), { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '0.001' } });
    } }), error => {
      assert.equal(code('MODEL_CAPACITY')(error), true);
      assert.match(String(error), /账号.*耗尽/); assert.match(String(error), /联系.*网关/);
      assert.doesNotMatch(String(error), /All available accounts exhausted|unit-test-secret|private-provider-detail/); return true;
    });
    assert.equal(calls, 1);
  } finally { restore(); }
});
test('HTTP 503 SSE account exhaustion is recognized through fragmented frames without retrying', async () => {
  const restore = configure(); let calls = 0;
  try {
    await assert.rejects(callModel('s', 'u', { fetcher: async () => {
      calls++;
      const bytes = new TextEncoder().encode(': heartbeat\r\n\r\ndata: ' + JSON.stringify({ error: { message: 'All available accounts exhausted', type: 'server_error', code: null, detail: 'unit-test-secret-do-not-log' } }) + '\r\n\r\ndata: [DONE]\r\n\r\n');
      const body = new ReadableStream<Uint8Array>({ start(controller) { for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7)); controller.close(); } });
      return new Response(body, { status: 503, headers: { 'content-type': 'text/event-stream' } });
    } }), error => {
      assert.equal(code('MODEL_CAPACITY')(error), true);
      assert.match(String(error), /账号.*耗尽/); assert.match(String(error), /联系.*网关/);
      assert.doesNotMatch(String(error), /All available accounts exhausted|unit-test-secret/); return true;
    });
    assert.equal(calls, 1);
  } finally { restore(); }
});
test('unknown or lookalike HTTP 503 messages retain finite retry and never leak response text', async () => {
  const restore = configure();
  try {
    for (const body of [
      { error: { message: 'private-provider-detail' } },
      { error: { message: 'All available accounts exhausted private-provider-detail' } },
      { message: 'All available accounts exhausted' },
    ]) {
      let calls = 0;
      await assert.rejects(callModel('s', 'u', { fetcher: async () => { calls++; return new Response(JSON.stringify(body), { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '0.001' } }); } }), error => {
        assert.equal(code('MODEL_HTTP')(error), true); assert.match(String(error), /HTTP 503/);
        assert.doesNotMatch(String(error), /All available accounts exhausted|private-provider-detail/); return true;
      });
      assert.equal(calls, 2);
    }
  } finally { restore(); }
});
test('HTTP 200 completion text and business errors never become account-capacity failures', async () => {
  const restore = configure();
  try {
    const text = '说明字符串 All available accounts exhausted 仅作为正文示例。';
    assert.equal(await callModel('s', 'u', { fetcher: async () => completion(text) }), text);
    assert.equal(await callModel('s', 'u', { fetcher: async () => frames([chunk(text), chunk(null, 'stop'), '[DONE]']) }), text);
    await assert.rejects(callModel('s', 'u', { fetcher: async () => new Response(JSON.stringify({ error: { message: 'All available accounts exhausted' } }), { headers: { 'content-type': 'application/json' } }) }), code('MODEL_PROVIDER'));
  } finally { restore(); }
});
test('JSON responses reject truncation, filters, tools, refusal and missing termination', async () => {
  const restore = configure();
  try {
    const cases: [Response, string][] = [
      [completion('{"drafts":[', 'length'), 'MODEL_TRUNCATED'], [completion('', 'content_filter'), 'MODEL_REFUSAL'],
      [completion('{}', 'tool_calls'), 'MODEL_PROTOCOL'], [completion('{}', 'stop', { tool_calls: [{ id: 'private-tool' }] }), 'MODEL_PROTOCOL'],
      [completion('{}', 'stop', { function_call: { name: 'private-tool' } }), 'MODEL_PROTOCOL'],
      [completion(null, 'stop', { refusal: 'private-provider-detail' }), 'MODEL_REFUSAL'], [completion('{}', null), 'MODEL_STREAM_INCOMPLETE'],
      [completion([{ type: 'text', text: '{}' }]), 'MODEL_PROTOCOL'], [completion(''), 'MODEL_EMPTY'],
      [new Response(JSON.stringify({ error: { message: 'private-provider-detail' } })), 'MODEL_PROVIDER'],
      [new Response(JSON.stringify({ choices: [] })), 'MODEL_PROTOCOL'],
    ];
    for (const [response, expected] of cases) await assert.rejects(callModel('s', 'u', { fetcher: async () => response }), error => {
      assert.doesNotMatch(String(error), /private-provider-detail|private-tool/); return code(expected)(error);
    });
  } finally { restore(); }
});
test('missing credentials and invalid API roots fail before any network call', async () => {
  const restore = configure(); let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error('must not call'); };
  try {
    delete process.env.LLM_API_KEY; await assert.rejects(callModel('s', 'u', { fetcher }), code('MODEL_NOT_CONFIGURED'));
    process.env.LLM_API_KEY = 'sk-your-api-key'; await assert.rejects(callModel('s', 'u', { fetcher }), code('MODEL_NOT_CONFIGURED'));
    process.env.LLM_BASE_URL = 'https://relay.nccnxta.cn/v1/chat/completions'; await assert.rejects(callModel('s', 'u', { fetcher }), code('MODEL_CONFIG'));
    assert.equal(calls, 0);
  } finally { restore(); }
});
test('SSE handles split Chinese bytes, CRLF, reasoning, usage and other choices', async () => {
  const events = [
    { choices: [{ index: 0, delta: { role: 'assistant', content: null }, finish_reason: null }] },
    chunk(null, null, { reasoning_content: 'must never return', signature: 'private' }),
    { choices: [{ index: 1, delta: { content: 'ignored choice' }, finish_reason: null }] },
    chunk('{"标题":"开学'), chunk('选机"}'), chunk(null, 'stop'), { choices: [], usage: { total_tokens: 30 } },
  ];
  const bytes = new TextEncoder().encode(': heartbeat\r\n\r\n' + events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5)); controller.close(); } });
  const activity: number[] = [];
  const result = await readChatCompletionStream(new Response(stream), characters => activity.push(characters));
  assert.deepEqual(JSON.parse(result), { 标题: '开学选机' }); assert.doesNotMatch(result, /private|must never|ignored choice/); assert.equal(activity.at(-1), result.length);
});
test('SSE accepts a final unseparated frame and explicit stop before EOF', async () => {
  const body = `data: ${JSON.stringify(chunk('{"ok":true}'))}\n\ndata: ${JSON.stringify(chunk(null, 'stop'))}`;
  assert.equal(await readChatCompletionStream(new Response(body)), '{"ok":true}');
});
test('SSE returns and cancels an open connection immediately after the stop frame', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk('{"ok":true}'))}\n\ndata: ${JSON.stringify(chunk(null, 'stop'))}\n\n`));
      // This gateway keeps the transport open and sends neither [DONE] nor EOF.
    },
    cancel() { cancelled = true; },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('parser waited for transport EOF after stop')), 250); });
    assert.equal(await Promise.race([readChatCompletionStream(new Response(stream)), timeout]), '{"ok":true}');
    assert.equal(cancelled, true);
  } finally { clearTimeout(timer); }
});
test('SSE never publishes incomplete, truncated, filtered, refused or tool responses', async () => {
  const text = chunk('{"ok":true}');
  const cases: [unknown[], string][] = [
    [[text], 'MODEL_STREAM_INCOMPLETE'], [[text, '[DONE]'], 'MODEL_STREAM_INCOMPLETE'], [[text, chunk(null, 'length'), '[DONE]'], 'MODEL_TRUNCATED'],
    [[text, chunk(null, 'content_filter')], 'MODEL_REFUSAL'], [[text, chunk(null, 'tool_calls')], 'MODEL_PROTOCOL'],
    [[chunk(null, null, { tool_calls: [{ id: 'private-tool' }] })], 'MODEL_PROTOCOL'], [[chunk(null, null, { refusal: 'private-provider-detail' })], 'MODEL_REFUSAL'],
    [[{ error: { message: 'private-provider-detail' } }], 'MODEL_PROVIDER'], [['not-json'], 'MODEL_PROTOCOL'], [[{ type: 'message_stop' }], 'MODEL_PROTOCOL'],
    [[chunk(null, 'stop'), '[DONE]'], 'MODEL_EMPTY'], [[text, chunk(null, 'stop'), chunk('unexpected')], 'MODEL_PROTOCOL'],
  ];
  for (const [events, expected] of cases) await assert.rejects(readChatCompletionStream(frames(events)), error => {
    assert.doesNotMatch(String(error), /private-provider-detail|private-tool/); return code(expected)(error);
  });
});
test('SSE byte limit includes ignored reasoning data and cancels the reader', async () => {
  let cancelled = false, pulls = 0;
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify(chunk(null, null, { reasoning_content: 'x'.repeat(1_000_000) }))}\n\n`);
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(bytes); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await assert.rejects(readChatCompletionStream(new Response(stream)), code('MODEL_RESPONSE_SIZE')); assert.equal(pulls, 2); assert.equal(cancelled, true);
});
test('HTTP retry captures the original endpoint, model and credential', async () => {
  const restore = configure(); let calls = 0;
  try {
    const text = await callModel('s', 'u', { fetcher: async (url, init) => {
      assert.equal(String(url), 'https://relay.nccnxta.cn/v1/chat/completions');
      assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer unit-test-secret-do-not-log'); assert.equal(JSON.parse(String(init!.body)).model, 'gemini-4-argon');
      calls++;
      if (calls === 1) { process.env.LLM_API_KEY = 'replacement-test-key'; process.env.LLM_BASE_URL = 'https://changed.invalid'; process.env.LLM_MODEL = 'changed'; return new Response('', { status: 503, headers: { 'retry-after': '0.001' } }); }
      return completion('OK');
    } }); assert.equal(text, 'OK'); assert.equal(calls, 2);
  } finally { restore(); }
});
test('repeated temporary HTTP errors have a finite retry budget', async () => {
  const restore = configure(); let calls = 0;
  try {
    await assert.rejects(callModel('s', 'u', { fetcher: async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '0.001' } }); } }), code('MODEL_HTTP')); assert.equal(calls, 2);
  } finally { restore(); }
});
test('cancellation interrupts retry delay without another request', async () => {
  const restore = configure(); const controller = new AbortController(); let calls = 0;
  try {
    await assert.rejects(callModel('s', 'u', { signal: controller.signal, fetcher: async () => { calls++; setTimeout(() => controller.abort(), 10); return new Response('', { status: 503, headers: { 'retry-after': '3' } }); } }), code('CANCELLED')); assert.equal(calls, 1);
  } finally { restore(); }
});
test('an already cancelled request never calls fetch and uses the normal cancellation code', async () => {
  const restore = configure(); const controller = new AbortController(); controller.abort(); let calls = 0;
  try {
    await assert.rejects(callModel('s', 'u', { signal: controller.signal, fetcher: async () => { calls++; return completion('must-not-return'); } }), code('CANCELLED'));
    assert.equal(calls, 0);
  } finally { restore(); }
});
test('cancellation reaches fetch and suppresses a late response', async () => {
  const restore = configure(); const controller = new AbortController(); let captured: AbortSignal | undefined;
  try {
    await assert.rejects(callModel('s', 'u', { signal: controller.signal, fetcher: async (_url, init) => { captured = init!.signal!; controller.abort(); return completion('late'); } }), code('CANCELLED')); assert.equal(captured?.aborted, true);
  } finally { restore(); }
});
test('network errors redact captured and current keys without retry', async () => {
  const restore = configure(); let calls = 0;
  try {
    await assert.rejects(callModel('s', 'u', { fetcher: async () => { calls++; process.env.LLM_API_KEY = 'replacement-test-key'; throw new Error('request contained unit-test-secret-do-not-log and replacement-test-key'); } }), error => { assert.doesNotMatch(String(error), /unit-test-secret|replacement-test-key/); return code('MODEL_NETWORK')(error); }); assert.equal(calls, 1);
  } finally { restore(); }
});
test('non-stream responses stop at the byte limit and cancel the body', async () => {
  const restore = configure(); let pulls = 0, cancelled = false;
  try {
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(1_000_001)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    await assert.rejects(callModel('s', 'u', { fetcher: async () => new Response(stream) }), code('MODEL_RESPONSE_SIZE')); assert.equal(pulls, 2); assert.equal(cancelled, true);
  } finally { restore(); }
});
test('runtime changes reject cross-origin reuse and atomically accept a new key', () => {
  const restore = configure();
  try {
    process.env.LLM_BASE_URL = 'https://configured.invalid/v1'; initializeConnectionPolicy(); process.env.LLM_BASE_URL = DEFAULT_MODEL_BASE_URL;
    for (const settings of [
      { baseUrl: 'https://configured.invalid/v1', model: 'must-not-save' },
      { baseUrl: 'https://configured.invalid/v1', apiKey: 'unit-test-secret-do-not-log', model: 'must-not-save' },
      { baseUrl: 'https://configured.invalid/v1', apiKey: 'sk-your-api-key', model: 'must-not-save' },
      { baseUrl: 'https://api.openai-next.com/v1', apiKey: 'new-service-key', model: 'must-not-save' },
      { baseUrl: 'https://untrusted.invalid/v1', apiKey: 'new-service-key', model: 'must-not-save' },
      { baseUrl: 'https://relay.nccnxta.cn:444/v1', apiKey: 'new-service-key', model: 'must-not-save' },
    ]) {
      assert.throws(() => updateConnections(settings), /密钥|地址/); assert.equal(process.env.LLM_MODEL, DEFAULT_MODEL_NAME); assert.equal(process.env.LLM_API_KEY, 'unit-test-secret-do-not-log'); assert.equal(process.env.LLM_BASE_URL, DEFAULT_MODEL_BASE_URL);
    }
    updateConnections({ apiKey: '' }); assert.equal(process.env.LLM_API_KEY, 'unit-test-secret-do-not-log');
    updateConnections({ baseUrl: 'https://configured.invalid/', apiKey: 'new-service-key', model: 'new-model' });
    assert.equal(process.env.LLM_BASE_URL, 'https://configured.invalid/v1'); assert.equal(process.env.LLM_API_KEY, 'new-service-key'); assert.equal(process.env.LLM_MODEL, 'new-model');
  } finally { restore(); }
});
test('completeJson regenerates invalid JSON once and validates the full object', async () => {
  const restore = configure(); const originalFetch = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => { calls++; if (calls === 2) assert.match(JSON.parse(String(init!.body)).messages[1].content, /上一次输出格式不符合要求/); return completion(calls === 1 ? '{"ok":' : '{"ok":true}'); };
    assert.deepEqual(await completeJson('s', 'u', z.object({ ok: z.boolean() })), { ok: true }); assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; restore(); }
});
test('parses one JSON object and rejects incomplete or mixed output', () => {
  assert.deepEqual(parseModelJson('```json\n{"ok":true}\n```'), { ok: true }); assert.throws(() => parseModelJson('prefix {"ok":true}'), /完整 JSON/); assert.throws(() => parseModelJson('{"drafts":['), /完整 JSON/);
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

test('model review normalizes unassigned null locations without weakening issue validation', () => {
  const review = modelReviewSchema.parse({ summary: '需核对', issues: [{ severity: 'warning', category: 'fact', message: '资料缺少依据', suggestion: '补充来源', platform: null, factId: null, blockId: null }] });
  assert.equal(review.issues[0].platform, undefined);
  assert.equal(review.issues[0].factId, undefined);
  assert.equal(modelReviewSchema.safeParse({ summary: '', issues: [{ severity: 'always-pass', category: 'fact' }] }).success, false);
});
