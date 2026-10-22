import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { updateConnections } from '../server/connections.js';
import { WorkflowError } from '../server/outlines.js';

async function fixture() {
  const app = await createApp({ apiOnly: true });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const authority = `127.0.0.1:${address.port}`;
  const request = (path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: address.port, path, method: options.method || 'GET', headers: { Host: authority, ...options.headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject); req.end(options.body);
  });
  return { server, authority, port: address.port, request, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test('HTTP rejects rebinding Hosts and cross-port writes before parsing JSON; same-origin development proxy is supported', async () => {
  const f = await fixture();
  try {
    for (const Host of ['untrusted.invalid', 'localhost.untrusted.invalid', 'user@localhost', 'localhost/path', '127.0.0.1.untrusted.invalid']) {
      assert.equal((await f.request('/api/task-options', { headers: { Host } })).status, 403);
    }
    assert.equal((await f.request('/api/task-options', { headers: { Host: 'localhost:5173' } })).status, 200);
    const body = '{}'; const json = { 'Content-Type': 'application/json' };
    assert.equal((await f.request('/api/connections/settings', { method: 'POST', body, headers: { ...json, Origin: `http://${f.authority}` } })).status, 200);
    assert.equal((await f.request('/api/connections/settings', { method: 'POST', body, headers: { ...json, Host: 'localhost:5173', Origin: 'http://localhost:5173' } })).status, 200);
    for (const Origin of ['http://localhost:5173', 'https://untrusted.invalid', `https://${f.authority}`, 'null', `http://user@${f.authority}`, `http://${f.authority}/path`]) {
      assert.equal((await f.request('/api/connections/settings', { method: 'POST', body: '{', headers: { ...json, Origin } })).status, 403);
    }
    assert.equal((await f.request('/api/connections/settings', { method: 'POST', body, headers: { ...json, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const malformed = await f.request('/api/outlines', { method: 'POST', body: '{', headers: json });
    assert.equal(malformed.status, 400); assert.equal(malformed.headers['cache-control'], 'no-store'); assert.equal(malformed.headers['x-content-type-options'], 'nosniff');
    const oversized = await f.request('/api/outlines', { method: 'POST', body: JSON.stringify({ instructions: 'x'.repeat(300_000) }), headers: json });
    assert.equal(oversized.status, 413); assert.equal(oversized.headers['cache-control'], 'no-store'); assert.equal(oversized.headers['x-content-type-options'], 'nosniff');
  } finally { await f.close(); }
});

test('validation errors never echo received enum values or unexpected field names', async () => {
  const f = await fixture(); const marker = 'test-only-sensitive-credential-12345';
  try {
    const enumError = await f.request('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platforms: [marker] }) });
    assert.equal(enumError.status, 400); assert.equal(enumError.body.includes(marker), false);
    const keyError = await f.request('/api/connections/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [marker]: 'x' }) });
    assert.equal(keyError.status, 400); assert.equal(keyError.body.includes(marker), false);
  } finally { await f.close(); }
});

test('runtime changes cannot extend the startup model host allowlist', () => {
  const old = process.env.LLM_BASE_URL;
  try {
    process.env.LLM_BASE_URL = 'https://not-in-startup-policy.invalid';
    assert.throws(() => updateConnections({ baseUrl: 'https://not-in-startup-policy.invalid' }), (error: unknown) => error instanceof WorkflowError && error.status === 400);
  } finally { if (old === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = old; }
});

test('cancelled HTTP operations retain concurrency and configuration locks until async work actually exits', async () => {
  const f = await fixture(); const originalFetch = globalThis.fetch; const oldKey = process.env.LLM_API_KEY;
  const pending: { release: () => void; aborted: Promise<void> }[] = [];
  let modelStarted!: () => void; let started = new Promise<void>(resolve => { modelStarted = resolve; });
  globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
    let markAborted!: () => void; const aborted = new Promise<void>(resolve => { markAborted = resolve; });
    pending.push({ release: () => reject(new Error('mock cancelled after cleanup')), aborted });
    init?.signal?.addEventListener('abort', markAborted, { once: true }); modelStarted();
  });
  process.env.LLM_API_KEY = 'test-only-model-key';
  try {
    for (let i = 0; i < 4; i++) {
      const req = http.request({ hostname: '127.0.0.1', port: f.port, path: '/api/connections/model/verify', method: 'POST', headers: { 'Content-Type': 'application/json' } });
      req.on('error', () => {}); req.end('{}'); await started; req.destroy(); await pending[i].aborted;
      started = new Promise<void>(resolve => { modelStarted = resolve; });
    }
    const settings = () => f.request('/api/connections/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await settings()).status, 409);
    assert.equal((await f.request('/api/connections/model/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 429);
    for (const item of pending) item.release();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal((await settings()).status, 200);
  } finally {
    for (const item of pending) item.release(); globalThis.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = oldKey;
    await f.close();
  }
});
