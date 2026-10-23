import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type { ModelCallRecord } from '../shared/types.js';
import { DEFAULT_IMAGE_BASE_URL, DEFAULT_IMAGE_MODEL, generateImage, ImageProviderError, normalizeImageBaseUrl, snapshotImageConfig, type ImageConfigSnapshot } from '../server/image-provider.js';

const config: ImageConfigSnapshot = { configured: true, baseUrl: DEFAULT_IMAGE_BASE_URL, name: DEFAULT_IMAGE_MODEL, timeoutMs: 300_000, apiKey: 'private-image-test-key' };
const png = await sharp({ create: { width: 12, height: 16, channels: 3, background: '#abc' } }).png().toBuffer();
const success = () => new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 20, output_tokens: 400, total_tokens: 420 } }), { headers: { 'content-type': 'application/json', 'x-request-id': 'image-test-1' } });

test('Ark image provider sends exact Seedream model, native single-image body and independent credential after durable dispatch', async () => {
  const events: ModelCallRecord[] = []; let guarded = false;
  const result = await generateImage({ prompt: '明确的测试设计简报和背景要求', config, beforeDispatch() { guarded = true; }, onCall: call => events.push(call), fetcher: async (url, init) => {
    assert.equal(guarded, true); assert.equal(events[0].outcome, 'dispatched'); assert.equal(String(url), 'https://ark.cn-beijing.volces.com/api/v3/images/generations');
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer private-image-test-key');
    const body = JSON.parse(String(init!.body)); assert.deepEqual(body, { model: 'doubao-seedream-5-0-pro-260628', prompt: '明确的测试设计简报和背景要求', size: '1024x1536', output_format: 'png', response_format: 'b64_json', watermark: false });
    for (const field of ['n', 'stream', 'sequential_image_generation', 'image', 'layer_decomposition']) assert.equal(field in body, false);
    return success();
  } });
  assert.deepEqual(result.buffer, png); assert.equal(result.mimeType, 'image/png'); assert.equal(result.width, 12); assert.equal(result.height, 16);
  assert.match(result.sha256, /^[a-f0-9]{64}$/); assert.equal(result.requestId, 'image-test-1'); assert.equal(result.call.totalMs! >= 0, true);
  assert.equal(events.at(-1)?.outcome, 'succeeded'); assert.equal(result.usage?.totalTokens, 420);
  assert.doesNotMatch(JSON.stringify({ ...result, buffer: undefined }), /private-image-test-key|b64_json/);
});

test('Ark reports confirmed token/image usage and safe x-tt-logid, while missing usage stays unknown', async () => {
  const result = await generateImage({ prompt: 'test', config, fetcher: async () => new Response(JSON.stringify({ model: DEFAULT_IMAGE_MODEL, data: [{ b64_json: png.toString('base64'), size: '12x16', output_format: 'png' }], usage: { generated_images: 1, output_tokens: 6144, total_tokens: 6144 } }), { headers: { 'content-type': 'application/json', 'x-tt-logid': '20261023ARKTEST01', 'x-request-id': 'secondary-id' } }) });
  assert.equal(result.requestId, '20261023ARKTEST01'); assert.equal(result.call.requestId, result.requestId);
  assert.equal(result.usage?.completionTokens, 6144); assert.equal(result.usage?.totalTokens, 6144); assert.equal(result.usage?.promptTokens, undefined); assert.equal(result.usage?.generatedImages, 1);
  for (const usage of [undefined, {}, { generated_images: -1, output_tokens: '100', total_tokens: Number.NaN }]) {
    const missing = await generateImage({ prompt: 'test', config, fetcher: async () => new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }], usage }), { headers: { 'x-tt-logid': config.apiKey! } }) });
    assert.equal(missing.usage, undefined); assert.equal(missing.requestId, undefined);
  }
});

test('Ark preserves all native dimensions and explicit legacy configuration never silently substitutes a provider', async () => {
  for (const size of ['1024x1024', '1024x1536', '1536x1024'] as const) {
    await generateImage({ prompt: 'test', size, config, fetcher: async (url, init) => {
      assert.equal(String(url), `${DEFAULT_IMAGE_BASE_URL}/images/generations`); const body = JSON.parse(String(init?.body)); assert.equal(body.size, size); assert.equal(body.n, undefined); return success();
    } });
  }
  const legacy = { ...config, baseUrl: 'https://relay.styxgate.top/v1', name: 'gpt-image-2.5' };
  let count = 0;
  await generateImage({ prompt: 'legacy test', config: legacy, fetcher: async (url, init) => {
    count++; assert.equal(String(url), `${legacy.baseUrl}/images/generations`);
    assert.deepEqual(JSON.parse(String(init?.body)), { model: legacy.name, prompt: 'legacy test', size: '1024x1536', output_format: 'png', n: 1 }); return success();
  } });
  assert.equal(count, 1);
});

test('Ark API roots preserve api/v3 and reject v1, endpoints or embedded credentials before dispatch', async () => {
  for (const raw of ['https://ark.cn-beijing.volces.com', 'https://ark.cn-beijing.volces.com/', `${DEFAULT_IMAGE_BASE_URL}/`, ` ${DEFAULT_IMAGE_BASE_URL} `]) assert.equal(normalizeImageBaseUrl(raw), DEFAULT_IMAGE_BASE_URL);
  assert.equal(normalizeImageBaseUrl('https://relay.styxgate.top'), 'https://relay.styxgate.top/v1');
  for (const raw of ['https://ark.cn-beijing.volces.com/v1', `${DEFAULT_IMAGE_BASE_URL}/v1`, `${DEFAULT_IMAGE_BASE_URL}/images/generations`, `${DEFAULT_IMAGE_BASE_URL}/images/edits/`, `${DEFAULT_IMAGE_BASE_URL}?key=private-image-test-key`, 'https://private-image-test-key@ark.cn-beijing.volces.com/api/v3', 'http://ark.cn-beijing.volces.com/api/v3', 'https://ark.cn-beijing.volces.com:8443/api/v3']) {
    assert.throws(() => normalizeImageBaseUrl(raw), error => error instanceof ImageProviderError && error.code === 'IMAGE_CONFIG');
    await assert.rejects(generateImage({ prompt: 'test', config: { ...config, baseUrl: raw }, fetcher: async () => assert.fail('invalid Ark root must not dispatch') }), error => error instanceof ImageProviderError && error.code === 'IMAGE_CONFIG');
  }
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
    count++; return new Response(JSON.stringify({ error: { code: 'model_not_found', type: 'invalid_request_error', message: `Unknown model ${DEFAULT_IMAGE_MODEL} private-image-test-key`, request_id: 'req-missing-model' } }));
  } }), error => {
    assert.ok(error instanceof ImageProviderError); assert.equal(error.code, 'IMAGE_PROVIDER'); assert.equal(error.category, 'protocol');
    assert.equal(error.providerCode, 'model_not_found'); assert.equal(error.requestId, 'req-missing-model'); assert.doesNotMatch(JSON.stringify(error), /private-image-test-key/); return true;
  }); assert.equal(count, 1);
});

test('Cloudflare 403 HTML reports a non-retryable gateway block without exposing the page or blaming credentials', async () => {
  const events: ModelCallRecord[] = []; let count = 0;
  await assert.rejects(generateImage({ prompt: 'test', config, onCall: call => events.push(call), fetcher: async () => {
    count++; return new Response('<!doctype html><html><head><title>Attention Required! | Cloudflare</title></head><body>private-image-test-key PRIVATE_BLOCK_PAGE https://images.invalid/?sig=secret</body></html>', {
      status: 403, headers: { 'content-type': 'text/html; charset=UTF-8', server: 'cloudflare', 'cf-ray': 'cf-test-ray-123' },
    });
  } }), error => {
    assert.ok(error instanceof ImageProviderError); assert.equal(error.code, 'IMAGE_GATEWAY_BLOCKED');
    assert.equal(error.upstreamStatus, 403); assert.equal(error.category, 'unknown'); assert.equal(error.providerType, 'gateway_firewall');
    assert.equal(error.retryable, false); assert.equal(error.outcomeUnknown, false); assert.equal(error.requestId, 'cf-test-ray-123');
    assert.match(error.message, /Cloudflare 防火墙拒绝/); assert.match(error.message, /不能证明 API Key 无效/);
    assert.doesNotMatch(JSON.stringify({ message: error.message, error, events }), /private-image-test-key|PRIVATE_BLOCK_PAGE|Attention Required|<html|sig=secret/);
    return true;
  });
  assert.equal(count, 1); assert.equal(events.at(-1)?.outcome, 'failed'); assert.equal(events.at(-1)?.code, 'IMAGE_GATEWAY_BLOCKED');
});

test('ordinary 403 authentication responses stay distinct from Cloudflare firewall challenges', async () => {
  const responses = [
    () => new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'Invalid API key private-image-test-key' } }), { status: 403, headers: { 'content-type': 'application/json', server: 'cloudflare' } }),
    () => new Response('<html><head><title>Forbidden</title></head><body>Permission denied.</body></html>', { status: 403, headers: { 'content-type': 'text/html', server: 'cloudflare' } }),
  ];
  for (const response of responses) {
    let count = 0;
    await assert.rejects(generateImage({ prompt: 'test', config, fetcher: async () => { count++; return response(); } }), error => {
      assert.ok(error instanceof ImageProviderError); assert.notEqual(error.code, 'IMAGE_GATEWAY_BLOCKED');
      assert.equal(error.category, 'authentication'); assert.equal(error.upstreamStatus, 403); assert.equal(error.retryable, false); assert.equal(error.outcomeUnknown, false);
      assert.doesNotMatch(JSON.stringify(error), /private-image-test-key/); return true;
    });
    assert.equal(count, 1);
  }
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
