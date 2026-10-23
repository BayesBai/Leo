import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel, ModelError, providerBusinessError, redactProviderText, withModelExecution } from '../server/model.js';
import type { ModelCallRecord } from '../shared/types.js';

test('HTTP 200 errors retain bounded sanitized diagnostics and distinct categories without automatic replay', async () => {
  const cases = [
    ['invalid_api_key', 'authentication', false], ['insufficient_quota', 'quota', false],
    ['rate_limit_exceeded', 'rate_limit', false], ['server_overloaded', 'capacity', false],
    ['model_not_found', 'protocol', false], ['unknown_new_code', 'unknown', true],
  ] as const;
  for (const [code, category, uncertain] of cases) {
    let count = 0; const calls: ModelCallRecord[] = [];
    await assert.rejects(withModelExecution({ onCall: call => calls.push(call) }, () => callModel('s', 'u', { fetcher: async () => {
      count++; return new Response(JSON.stringify({ error: { code, type: 'provider_error', message: '测试服务商说明 sk-secret.very+private/key= Bearer hidden-token https://private.invalid/?token=x', request_id: 'req-business-12' } }), { headers: { 'content-type': 'application/json' } });
    } })), error => {
      assert.ok(error instanceof ModelError); assert.equal(error.category, category); assert.equal(error.providerCode, code);
      assert.equal(error.providerType, 'provider_error'); assert.equal(error.outcomeUnknown, uncertain); assert.equal(error.requestId, 'req-business-12');
      assert.match(error.diagnosticId!, /^[a-f0-9-]{36}$/); assert.match(error.providerMessage!, /测试服务商说明/);
      assert.doesNotMatch(JSON.stringify(error), /secret.very|private\/key|hidden-token|private.invalid/); return true;
    });
    assert.equal(count, 1); assert.equal(calls[0].outcome, 'dispatched'); assert.equal(calls.at(-1)?.outcome, uncertain ? 'unknown' : 'failed');
    assert.equal(calls.at(-1)?.requestId, 'req-business-12');
  }
});

test('SSE error after partial Chinese output remains uncertain and discards partial answer', async () => {
  let count = 0;
  await assert.rejects(callModel('s', 'u', { fetcher: async () => {
    count++; const payloads = [{ choices: [{ index: 0, delta: { content: '部分中文' }, finish_reason: null }] }, { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached', request_id: 'req-stream-3' } }];
    const bytes = new TextEncoder().encode(payloads.map(payload => `data: ${JSON.stringify(payload)}\n\n`).join(''));
    return new Response(new ReadableStream({ start(controller) { for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.slice(offset, offset + 3)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
  } }), error => { assert.ok(error instanceof ModelError); assert.equal(error.category, 'rate_limit'); assert.equal(error.outcomeUnknown, true); assert.equal(error.requestId, 'req-stream-3'); return true; });
  assert.equal(count, 1);
});

test('all configured provider credentials and arbitrary signed URLs are redacted from diagnostic text', () => {
  const original = process.env.IMAGE_API_KEY; process.env.IMAGE_API_KEY = 'private-image-token';
  try {
    const safe = redactProviderText('private-image-token credential-at-dispatch api_key=unknown-token https://images.invalid/signed?sig=secret', 'credential-at-dispatch');
    assert.doesNotMatch(safe, /private-image-token|credential-at-dispatch|unknown-token|images.invalid|sig=secret/);
    assert.equal(providerBusinessError({ choices: [] }), undefined);
    assert.equal(providerBusinessError({ success: false, message: '未知错误' })?.outcomeUnknown, true);
  } finally { if (original === undefined) delete process.env.IMAGE_API_KEY; else process.env.IMAGE_API_KEY = original; }
});
