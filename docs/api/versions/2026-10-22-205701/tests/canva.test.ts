import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { stateStore } from '../server/state-store.js';
import { beginCanvaConnection, canvaConnectionStatus, canvaConnectionIdentity, completeCanvaConnection, disconnectCanva, importCanvaPptx, syncCanvaDesign, pruneCanvaState, type CanvaImportInput } from '../server/integrations/canva.js';
import { CanvaMcp } from '../server/integrations/canva-http.js';

const nativeFetch = globalThis.fetch;
const old = { id: process.env.CANVA_CLIENT_ID, secret: process.env.CANVA_CLIENT_SECRET, redirect: process.env.CANVA_REDIRECT_URI };
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const placeholder = 'VIRGO_HEADLINE_PLACEHOLDER';
const title = '开学轻装出发';
let calls: { url: string; body: any; headers: Headers }[];
let text: string;
let asset: string;
let position: number;
let failImport: boolean;
let unsafeExport: boolean;
let missingImage: boolean;
let rpcStream: boolean;
let tokenCalls: number;
let tokenExpiry: number;
const toolSchemas = [
  ['get-design-content', { design_id: { type: 'string' }, content_types: { type: 'array', items: { type: 'string' } } }],
  ['start-editing-transaction', { design_id: { type: 'string' } }],
  ['perform-editing-operations', { transaction_id: { type: 'string' }, page_index: { type: 'integer' }, operations: { type: 'array', items: { type: 'object', required: ['type', 'element_id', 'text'], properties: { type: { const: 'replace_text' }, element_id: { type: 'string' }, text: { type: 'string' } } } } }],
  ['commit-editing-transaction', { transaction_id: { type: 'string' } }],
  ['cancel-editing-transaction', { transaction_id: { type: 'string' } }],
  ['export-design', { design_id: { type: 'string' }, format: { type: 'string', enum: ['png'] }, width: { type: 'number' }, height: { type: 'number' } }],
] as const;
function json(data: any, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }); }
function elements() { return { transaction: { transaction_id: 'tx-1', status: 'open' }, richtexts: [{ element_id: 'headline-1', page_index: 1, regions: [{ type: 'character', text }], containerElement: { position: { top: position } } }], fills: missingImage ? [] : [{ type: 'image', asset_id: asset, page_index: 1, editable: true, element_id: 'product-1' }], pages: [{ page_id: 'p-1', dimension: { width: 1080, height: 1440 }, is_editable: true }] }; }
function rpc(id: number, result: any) {
  if (!result.protocolVersion && !result.tools) result = { structuredContent: result };
  if (!rpcStream) return json({ jsonrpc: '2.0', id, result });
  const bytes = Buffer.from(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`);
  // Split UTF-8 Chinese at byte boundaries and leave the stream open. The MCP
  // client must finish as soon as this JSON-RPC response has arrived.
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.subarray(i, i + 3)); }, cancel() {} });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}
async function mockFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input); const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
  calls.push({ url, body, headers: new Headers(init?.headers) });
  if (url.endsWith('/oauth/token')) { tokenCalls++; return json({ access_token: 'private-canva-access', refresh_token: `private-refresh-${tokenCalls}`, expires_in: tokenExpiry }); }
  if (url.endsWith('/oauth/revoke')) return new Response(null, { status: 204 });
  if (url === 'https://api.canva.com/rest/v1/imports') {
    if (failImport) throw new Error('socket broke with private-canva-access');
    return json({ job: { id: 'import-1', status: 'in_progress' } });
  }
  if (url.endsWith('/imports/import-1')) return json({ job: { id: 'import-1', status: 'success', result: { designs: [{ id: 'design-1', urls: { edit_url: 'https://www.canva.com/design/design-1/edit' } }] } } });
  if (url === 'https://api.canva.com/connect/v1/mcp') {
    if (body.method === 'initialize') return rpc(body.id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Canva', version: 'mock' } });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (body.method === 'tools/list') return rpc(body.id, { tools: toolSchemas.map(([name, properties]) => ({ name, inputSchema: { type: 'object', properties: { ...properties, user_intent: { type: 'string' } }, required: [...Object.keys(properties).filter(p => !['width', 'height'].includes(p)), 'user_intent'], additionalProperties: false } })) });
    assert.equal(body.method, 'tools/call'); const { name, arguments: args } = body.params;
    if (name === 'get-design-content') return rpc(body.id, { id: 'design-1', text, metadata: { page_count: 1 } });
    if (name === 'start-editing-transaction') return rpc(body.id, elements());
    if (name === 'perform-editing-operations') { assert.equal(args.operations[0].element_id, 'headline-1'); text = args.operations[0].text; return rpc(body.id, { edit_operation_results: [{ status: 'success' }] }); }
    if (name === 'commit-editing-transaction') return rpc(body.id, { transaction: { id: 'tx-1', status: 'committed' } });
    if (name === 'cancel-editing-transaction') return rpc(body.id, { transaction: { id: 'tx-1', status: 'cancelled' } });
    if (name === 'export-design') return rpc(body.id, { job: { id: 'export-1', status: 'success', urls: [unsafeExport ? 'http://127.0.0.1:3000/private' : 'https://export-download.canva.com/opaque-signed-url?signature=secret'] } });
    throw new Error(`unexpected tool ${name}`);
  }
  if (url.startsWith('https://export-download.canva.com/')) { assert.equal(new Headers(init?.headers).has('authorization'), false); return new Response(png, { headers: { 'content-type': 'image/png' } }); }
  throw new Error(`unexpected URL ${url}`);
}
beforeEach(() => {
  calls = []; text = placeholder; asset = 'verified-product-asset'; position = 100; failImport = false; unsafeExport = false; missingImage = false; rpcStream = false; tokenCalls = 0; tokenExpiry = 3600;
  process.env.CANVA_CLIENT_ID = 'test-client'; process.env.CANVA_CLIENT_SECRET = 'private-canva-client-secret'; process.env.CANVA_REDIRECT_URI = 'http://127.0.0.1:3000/api/integrations/canva/callback';
  stateStore().update(b => { b.canvaCredentials = {}; b.canvaOAuth = {}; b.canvaOperations = {}; b.canvaDesignBaselines = {}; });
  globalThis.fetch = mockFetch as typeof fetch;
});
afterEach(() => { globalThis.fetch = nativeFetch; for (const [key, value] of [['CANVA_CLIENT_ID', old.id], ['CANVA_CLIENT_SECRET', old.secret], ['CANVA_REDIRECT_URI', old.redirect]]) if (value === undefined) delete process.env[key!]; else process.env[key!] = value; });
async function authorize() {
  const started = beginCanvaConnection(); const url = new URL(started.authorizationUrl);
  await completeCanvaConnection({ state: url.searchParams.get('state')!, code: 'one-use-code' }); return started;
}
function importInput(): CanvaImportInput { return { operationId: randomUUID(), bytes: Buffer.from('mock-layered-pptx'), title, platform: 'xiaohongshu', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), verificationEdit: { from: placeholder, to: title }, expectedText: [title], expectedImageCount: 1, width: 1080, height: 1440 }; }

test('Canva missing app credentials blocks without external requests', async () => {
  delete process.env.CANVA_CLIENT_SECRET;
  assert.equal(canvaConnectionStatus().configured, false);
  assert.throws(() => beginCanvaConnection(), (e: any) => e.code === 'CANVA_NOT_CONFIGURED');
  await assert.rejects(importCanvaPptx(importInput()), (e: any) => e.code === 'CANVA_NOT_CONFIGURED');
  assert.equal(calls.length, 0);
});
test('OAuth uses state, S256 PKCE and one-use server-only verifier; public result omits secrets', async () => {
  const started = beginCanvaConnection(); const url = new URL(started.authorizationUrl);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const state = url.searchParams.get('state')!; const pending = stateStore().get<any>('canvaOAuth', createHash('sha256').update(state).digest('hex'));
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(pending.verifier).digest('base64url'));
  assert.equal(started.authorizationUrl.includes(pending.verifier), false);
  await assert.rejects(completeCanvaConnection({ state: 'wrong', code: 'secret-code' }), (e: any) => e.code === 'CANVA_OAUTH_STATE');
  assert.equal(calls.length, 0);
  const status = await completeCanvaConnection({ state, code: 'one-use-code' });
  assert.equal(status.connected, true); assert.equal(JSON.stringify(status).includes('private-'), false);
  const tokenRequest = calls[0]; assert.ok(tokenRequest.headers.get('authorization')?.startsWith('Basic '));
  assert.equal((tokenRequest.body as URLSearchParams).get('code_verifier'), pending.verifier);
  await assert.rejects(completeCanvaConnection({ state, code: 'one-use-code' }), (e: any) => e.code === 'CANVA_OAUTH_STATE');
});
test('layered binary import really reads, edits, commits and exports; persisted success is reused without requests or TTL renewal', async () => {
  await authorize(); rpcStream = true; const input = importInput(); const phases: string[] = []; input.onCheckpoint = cp => { phases.push(cp.phase); };
  const result = await importCanvaPptx(input);
  assert.equal(result.design.status, 'exported'); assert.equal(result.inspection.text, title);
  assert.equal(result.inspection.textElementCount, 1); assert.equal(result.inspection.imageElementCount, 1);
  assert.deepEqual(phases, ['import_dispatched', 'import_pending', 'imported', 'edit_dispatched', 'verified', 'export_dispatched', 'exported']);
  const importRequest = calls.find(c => c.url === 'https://api.canva.com/rest/v1/imports')!;
  assert.equal(importRequest.headers.get('content-type'), 'application/octet-stream');
  assert.equal(JSON.parse(importRequest.headers.get('import-metadata')!).mime_type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(Buffer.from(importRequest.body).toString(), input.bytes.toString());
  const checkpoint = stateStore().get<any>('canvaOperations', input.operationId);
  assert.equal(checkpoint.expiresAt, input.expiresAt); assert.equal(JSON.stringify(checkpoint).includes('signature='), false);
  assert.equal((await stat(checkpoint.files[0].path)).mode & 0o777, 0o600);
  const count = calls.length; assert.equal((await importCanvaPptx({ ...input, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() })).files[0].sha256, result.files[0].sha256);
  assert.equal(calls.length, count); assert.equal(stateStore().get<any>('canvaOperations', input.operationId).expiresAt, input.expiresAt);
});
test('uncertain import persists dispatched marker and is not automatically replayed', async () => {
  await authorize(); failImport = true; const input = importInput();
  await assert.rejects(importCanvaPptx(input), (e: any) => e.code === 'CANVA_NETWORK' && e.outcomeUnknown && !e.message.includes('private-'));
  assert.equal(stateStore().get<any>('canvaOperations', input.operationId).phase, 'import_dispatched');
  failImport = false;
  await assert.rejects(importCanvaPptx(input), (e: any) => e.code === 'CANVA_IMPORT_UNKNOWN');
  assert.equal(calls.filter(c => c.url === 'https://api.canva.com/rest/v1/imports').length, 1);
});
test('pending import resumes original remote job and missing independent image layers blocks export', async () => {
  await authorize(); const input = importInput(); let stopped = false;
  input.onCheckpoint = cp => { if (cp.phase === 'import_pending' && !stopped) { stopped = true; throw new Error('simulated crash after durable job ID'); } };
  await assert.rejects(importCanvaPptx(input), /simulated crash/);
  input.onCheckpoint = undefined; missingImage = true;
  await assert.rejects(importCanvaPptx(input), (e: any) => e.code === 'CANVA_LAYERS_INVALID');
  assert.equal(calls.filter(c => c.url === 'https://api.canva.com/rest/v1/imports').length, 1);
  assert.equal(calls.some(c => c.body?.params?.name === 'export-design'), false);
});
test('Canva sync preserves review for layout-only change and revokes for text or product changes', async () => {
  await authorize(); const input = importInput(); const imported = await importCanvaPptx(input);
  position = 999;
  const layout = await syncCanvaDesign({ design: imported.design, expiresAt: input.expiresAt });
  assert.equal(layout.contentChanged, false); assert.equal(layout.design.status, 'exported');
  asset = 'different-product';
  assert.equal((await syncCanvaDesign({ design: imported.design, expiresAt: input.expiresAt })).contentChanged, true);
  asset = 'verified-product-asset'; text = '新增未经审核的文案';
  assert.equal((await syncCanvaDesign({ design: imported.design, expiresAt: input.expiresAt })).contentChanged, true);
});
test('expired resource never contacts Canva and signed download cannot reach a private host', async () => {
  await authorize(); const input = importInput(); const count = calls.length;
  await assert.rejects(importCanvaPptx({ ...input, expiresAt: new Date(Date.now() - 1).toISOString() }), (e: any) => e.code === 'CANVA_ASSET_EXPIRED');
  assert.equal(calls.length, count); unsafeExport = true;
  await assert.rejects(importCanvaPptx(input), (e: any) => e.code === 'CANVA_EXPORT_HOST');
  assert.equal(calls.some(c => c.url.includes('127.0.0.1')), false);
});
test('token refresh is serialized; changed app credentials require a fresh authorization', async () => {
  tokenExpiry = 1; await authorize(); tokenExpiry = 3600;
  const first = importInput(); const second = { ...importInput(), platform: 'poster' as const };
  const results = await Promise.allSettled([importCanvaPptx(first), importCanvaPptx(second)]);
  // The mocked design ID is shared and its placeholder can only be replaced once;
  // this test asserts OAuth behavior rather than concurrent design semantics.
  assert.equal(results.length, 2); assert.equal(tokenCalls, 2);
  process.env.CANVA_CLIENT_SECRET = 'new-secret'; assert.equal(canvaConnectionStatus().connected, false);
  await assert.rejects(importCanvaPptx(importInput()), (e: any) => e.code === 'CANVA_NOT_CONNECTED');
});
test('MCP tool schema mismatch fails before a tool mutation and disconnect removes local token', async () => {
  await authorize(); const mcp = new CanvaMcp(async () => 'private-canva-access'); await mcp.connect();
  await assert.rejects(mcp.call('perform-editing-operations', { made_up_operation: 'add_text' }, 'invalid'), (e: any) => e.code === 'CANVA_TOOL_SCHEMA');
  assert.equal(calls.some(c => c.body?.params?.name === 'perform-editing-operations'), false);
  assert.equal((await disconnectCanva()).connected, false); assert.equal(stateStore().get('canvaCredentials', 'user'), undefined);
});
test('a second OAuth authorization cannot reuse a previous account checkpoint', async () => {
  await authorize(); const identity = canvaConnectionIdentity(); const input = importInput();
  await importCanvaPptx({ ...input, expectedConnectionId: identity });
  await authorize(); assert.notEqual(canvaConnectionIdentity(), identity);
  const count = calls.length;
  await assert.rejects(importCanvaPptx(input), (e: any) => e.code === 'CANVA_CONNECTION_CHANGED');
  await assert.rejects(importCanvaPptx({ ...importInput(), expectedConnectionId: identity }), (e: any) => e.code === 'CANVA_CONNECTION_CHANGED');
  assert.equal(calls.length, count);
});
test('unknown rotating-token refresh is not repeated after restart markers survive', async () => {
  tokenExpiry = 1; await authorize();
  globalThis.fetch = (async () => { throw new Error('network lost with private-refresh-1'); }) as typeof fetch;
  await assert.rejects(importCanvaPptx(importInput()), (e: any) => e.code === 'CANVA_OAUTH_UNKNOWN' && !e.message.includes('private-'));
  assert.ok(stateStore().get<any>('canvaCredentials', 'user').refreshing);
  assert.equal(canvaConnectionStatus().connected, false);
  globalThis.fetch = mockFetch as typeof fetch;
  const count = calls.length;
  await assert.rejects(importCanvaPptx(importInput()), (e: any) => e.code === 'CANVA_OAUTH_UNKNOWN');
  assert.equal(calls.length, count);
});
test('cancel before dispatch does not import; concurrent operation ID with different content is rejected', async () => {
  await authorize(); const controller = new AbortController(); controller.abort();
  const input = importInput(); await assert.rejects(importCanvaPptx({ ...input, signal: controller.signal }));
  assert.equal(calls.some(c => c.url.endsWith('/imports')), false);
  const first = importCanvaPptx(input);
  await assert.rejects(importCanvaPptx({ ...input, bytes: Buffer.from('different-pptx') }), (e: any) => e.code === 'CANVA_VERSION_CONFLICT');
  await first;
});
test('Canva resource cleanup removes expired bytes and keeps unknown-operation diagnostics seven days', async () => {
  await authorize(); const input = importInput(); await importCanvaPptx(input);
  const checkpoint = stateStore().get<any>('canvaOperations', input.operationId);
  await pruneCanvaState(Date.parse(input.expiresAt) + 1);
  await assert.rejects(stat(checkpoint.files[0].path), (e: any) => e.code === 'ENOENT');
  assert.ok(stateStore().get('canvaOperations', input.operationId));
  await pruneCanvaState(Date.parse(input.expiresAt) + 7 * 86400_000 + 1);
  assert.equal(stateStore().get('canvaOperations', input.operationId), undefined);
});
test('corrupt authorization records are retained and never cause an external request', async () => {
  stateStore().set('canvaCredentials', 'user', { accessToken: 'private-secret', expiresAt: 'invalid' });
  assert.throws(canvaConnectionStatus, (e: any) => e.code === 'CANVA_STATE_CORRUPT' && !e.message.includes('private-secret'));
  await assert.rejects(importCanvaPptx(importInput()), (e: any) => e.code === 'CANVA_STATE_CORRUPT');
  assert.equal(stateStore().get<any>('canvaCredentials', 'user').accessToken, 'private-secret'); assert.equal(calls.length, 0);
});
