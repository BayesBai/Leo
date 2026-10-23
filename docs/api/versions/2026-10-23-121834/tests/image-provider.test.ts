import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { ModelCallRecord } from '../shared/types.js';
import { DEFAULT_IMAGE_BASE_URL, DEFAULT_IMAGE_MODEL, generateImage, ImageProviderError, snapshotImageConfig, type ImageConfigSnapshot } from '../server/image-provider.js';

const config: ImageConfigSnapshot = { configured: true, baseUrl: DEFAULT_IMAGE_BASE_URL, name: DEFAULT_IMAGE_MODEL, timeoutMs: 300_000, apiKey: 'private-image-test-key' };
const png = await sharp({ create: { width: 12, height: 16, channels: 3, background: '#abc' } }).png().toBuffer();
const success = () => new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 20, output_tokens: 400, total_tokens: 420 } }), { headers: { 'content-type': 'application/json', 'x-request-id': 'image-test-1' } });

test('image provider keeps exact model and independent credential, decodes local asset and dispatches ledger first', async () => {
  const events: ModelCallRecord[] = []; let guarded = false;
  const result = await generateImage({ prompt: '明确的测试设计简报和背景要求', config, beforeDispatch() { guarded = true; }, onCall: call => events.push(call), fetcher: async (url, init) => {
    assert.equal(guarded, true); assert.equal(events[0].outcome, 'dispatched'); assert.equal(String(url), 'https://relay.styxgate.top/v1/images/generations');
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer private-image-test-key');
    const body = JSON.parse(String(init!.body)); assert.equal(body.model, 'gpt-image-2.5'); assert.equal(body.n, 1); assert.equal(body.output_format, 'png'); return success();
  } });
  assert.deepEqual(result.buffer, png); assert.equal(result.mimeType, 'image/png'); assert.equal(result.width, 12); assert.equal(result.height, 16);
  assert.match(result.sha256, /^[a-f0-9]{64}$/); assert.equal(result.requestId, 'image-test-1'); assert.equal(result.call.totalMs! >= 0, true);
  assert.equal(events.at(-1)?.outcome, 'succeeded'); assert.equal(result.usage?.totalTokens, 420);
  assert.doesNotMatch(JSON.stringify({ ...result, buffer: undefined }), /private-image-test-key|b64_json/);
});

test('missing image key and a failed durable dispatch guard never contact provider', async () => {
  let count = 0; const fetcher: typeof fetch = async () => { count++; return success(); };
  await assert.rejects(generateImage({ prompt: 'test', config: { ...config, configured: false }, fetcher }), error => error instanceof ImageProviderError && error.code === 'IMAGE_NOT_CONFIGURED' && error.retryable);
  await assert.rejects(generateImage({ prompt: 'test', config, fetcher, beforeDispatch() { throw new Error('storage corrupt'); } }), /storage corrupt/);
  assert.equal(count, 0);
});

test('image model business error exposes safe diagnostics and never substitutes or repeats requests', async () => {
  let count = 0;
  await assert.rejects(generateImage({ prompt: 'test', config, fetcher: async () => {
    count++; return new Response(JSON.stringify({ error: { code: 'model_not_found', type: 'invalid_request_error', message: 'Unknown model gpt-image-2.5 private-image-test-key', request_id: 'req-missing-model' } }));
  } }), error => {
    assert.ok(error instanceof ImageProviderError); assert.equal(error.code, 'IMAGE_PROVIDER'); assert.equal(error.category, 'protocol');
    assert.equal(error.providerCode, 'model_not_found'); assert.equal(error.requestId, 'req-missing-model'); assert.doesNotMatch(JSON.stringify(error), /private-image-test-key/); return true;
  }); assert.equal(count, 1);
});

test('image concurrency is one and cancellation removes queued work without dispatching it', async () => {
  let unblock!: () => void; const barrier = new Promise<void>(resolve => { unblock = resolve; }); let started!: () => void;
  const hasStarted = new Promise<void>(resolve => { started = resolve; }); let active = 0, maximum = 0, count = 0;
  const fetcher: typeof fetch = async () => { count++; active++; maximum = Math.max(maximum, active); started(); await barrier; active--; return success(); };
  const first = generateImage({ prompt: 'first', config, jobId: 'first', fetcher }); await hasStarted;
  const abort = new AbortController(); const second = generateImage({ prompt: 'second', config, jobId: 'second', fetcher, signal: abort.signal }); abort.abort();
  await assert.rejects(second, error => error instanceof ImageProviderError && error.code === 'CANCELLED' && !error.outcomeUnknown);
  unblock(); await first; assert.equal(maximum, 1); assert.equal(count, 1);
});

test('image timeout and network loss pause as unknown without retry or credential leaks', async () => {
  for (const timeout of [false, true]) {
    const events: ModelCallRecord[] = []; let count = 0;
    await assert.rejects(generateImage({ prompt: 'test', config: { ...config, timeoutMs: timeout ? 10 : 1000 }, onCall: call => events.push(call), fetcher: async (_url, init) => {
      count++;
      if (timeout) await new Promise<void>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)); setTimeout(() => reject(new Error('test fallback')), 100).unref(); });
      throw new Error('lost private-image-test-key https://images.invalid/private?sig=secret');
    } }), error => { assert.ok(error instanceof ImageProviderError); assert.equal(error.code, timeout ? 'IMAGE_TIMEOUT' : 'IMAGE_NETWORK'); assert.equal(error.outcomeUnknown, true); assert.doesNotMatch(String(error), /private-image-test-key|images.invalid|sig=secret/); return true; });
    assert.equal(count, 1); assert.equal(events.at(-1)?.outcome, 'unknown');
  }
});

test('signed image is recovered locally without forwarding key; private addresses are rejected', async () => {
  const urls: string[] = [];
  const result = await generateImage({ prompt: 'test', config, fetcher: async (url, init) => {
    urls.push(String(url)); if (urls.length === 1) return new Response(JSON.stringify({ data: [{ url: 'https://images.invalid/output?signature=test' }] }));
    assert.equal(init?.headers, undefined); return new Response(new Uint8Array(png));
  } });
  assert.deepEqual(result.buffer, png); assert.equal(urls.length, 2); assert.doesNotMatch(JSON.stringify(result), /signature=test|images.invalid/);
  let count = 0;
  await assert.rejects(generateImage({ prompt: 'test', config, fetcher: async () => { count++; return new Response(JSON.stringify({ data: [{ url: 'https://127.0.0.1/private' }] })); } }), error => error instanceof ImageProviderError && error.code === 'IMAGE_PROTOCOL');
  assert.equal(count, 1);
});

test('image default configuration remains independent and rejects full endpoint or example key', () => {
  const previous = ['IMAGE_API_KEY', 'IMAGE_BASE_URL', 'IMAGE_MODEL', 'IMAGE_TIMEOUT_MS'].map(key => [key, process.env[key]] as const);
  try {
    for (const [key] of previous) delete process.env[key]; const defaults = snapshotImageConfig();
    assert.equal(defaults.baseUrl, DEFAULT_IMAGE_BASE_URL); assert.equal(defaults.name, DEFAULT_IMAGE_MODEL); assert.equal(defaults.timeoutMs, 300000); assert.equal(defaults.configured, false);
    process.env.IMAGE_API_KEY = 'sk-your-api-key'; assert.equal(snapshotImageConfig().configured, false);
    process.env.IMAGE_BASE_URL = `${DEFAULT_IMAGE_BASE_URL}/images/generations`; assert.throws(() => snapshotImageConfig(), /IMAGE_BASE_URL/);
  } finally { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
