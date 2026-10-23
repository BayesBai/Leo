import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { beginCanvaConnection, completeCanvaConnection } from '../server/integrations/canva.js';
import type { CanvaVerificationError } from '../shared/types.js';

test('Canva preflight HTTP diagnostics expose stage and safe error metadata without provider body or credentials', async () => {
  const native = globalThis.fetch;
  process.env.CANVA_CLIENT_ID = 'test-diagnostic-client';
  process.env.CANVA_CLIENT_SECRET = 'test-private-canva-secret';
  process.env.CANVA_REDIRECT_URI = 'http://127.0.0.1:3000/api/integrations/canva/callback';
  const app = await createApp({ apiOnly: true });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let mutations = 0;
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith(base)) return native(input, init);
      if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'test-private-access-token', refresh_token: 'test-private-refresh-token', token_type: 'Bearer', expires_in: 3600, scope: 'design:content:read design:content:write design:meta:read' });
      if (url.includes('/designs?limit=1')) return Response.json({ items: [] });
      if (url.endsWith('/mcp')) {
        const body = JSON.parse(String(init?.body));
        if (body.method === 'tools/call') mutations++;
        return Response.json({ error: { code: 'service_unavailable', message: 'test-private-access-token test-private-canva-secret https://example.com/private?token=secret' } }, { status: 503, headers: { 'x-request-id': 'test-canva-request-123' } });
      }
      assert.fail('Unexpected provider request');
    };
    const connection = beginCanvaConnection();
    await completeCanvaConnection({ state: new URL(connection.authorizationUrl).searchParams.get('state')!, code: 'test-private-code' });
    const response = await fetch(`${base}/api/integrations/canva/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await response.json() as CanvaVerificationError;
    assert.equal(response.status, 502); assert.equal(body.code, 'CANVA_PROVIDER');
    assert.equal(body.upstreamStatus, 503); assert.equal(body.providerCode, 'service_unavailable');
    assert.equal(body.phase, 'mcp.initialize'); assert.equal(body.requestId, 'test-canva-request-123');
    assert.equal(body.outcomeUnknown, false, 'read-only initialization cannot leave a design mutation or paid generation uncertain');
    assert.match(body.diagnosticId, /^[0-9a-f-]{36}$/); assert.equal(typeof body.retryable, 'boolean');
    assert.equal(mutations, 0);
    assert.doesNotMatch(JSON.stringify(body), /test-private|example\.com|token=|Bearer/);
  } finally {
    globalThis.fetch = native;
    for (const key of ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET', 'CANVA_REDIRECT_URI']) delete process.env[key];
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
