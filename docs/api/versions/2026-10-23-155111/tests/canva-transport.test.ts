import test from 'node:test';
import assert from 'node:assert/strict';
import { getGlobalDispatcher, ProxyAgent } from 'undici';
import { canvaFetch, canvaProxyStatus, CanvaTransportError, closeCanvaTransport } from '../server/integrations/canva-transport.js';
import { isCanvaHost, isCanvaUrl, parseCanvaUrl } from '../shared/canva-url.js';

const originalFetch = globalThis.fetch;
const originalProxy = process.env.CANVA_PROXY_URL;
test.afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (originalProxy === undefined) delete process.env.CANVA_PROXY_URL; else process.env.CANVA_PROXY_URL = originalProxy;
  await closeCanvaTransport();
});

test('Canva resource policy allows exact official domains and genuine subdomains', () => {
  for (const host of ['canva.com', 'www.canva.com', 'api.canva.com', 'export-download.canva.com', 'canva.ai', 'design.canva.ai', 'a.b.canva.ai', 'DESIGN.CANVA.AI']) assert.equal(isCanvaHost(host), true, host);
  for (const url of ['https://canva.com/design/example/edit', 'https://design.canva.ai/example', 'https://media.canva.com/a.png?signature=pure-mock-only', 'https://canva.ai:443/a']) assert.equal(isCanvaUrl(url), true, url);
  assert.equal(parseCanvaUrl('https://media.canva.com/a.png?signature=pure-mock-only')?.search, '?signature=pure-mock-only');
});

test('Canva resource policy rejects forged boundaries, non-HTTPS, credentials and dangerous addresses', () => {
  for (const host of ['canva.com.evil.example', 'evilcanva.com', 'canva.ai.evil.example', 'evilcanva.ai', 'canva.com.', '.canva.com', 'a..canva.ai', '-a.canva.com', '127.0.0.1', '[::1]']) assert.equal(isCanvaHost(host), false, host);
  for (const url of [undefined, {}, 'http://canva.com/a', 'ftp://canva.com/a', 'https://canva.com:8443/a', 'https://user:password@canva.com/a', 'https://canva.com@evil.example/a', 'https://evil.example/?next=canva.com', 'https://127.0.0.1/a', 'https://169.254.169.254/a', 'https://[::1]/a', 'https://canva.com.evil.example/a', 'https://canva.ai.evil.example/a']) assert.equal(isCanvaUrl(url), false, String(url));
});

test('Canva transport stays direct by default and leaves the global dispatcher unchanged', async () => {
  delete process.env.CANVA_PROXY_URL;
  const before = getGlobalDispatcher(); let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++; assert.equal(String(input), 'https://api.canva.com/connect/v1/mcp');
    assert.equal(init?.redirect, 'error'); assert.equal('dispatcher' in (init || {}), false);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer pure-mock-token');
    return new Response('{}', { status: 200 });
  };
  await canvaFetch('https://api.canva.com/connect/v1/mcp', { method: 'POST', headers: { Authorization: 'Bearer pure-mock-token' } });
  assert.equal(calls, 1); assert.equal(getGlobalDispatcher(), before);
  assert.deepEqual(canvaProxyStatus(), { configured: false, valid: true });
});

test('explicit local proxy supplies one reusable per-request dispatcher without logging configuration', async () => {
  process.env.CANVA_PROXY_URL = 'http://127.0.0.1:10808';
  const before = getGlobalDispatcher(); const seen: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    const agent = (init as RequestInit & { dispatcher?: unknown }).dispatcher;
    assert.ok(agent instanceof ProxyAgent); seen.push(agent);
    assert.equal(init?.redirect, 'error'); return new Response('{}');
  };
  await canvaFetch('https://api.canva.com/connect/v1/mcp');
  await canvaFetch(new URL('https://www.canva.com/.well-known/oauth-authorization-server'), { redirect: 'follow' });
  assert.equal(seen.length, 2); assert.equal(seen[0], seen[1]); assert.equal(getGlobalDispatcher(), before);
  assert.deepEqual(canvaProxyStatus(), { configured: true, valid: true });
  assert.equal(JSON.stringify(canvaProxyStatus()).includes('10808'), false);
});

test('proxy settings are read dynamically; disabling only affects subsequent Canva requests', async () => {
  const seen: unknown[] = [];
  globalThis.fetch = async (_input, init) => { seen.push((init as RequestInit & { dispatcher?: unknown }).dispatcher); return new Response('{}'); };
  process.env.CANVA_PROXY_URL = 'https://localhost:10808'; await canvaFetch('https://api.canva.com/a');
  process.env.CANVA_PROXY_URL = 'http://[::1]:10808'; await canvaFetch('https://api.canva.com/a');
  delete process.env.CANVA_PROXY_URL; await canvaFetch('https://api.canva.com/a');
  assert.ok(seen[0] instanceof ProxyAgent); assert.ok(seen[1] instanceof ProxyAgent); assert.notEqual(seen[0], seen[1]); assert.equal(seen[2], undefined);
});

test('invalid/remote proxy settings fail before fetch with no raw value in safe errors', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('must not be called'); };
  for (const value of ['socks5://127.0.0.1:10808', 'http://proxy.example:10808', 'http://127.0.0.1.evil.example:10808', 'http://user:super-private-password@127.0.0.1:10808', 'http://127.0.0.1:10808/?secret=pure-private-secret', 'http://127.0.0.1:10808/#secret', 'http://127.0.0.1:10808/path', 'http://127.0.0.1:0', 'not-a-url']) {
    process.env.CANVA_PROXY_URL = value;
    await assert.rejects(canvaFetch('https://api.canva.com/a'), error => {
      assert.ok(error instanceof CanvaTransportError); assert.equal(error.code, 'CANVA_PROXY_CONFIG');
      assert.equal(error.message.includes(value), false); assert.doesNotMatch(error.message, /super-private|pure-private/); return true;
    });
    assert.deepEqual(canvaProxyStatus(), { configured: true, valid: false });
  }
  assert.equal(calls, 0);
});

test('Canva transport rejects foreign destinations before dispatch and keeps public redirects manual', async () => {
  delete process.env.CANVA_PROXY_URL; let calls = 0;
  globalThis.fetch = async (_input, init) => { calls++; assert.equal(init?.redirect, 'manual'); return new Response(null, { status: 302, headers: { Location: 'https://design.canva.ai/pure-mock' } }); };
  await assert.rejects(canvaFetch('https://example.com/a'), { code: 'CANVA_URL' });
  assert.equal(calls, 0);
  const response = await canvaFetch('https://design.canva.ai/pure-mock', { redirect: 'manual' });
  assert.equal(response.status, 302); assert.equal(calls, 1);
});

test('proxy errors do not trigger retries or silent direct fallback', async () => {
  process.env.CANVA_PROXY_URL = 'http://127.0.0.1:10808'; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('pure-mock-network-failure'); };
  await assert.rejects(canvaFetch('https://api.canva.com/connect/v1/mcp'), /pure-mock-network-failure/);
  assert.equal(calls, 1);
});
