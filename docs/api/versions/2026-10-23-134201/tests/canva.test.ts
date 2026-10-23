import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { stateStore } from '../server/state-store.js';
import { beginCanvaConnection, canvaConnectionStatus, canvaConnectionIdentity, completeCanvaConnection, disconnectCanva, importCanvaPptx, syncCanvaDesign, pruneCanvaState, verifyCanvaConnection, CANVA_MCP_RESOURCE, type CanvaImportInput } from '../server/integrations/canva.js';
import { CanvaMcp, safeCanvaRequestId } from '../server/integrations/canva-http.js';
import { canvaMetadataResponse } from './fixtures/canva-metadata.js';
import { discoverCanvaOAuth, CANVA_OAUTH_VERSION } from '../server/integrations/canva-oauth.js';

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
let imageEditable: boolean | undefined;
let missingImageElementId: boolean;
let rpcStream: boolean;
let tokenCalls: number;
let tokenExpiry: number;
let extraEditRequirement: boolean;
let exportFormatAnyOf: boolean;
let restDenied: boolean;
let preflightErrorStage: 'rest' | 'initialize' | 'notify' | 'list' | undefined;
let extraLockedImage: boolean;
let designKeyMode: 'legacy' | 'id' | 'mixed' | 'missing';
function designKey(name: string) { return designKeyMode === 'id' || designKeyMode === 'mixed' && name !== 'start-editing-transaction' ? 'id' : 'design_id'; }
const toolSchemas = [
  ['get-design-content', { design_id: { type: 'string' }, content_types: { type: 'array', items: { type: 'string' } } }],
  ['start-editing-transaction', { design_id: { type: 'string' } }],
  ['perform-editing-operations', { transaction_id: { type: 'string' }, page_index: { type: 'integer' }, operations: { type: 'array', items: { type: 'object', required: ['type', 'element_id', 'text'], properties: { type: { const: 'replace_text' }, element_id: { type: 'string' }, text: { type: 'string' } } } } }],
  ['commit-editing-transaction', { transaction_id: { type: 'string' } }],
  ['cancel-editing-transaction', { transaction_id: { type: 'string' } }],
  ['export-design', { design_id: { type: 'string' }, format: { type: 'string', enum: ['png'] }, width: { type: 'number' }, height: { type: 'number' } }],
] as const;
function discoveredTools() {
  return toolSchemas.map(([name, properties]) => {
    const inputSchema: any = { type: 'object', properties: { ...properties, user_intent: { type: 'string' } }, required: [...Object.keys(properties).filter(p => !['width', 'height'].includes(p)), 'user_intent'], additionalProperties: false };
    if ('design_id' in properties && designKeyMode !== 'legacy') {
      delete inputSchema.properties.design_id; inputSchema.required = inputSchema.required.filter((key: string) => key !== 'design_id');
      if (designKeyMode !== 'missing') { inputSchema.properties[designKey(name)] = { type: 'string' }; inputSchema.required.push(designKey(name)); }
    }
    if (extraEditRequirement && name === 'perform-editing-operations') { inputSchema.properties.layout_mode = { type: 'string' }; inputSchema.required.push('layout_mode'); }
    if (exportFormatAnyOf && name === 'export-design') inputSchema.properties.format = { anyOf: [{ type: 'string', enum: ['pdf'] }, { type: 'object', properties: { type: { const: 'png' } }, required: ['type'], additionalProperties: false }] };
    return { name, inputSchema };
  });
}
function json(data: any, status = 200, headers: Record<string, string> = {}) { return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } }); }
function elements() {
  const fills = missingImage ? [] : [{ type: 'image', asset_id: asset, page_index: 1, ...(imageEditable === undefined ? {} : { editable: imageEditable }), ...(missingImageElementId ? {} : { element_id: 'product-1' }) }];
  if (extraLockedImage) fills.push({ type: 'image', asset_id: 'locked-product-asset', page_index: 1, editable: false, element_id: 'locked-product' });
  return { transaction: { transaction_id: 'tx-1', status: 'open' }, richtexts: [{ element_id: 'headline-1', page_index: 1, regions: [{ type: 'character', text }], containerElement: { position: { top: position } } }], fills, pages: [{ page_id: 'p-1', dimension: { width: 1080, height: 1440 }, is_editable: true }] };
}
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
  const metadata = canvaMetadataResponse(url); if (metadata) { assert.equal(new Headers(init?.headers).has('authorization'), false); return metadata; }
  if (url.endsWith('/oauth/token')) { tokenCalls++; return json({ access_token: 'private-canva-access', refresh_token: `private-refresh-${tokenCalls}`, expires_in: tokenExpiry }); }
  if (url.endsWith('/oauth/revoke')) return new Response(null, { status: 204 });
  if (url === 'https://api.canva.com/rest/v1/designs?limit=1') return preflightErrorStage === 'rest' ? json({ error: 'internal_error' }, 503, { 'x-request-id': 'rest-req-1' }) : restDenied ? json({ code: 'permission_denied' }, 403) : json({ items: [] });
  if (url === 'https://api.canva.com/rest/v1/imports') {
    if (failImport) throw new Error('socket broke with private-canva-access');
    return json({ job: { id: 'import-1', status: 'in_progress' } });
  }
  if (url.endsWith('/imports/import-1')) return json({ job: { id: 'import-1', status: 'success', result: { designs: [{ id: 'design-1', urls: { edit_url: 'https://www.canva.com/design/design-1/edit' } }] } } });
  if (url === 'https://api.canva.com/connect/v1/mcp') {
    if (body.method === 'initialize') return preflightErrorStage === 'initialize' ? json({ error: 'internal_error', message: 'upstream details are not exposed' }, 500, { 'x-canva-request-id': 'mcp-init-7' }) : rpc(body.id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Canva', version: 'mock' } });
    if (body.method === 'notifications/initialized') return preflightErrorStage === 'notify' ? json({ error: 'internal_error' }, 503, { 'request-id': 'notify-req' }) : new Response(null, { status: 202 });
    if (body.method === 'tools/list') return preflightErrorStage === 'list' ? json({ jsonrpc: '2.0', id: body.id, error: { code: -32001, message: 'safe synthetic failure' } }, 200, { 'trace-id': 'list-trace' }) : rpc(body.id, { tools: discoveredTools() });
    assert.equal(body.method, 'tools/call'); const { name, arguments: args } = body.params;
    if (['get-design-content', 'start-editing-transaction', 'export-design'].includes(name)) {
      assert.equal(args[designKey(name)], 'design-1');
      assert.equal(args[designKey(name) === 'id' ? 'design_id' : 'id'], undefined, 'only the field declared by this tool is sent');
    }
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
  calls = []; text = placeholder; asset = 'verified-product-asset'; position = 100; failImport = false; unsafeExport = false; missingImage = false; imageEditable = true; missingImageElementId = false; rpcStream = false; tokenCalls = 0; tokenExpiry = 3600; extraEditRequirement = false; exportFormatAnyOf = false; restDenied = false; preflightErrorStage = undefined; extraLockedImage = false; designKeyMode = 'legacy';
  process.env.CANVA_CLIENT_ID = 'test-client'; process.env.CANVA_CLIENT_SECRET = 'private-canva-client-secret'; process.env.CANVA_REDIRECT_URI = 'http://127.0.0.1:3000/api/integrations/canva/callback';
  stateStore().update(b => { b.canvaCredentials = {}; b.canvaOAuth = {}; b.canvaOperations = {}; b.canvaDesignBaselines = {}; });
  globalThis.fetch = mockFetch as typeof fetch;
});
afterEach(() => { globalThis.fetch = nativeFetch; for (const [key, value] of [['CANVA_CLIENT_ID', old.id], ['CANVA_CLIENT_SECRET', old.secret], ['CANVA_REDIRECT_URI', old.redirect]]) if (value === undefined) delete process.env[key!]; else process.env[key!] = value; });
async function authorize() {
  const started = await beginCanvaConnection(); const url = new URL(started.authorizationUrl);
  await completeCanvaConnection({ state: url.searchParams.get('state')!, code: 'one-use-code' }); return started;
}
function importInput(): CanvaImportInput { return { operationId: randomUUID(), bytes: Buffer.from('mock-layered-pptx'), title, platform: 'xiaohongshu', expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), verificationEdit: { from: placeholder, to: title }, expectedText: [title], expectedImageCount: 1, width: 1080, height: 1440 }; }

test('Canva missing app credentials blocks without external requests', async () => {
  delete process.env.CANVA_CLIENT_SECRET;
  assert.equal(canvaConnectionStatus().configured, false);
  await assert.rejects(beginCanvaConnection(), (e: any) => e.code === 'CANVA_NOT_CONFIGURED');
  await assert.rejects(importCanvaPptx(importInput()), (e: any) => e.code === 'CANVA_NOT_CONFIGURED');
  assert.equal(calls.length, 0);
});
test('OAuth uses state, S256 PKCE and one-use server-only verifier; public result omits secrets', async () => {
  const started = await beginCanvaConnection(); const url = new URL(started.authorizationUrl);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('resource'), CANVA_MCP_RESOURCE);
  const state = url.searchParams.get('state')!; const pending = stateStore().get<any>('canvaOAuth', createHash('sha256').update(state).digest('hex'));
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(pending.verifier).digest('base64url'));
  assert.equal(started.authorizationUrl.includes(pending.verifier), false);
  await assert.rejects(completeCanvaConnection({ state: 'wrong', code: 'secret-code' }), (e: any) => e.code === 'CANVA_OAUTH_STATE');
  assert.equal(calls.filter(c => c.url.endsWith('/oauth/token')).length, 0);
  const status = await completeCanvaConnection({ state, code: 'one-use-code' });
  assert.equal(status.connected, true); assert.equal(JSON.stringify(status).includes('private-'), false);
  const tokenRequest = calls.find(c => c.url.endsWith('/oauth/token'))!; assert.ok(tokenRequest.headers.get('authorization')?.startsWith('Basic '));
  assert.equal(tokenRequest.url, 'https://api.canva.com/auth/v1/oauth/token');
  assert.equal((tokenRequest.body as URLSearchParams).get('code_verifier'), pending.verifier);
  assert.equal((tokenRequest.body as URLSearchParams).get('resource'), CANVA_MCP_RESOURCE);
  assert.equal(stateStore().get<any>('canvaCredentials', 'user').authorizationResource, CANVA_MCP_RESOURCE);
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
  imageEditable = false;
  assert.equal((await syncCanvaDesign({ design: imported.design, expiresAt: input.expiresAt })).contentChanged, false, 'locking a reviewed layer does not change its product asset or wording');
  imageEditable = true;
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
  const tokenRequests = calls.filter(call => call.url.endsWith('/oauth/token'));
  assert.equal(tokenRequests.find(call => (call.body as URLSearchParams).get('grant_type') === 'refresh_token')?.body.get('resource'), CANVA_MCP_RESOURCE);
  assert.ok(tokenRequests.every(call => (call.body as URLSearchParams).get('resource') === CANVA_MCP_RESOURCE));
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
  globalThis.fetch = (async (input, init) => { if (String(input).endsWith('/oauth/token')) throw new Error('network lost with private-refresh-1'); return mockFetch(input, init); }) as typeof fetch;
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
test('Canva preflight checks all live fixed argument shapes without any tool call or external mutation', async () => {
  await authorize(); const result = await verifyCanvaConnection();
  assert.equal(result.connected, true); assert.equal(result.tools.length, 6);
  assert.equal(calls.some(call => call.body?.method === 'tools/call'), false);
  assert.equal(calls.some(call => call.url.endsWith('/imports') || call.url.includes('/images/')), false);
});
test('Canva preflight rejects a new required editing field before image generation or importing', async () => {
  await authorize(); extraEditRequirement = true;
  await assert.rejects(verifyCanvaConnection(), (e: any) => e.code === 'CANVA_TOOL_SCHEMA' && e.message.includes('perform-editing-operations'));
  assert.equal(calls.some(call => call.body?.method === 'tools/call'), false);
  assert.equal(calls.some(call => call.url.endsWith('/imports') || call.url.includes('/images/')), false);
});
test('Canva preflight accepts the legal anyOf object variant for PNG export', async () => {
  await authorize(); exportFormatAnyOf = true;
  assert.equal((await verifyCanvaConnection()).connected, true);
  assert.equal(calls.some(call => call.body?.method === 'tools/call'), false);
});
test('per-tool id and design_id schemas drive both read-only preflight and the complete layered import, edit, export and sync workflow', async () => {
  await authorize(); designKeyMode = 'mixed'; exportFormatAnyOf = true;
  assert.equal((await verifyCanvaConnection()).connected, true);
  assert.equal(calls.some(call => call.body?.method === 'tools/call'), false, 'preflight validates only; no design operations are dispatched');
  const input = importInput(); const result = await importCanvaPptx(input);
  assert.equal(result.design.status, 'exported'); assert.equal(result.inspection.text, title);
  const synced = await syncCanvaDesign({ design: result.design, expiresAt: input.expiresAt });
  assert.equal(synced.contentChanged, false); assert.equal(synced.files[0].mime, 'image/png');
  for (const name of ['get-design-content', 'start-editing-transaction', 'export-design']) {
    const toolCalls = calls.filter(call => call.body?.params?.name === name);
    assert.ok(toolCalls.length > 0);
    assert.ok(toolCalls.every(call => call.body.params.arguments[designKey(name)] === 'design-1'));
  }
  assert.ok(calls.filter(call => call.body?.params?.name === 'export-design').every(call => call.body.params.arguments.format.type === 'png'));
});
test('id-only tool schemas are accepted but an undeclared identifier fails preflight before any import or mutation', async () => {
  await authorize(); designKeyMode = 'id'; assert.equal((await verifyCanvaConnection()).connected, true);
  designKeyMode = 'missing';
  await assert.rejects(verifyCanvaConnection(), (error: any) => error.code === 'CANVA_TOOL_SCHEMA' && error.phase === 'mcp.get-design-content');
  assert.equal(calls.some(call => call.body?.method === 'tools/call' || call.url.endsWith('/imports')), false);
});
test('REST disabled fails the read-only preflight before any image, import or MCP mutation', async () => {
  await authorize(); restDenied = true;
  await assert.rejects(verifyCanvaConnection(), (e: any) => e.code === 'CANVA_REST_PERMISSION' && e.upstreamStatus === 403);
  assert.equal(calls.some(call => call.body?.method === 'tools/call'), false);
  assert.equal(calls.some(call => call.url.endsWith('/imports') || call.url.includes('/images/')), false);
});
test('locked images, unknown editability and unaddressable image layers cannot pass layered delivery verification', async () => {
  await authorize();
  for (const scenario of [{ editable: false, missingId: false }, { editable: undefined, missingId: false }, { editable: true, missingId: true }]) {
    imageEditable = scenario.editable; missingImageElementId = scenario.missingId;
    await assert.rejects(importCanvaPptx(importInput()), (e: any) => e.code === 'CANVA_LAYERS_INVALID');
  }
  assert.equal(calls.some(call => call.body?.params?.name === 'perform-editing-operations'), false);
  assert.equal(calls.some(call => call.body?.params?.name === 'export-design'), false);
});
test('all expected image layers must be editable even when another background image is editable', async () => {
  await authorize(); extraLockedImage = true;
  await assert.rejects(importCanvaPptx({ ...importInput(), expectedImageCount: 2 }), (e: any) => e.code === 'CANVA_LAYERS_INVALID');
  assert.equal(calls.some(call => call.body?.params?.name === 'perform-editing-operations'), false);
  assert.equal(calls.some(call => call.body?.params?.name === 'export-design'), false);
});
test('read-only preflight exposes the fixed failed phase, safe upstream ID and provider code without uncertain-design warnings', async () => {
  await authorize();
  const scenarios = [
    { stage: 'rest', phase: 'rest.preflight', status: 503, providerCode: 'internal_error', requestId: 'rest-req-1' },
    { stage: 'initialize', phase: 'mcp.initialize', status: 500, providerCode: 'internal_error', requestId: 'mcp-init-7' },
    { stage: 'notify', phase: 'mcp.initialized', status: 503, providerCode: 'internal_error', requestId: 'notify-req' },
    { stage: 'list', phase: 'mcp.tools-list', status: 200, providerCode: '-32001', requestId: 'list-trace' },
  ] as const;
  for (const scenario of scenarios) {
    preflightErrorStage = scenario.stage;
    await assert.rejects(verifyCanvaConnection(), (error: any) => {
      assert.equal(error.phase, scenario.phase); assert.equal(error.upstreamStatus, scenario.status);
      assert.equal(error.providerCode, scenario.providerCode); assert.equal(error.requestId, scenario.requestId);
      assert.equal(error.outcomeUnknown, false); assert.match(error.diagnosticId, /^[a-f0-9-]{36}$/);
      assert.doesNotMatch(error.message, /结果不确定|已有设计|再次产生消耗|private-canva/);
      return true;
    });
  }
  assert.equal(calls.some(call => call.body?.method === 'tools/call'), false);
});
test('only safe whitelisted request headers survive diagnostics; credentials, URLs and unsupported headers do not', () => {
  assert.equal(safeCanvaRequestId(new Headers({ 'x-request-id': 'req-safe_1.2:3' })), 'req-safe_1.2:3');
  assert.equal(safeCanvaRequestId(new Headers({ 'x-request-id': 'private-canva-access', 'trace-id': 'fallback-safe' }), ['private-canva-access']), 'fallback-safe');
  assert.equal(safeCanvaRequestId(new Headers({ 'x-request-id': process.env.CANVA_CLIENT_SECRET! })), undefined);
  assert.equal(safeCanvaRequestId(new Headers({ 'x-request-id': 'https://canva.com/opaque-signed?token=secret' })), undefined);
  assert.equal(safeCanvaRequestId(new Headers({ 'x-unsupported-id': 'not-exposed' })), undefined);
});
test('legacy REST-only tokens are retained but require new resource-bound authorization without automatic refresh', async () => {
  await authorize(); const original = stateStore().get<any>('canvaCredentials', 'user');
  const legacyHash = createHash('sha256').update(`${process.env.CANVA_CLIENT_ID}\0${process.env.CANVA_CLIENT_SECRET}\0${process.env.CANVA_REDIRECT_URI}`).digest('hex');
  assert.notEqual(original.configHash, legacyHash, 'the OAuth configuration hash binds resource, authorization version and scopes');
  const legacy = { ...original, configHash: legacyHash, expiresAt: Date.now() - 1 };
  delete legacy.authorizationResource; delete legacy.authorizationVersion;
  stateStore().set('canvaCredentials', 'user', legacy); const count = calls.length;
  assert.equal(canvaConnectionStatus().connected, false); assert.match(canvaConnectionStatus().message, /授权目标|MCP/);
  assert.equal(canvaConnectionIdentity(), undefined);
  await assert.rejects(verifyCanvaConnection(), (e: any) => e.code === 'CANVA_NOT_CONNECTED');
  assert.equal(calls.length, count, 'an old grant must not be refreshed into a different audience');
  assert.deepEqual(stateStore().get('canvaCredentials', 'user'), legacy, 'retain the old record without falsely migrating authorization metadata');
  stateStore().set('canvaCredentials', 'user', { ...original, authorizationResource: 'https://example.invalid/other-resource' });
  assert.equal(canvaConnectionStatus().connected, false); assert.equal(canvaConnectionIdentity(), undefined);
});
test('pre-resource OAuth pending state cannot exchange a code under the new resource-bound configuration', async () => {
  const url = new URL((await beginCanvaConnection()).authorizationUrl); const state = url.searchParams.get('state')!;
  const key = createHash('sha256').update(state).digest('hex'); const pending = stateStore().get<any>('canvaOAuth', key);
  pending.configHash = createHash('sha256').update(`${process.env.CANVA_CLIENT_ID}\0${process.env.CANVA_CLIENT_SECRET}\0${process.env.CANVA_REDIRECT_URI}`).digest('hex');
  delete pending.authorizationResource; delete pending.authorizationVersion;
  stateStore().set('canvaOAuth', key, pending);
  await assert.rejects(completeCanvaConnection({ state, code: 'unused-legacy-code' }), (e: any) => e.code === 'CANVA_OAUTH_STATE');
  assert.equal(calls.filter(c => c.url.endsWith('/oauth/token')).length, 0); assert.deepEqual(stateStore().get('canvaOAuth', key), pending);
});

function resourceV1Grant() {
  const hash = createHash('sha256').update(`${process.env.CANVA_CLIENT_ID}\0${process.env.CANVA_CLIENT_SECRET}\0${process.env.CANVA_REDIRECT_URI}\0${CANVA_MCP_RESOURCE}\0mcp-resource-v1\0design:content:read design:content:write design:meta:read`).digest('hex');
  return { accessToken: 'old-rest-access-never-for-mcp', refreshToken: 'same-user-resource-bound-refresh', expiresAt: Date.now() + 3_600_000,
    configHash: hash, generation: randomUUID(), connectionId: randomUUID(), authorizationResource: CANVA_MCP_RESOURCE, authorizationVersion: 'mcp-resource-v1' };
}
test('OAuth discovers public PR and AS metadata, pins the actual MCP endpoints and never sends credentials to discovery', async () => {
  const started = await authorize(); const token = stateStore().get<any>('canvaCredentials', 'user');
  assert.equal(new URL(started.authorizationUrl).origin, 'https://www.canva.com');
  assert.equal(token.oauthMetadata.issuer, 'https://www.canva.com');
  assert.equal(token.oauthMetadata.tokenEndpoint, 'https://api.canva.com/auth/v1/oauth/token');
  assert.match(token.oauthMetadata.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(token.authorizationVersion, CANVA_OAUTH_VERSION);
  assert.equal(calls[0].url, 'https://api.canva.com/.well-known/oauth-protected-resource/connect/v1/mcp');
  assert.equal(calls[1].url, 'https://www.canva.com/.well-known/oauth-authorization-server');
  assert.equal(calls.some(call => call.url === 'https://api.canva.com/rest/v1/oauth/token'), false);
  assert.ok(calls.slice(0, 2).every(call => !call.headers.has('authorization') && !call.body));
});
test('OAuth discovery rejects regional redirects, wrong resource or issuer, secret-bearing endpoints and absent S256 before any token exchange', async () => {
  const resourceUrl = 'https://api.canva.com/.well-known/oauth-protected-resource/connect/v1/mcp';
  const serverUrl = 'https://www.canva.com/.well-known/oauth-authorization-server';
  const cases: { url: string; response: () => Response; code: string }[] = [
    { url: serverUrl, response: () => new Response(null, { status: 302, headers: { location: 'https://www.canva.cn/?private=must-not-expose' } }), code: 'CANVA_OAUTH_DISCOVERY_REDIRECT' },
    { url: resourceUrl, response: () => json({ resource: 'https://api.canva.com/other', authorization_servers: ['https://www.canva.com'] }), code: 'CANVA_OAUTH_METADATA' },
    { url: serverUrl, response: () => json({ issuer: 'https://www.canva.cn', code_challenge_methods_supported: ['S256'] }), code: 'CANVA_OAUTH_METADATA' },
    { url: serverUrl, response: () => json({ issuer: 'https://www.canva.com', authorization_endpoint: 'https://www.canva.com/api/oauth/authorize', token_endpoint: 'https://user:private-secret@api.canva.com/auth/v1/oauth/token', code_challenge_methods_supported: ['S256'] }), code: 'CANVA_OAUTH_METADATA' },
    { url: serverUrl, response: () => json({ issuer: 'https://www.canva.com', authorization_endpoint: 'https://www.canva.com/api/oauth/authorize', token_endpoint: 'https://api.canva.com/auth/v1/oauth/token', code_challenge_methods_supported: ['plain'] }), code: 'CANVA_OAUTH_METADATA' },
    { url: serverUrl, response: () => json({ issuer: 'https://www.canva.com', authorization_endpoint: 'https://www.canva.com/api/oauth/authorize', token_endpoint: 'https://attacker.invalid/token', code_challenge_methods_supported: ['S256'] }), code: 'CANVA_OAUTH_METADATA' },
  ];
  for (const scenario of cases) {
    globalThis.fetch = (async (input, init) => {
      assert.equal(new Headers(init?.headers).has('authorization'), false); assert.equal(init?.redirect, 'manual');
      if (String(input) === scenario.url) return scenario.response(); return mockFetch(input, init);
    }) as typeof fetch;
    await assert.rejects(beginCanvaConnection(), (error: any) => { assert.equal(error.code, scenario.code); assert.equal(error.phase, 'oauth.discovery'); assert.equal(error.outcomeUnknown, false); assert.doesNotMatch(error.message, /private|canva\.cn|attacker/); return true; });
  }
  assert.equal(tokenCalls, 0); assert.equal(stateStore().entries('canvaOAuth').length, 0);
});
test('AS metadata missing can fall back to validated OIDC while oversized metadata is rejected', async () => {
  globalThis.fetch = (async (input, init) => String(input).endsWith('/.well-known/oauth-authorization-server') ? new Response(null, { status: 404 }) : mockFetch(input, init)) as typeof fetch;
  assert.equal((await discoverCanvaOAuth()).tokenEndpoint, 'https://api.canva.com/auth/v1/oauth/token');
  assert.ok(calls.some(call => call.url.endsWith('/.well-known/openid-configuration')));
  globalThis.fetch = (async () => json({ padding: 'x'.repeat(128 * 1024) })) as typeof fetch;
  await assert.rejects(discoverCanvaOAuth(), (error: any) => error.code === 'CANVA_RESPONSE_TOO_LARGE' && error.phase === 'oauth.discovery' && !error.outcomeUnknown);
  assert.equal(tokenCalls, 0);
});
test('persisted metadata tampering or discovery changes cannot silently redirect a code or refresh token', async () => {
  const started = await beginCanvaConnection(); const state = new URL(started.authorizationUrl).searchParams.get('state')!;
  const key = createHash('sha256').update(state).digest('hex'); const pending = stateStore().get<any>('canvaOAuth', key);
  pending.oauthMetadata.tokenEndpoint = 'https://api.canva.com/other-token'; stateStore().set('canvaOAuth', key, pending);
  await assert.rejects(completeCanvaConnection({ state, code: 'one-use' }), (error: any) => error.code === 'CANVA_STATE_CORRUPT');
  assert.equal(tokenCalls, 0);
  tokenExpiry = 1; await authorize();
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/.well-known/oauth-authorization-server')) { const data = await canvaMetadataResponse(String(input))!.json(); return json({ ...data, token_endpoint: 'https://api.canva.com/new-auth/oauth/token' }); }
    return mockFetch(input, init);
  }) as typeof fetch;
  const before = tokenCalls;
  await assert.rejects(verifyCanvaConnection(), (error: any) => error.code === 'CANVA_OAUTH_METADATA_CHANGED' && !error.outcomeUnknown);
  assert.equal(tokenCalls, before); assert.equal(stateStore().get<any>('canvaCredentials', 'user').refreshing, undefined);
});
test('same app resource-v1 grant upgrades once at discovered MCP token endpoint and preserves the account binding', async () => {
  const legacy = resourceV1Grant(); stateStore().set('canvaCredentials', 'user', legacy);
  assert.equal(canvaConnectionStatus().connected, false); assert.match(canvaConnectionStatus().message, /升级/);
  assert.equal(canvaConnectionIdentity(), undefined);
  await Promise.all([verifyCanvaConnection(), verifyCanvaConnection()]);
  assert.equal(tokenCalls, 1);
  const request = calls.find(call => call.url.endsWith('/oauth/token'))!;
  assert.equal(request.url, 'https://api.canva.com/auth/v1/oauth/token');
  assert.equal(request.body.get('grant_type'), 'refresh_token'); assert.equal(request.body.get('refresh_token'), legacy.refreshToken);
  assert.equal(request.body.get('resource'), CANVA_MCP_RESOURCE);
  const upgraded = stateStore().get<any>('canvaCredentials', 'user');
  assert.equal(upgraded.authorizationVersion, CANVA_OAUTH_VERSION); assert.equal(upgraded.connectionId, legacy.connectionId);
  assert.notEqual(upgraded.configHash, legacy.configHash); assert.equal(upgraded.refreshing, undefined);
  const summary = stateStore().get<any>('canvaCredentials', 'migrationPrevious');
  assert.equal(summary.connectionId, legacy.connectionId); assert.equal(summary.configHash, legacy.configHash);
  assert.equal(summary.accessToken, undefined); assert.equal(summary.refreshToken, undefined);
  assert.equal(canvaConnectionIdentity(), legacy.connectionId); assert.equal(canvaConnectionStatus().connected, true);
  assert.ok(calls.filter(call => call.url === CANVA_MCP_RESOURCE).every(call => call.headers.get('authorization') === 'Bearer private-canva-access'));
  await verifyCanvaConnection(); assert.equal(tokenCalls, 1, 'a later verify must reuse the upgraded grant without a second migration');
  assert.equal(calls.some(call => call.body?.method === 'tools/call' || call.url.endsWith('/imports') || call.url.includes('/images/')), false);
});
test('unknown migration response retains the original grant and dispatch marker and is never replayed', async () => {
  const legacy = resourceV1Grant(); stateStore().set('canvaCredentials', 'user', legacy); let dispatched = 0;
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/oauth/token')) {
      dispatched++; assert.ok(stateStore().get<any>('canvaCredentials', 'user').refreshing);
      assert.equal(stateStore().get<any>('canvaCredentials', 'user').migration.state, 'dispatched');
      assert.deepEqual(stateStore().get('canvaCredentials', 'migrationPrevious'), legacy);
      throw new Error('lost response with same-user-resource-bound-refresh');
    }
    return mockFetch(input, init);
  }) as typeof fetch;
  await assert.rejects(verifyCanvaConnection(), (error: any) => error.code === 'CANVA_OAUTH_UNKNOWN' && error.phase === 'oauth.refresh' && error.outcomeUnknown && !error.message.includes(legacy.refreshToken));
  const saved = stateStore().get<any>('canvaCredentials', 'user');
  assert.equal(saved.accessToken, legacy.accessToken); assert.equal(saved.refreshToken, legacy.refreshToken); assert.ok(saved.refreshing);
  assert.equal(canvaConnectionStatus().connected, false); assert.equal(canvaConnectionIdentity(), undefined);
  globalThis.fetch = mockFetch as typeof fetch; const before = calls.length;
  await assert.rejects(verifyCanvaConnection(), (error: any) => error.code === 'CANVA_OAUTH_UNKNOWN');
  assert.equal(calls.length, before); assert.equal(dispatched, 1);
});
test('resource-v1 migration cannot change client, resource or scope binding; failed discovery does not consume the migration attempt', async () => {
  const legacy = resourceV1Grant(); stateStore().set('canvaCredentials', 'user', legacy);
  process.env.CANVA_CLIENT_SECRET = 'different-client-secret';
  await assert.rejects(verifyCanvaConnection(), (error: any) => error.code === 'CANVA_NOT_CONNECTED'); assert.equal(calls.length, 0);
  process.env.CANVA_CLIENT_SECRET = 'private-canva-client-secret';
  globalThis.fetch = (async () => { throw new Error('metadata unavailable'); }) as typeof fetch;
  await assert.rejects(verifyCanvaConnection(), (error: any) => error.phase === 'oauth.discovery' && !error.outcomeUnknown);
  assert.deepEqual(stateStore().get('canvaCredentials', 'user'), legacy); assert.equal(stateStore().get('canvaCredentials', 'migrationPrevious'), undefined);
  globalThis.fetch = mockFetch as typeof fetch; await verifyCanvaConnection(); assert.equal(tokenCalls, 1);
});
test('a migrated MCP token rejected by REST stops at rest.preflight without a REST token fallback', async () => {
  stateStore().set('canvaCredentials', 'user', resourceV1Grant());
  globalThis.fetch = (async (input, init) => {
    if (String(input) === 'https://api.canva.com/rest/v1/designs?limit=1') return json({ error: 'invalid_token' }, 401);
    return mockFetch(input, init);
  }) as typeof fetch;
  await assert.rejects(verifyCanvaConnection(), (error: any) => error.code === 'CANVA_REST_PERMISSION' && error.phase === 'rest.preflight' && error.upstreamStatus === 401);
  assert.equal(tokenCalls, 1); assert.equal(calls.some(call => call.url === CANVA_MCP_RESOURCE), false);
  assert.equal(calls.some(call => call.url === 'https://api.canva.com/rest/v1/oauth/token'), false);
  assert.equal(stateStore().get<any>('canvaCredentials', 'user').authorizationVersion, CANVA_OAUTH_VERSION);
});
test('a migration endpoint 5xx is uncertain and its request ID cannot expose the submitted refresh token', async () => {
  const legacy = resourceV1Grant(); stateStore().set('canvaCredentials', 'user', legacy);
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/oauth/token')) return json({ error: 'internal_error' }, 500, { 'x-request-id': legacy.refreshToken, 'trace-id': 'safe-token-error' });
    return mockFetch(input, init);
  }) as typeof fetch;
  await assert.rejects(verifyCanvaConnection(), (error: any) => error.outcomeUnknown && error.upstreamStatus === 500 && error.providerCode === 'internal_error' && error.requestId === 'safe-token-error' && error.phase === 'oauth.refresh');
  assert.ok(stateStore().get<any>('canvaCredentials', 'user').refreshing);
  assert.equal(stateStore().get<any>('canvaCredentials', 'user').accessToken, legacy.accessToken);
});
test('MCP OAuth without an advertised revocation endpoint disconnects locally without guessing a REST endpoint', async () => {
  await authorize(); const count = calls.length; const status = await disconnectCanva();
  assert.equal(calls.length, count); assert.equal(status.connected, false); assert.match(status.message, /未声明撤销端点/);
  assert.equal(stateStore().get('canvaCredentials', 'user'), undefined);
});
test('invalid Canva proxy fails discovery before credential dispatch with a safe deterministic configuration error', async () => {
  const previous = process.env.CANVA_PROXY_URL; process.env.CANVA_PROXY_URL = 'https://user:private@proxy.invalid:443';
  try {
    await assert.rejects(beginCanvaConnection(), (error: any) => error.code === 'CANVA_PROXY_CONFIG' && error.status === 422 && !error.outcomeUnknown && error.phase === 'oauth.discovery' && !error.message.includes('private'));
    assert.equal(calls.length, 0); assert.equal(tokenCalls, 0);
  } finally { if (previous === undefined) delete process.env.CANVA_PROXY_URL; else process.env.CANVA_PROXY_URL = previous; }
});
