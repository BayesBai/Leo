import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import type { AppStatus, Brief, HistoryItem, OutlineResult, Platform, Product, RenderBundle, RenderTemplate, RunDetail, RunResult, TaskOptions } from '../shared/types.js';
import { ApiError, createWorkflowClient } from '../src/api/client.js';
import { createMockTransport, mockScenario, type MockScenario } from '../src/api/mock.js';
import fixture from '../src/api/fixtures/frontend.mock.json';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const client = (scenario: MockScenario = 'ok', latencyMs = 0) => createWorkflowClient(createMockTransport(scenario, { latencyMs }));
type Client = ReturnType<typeof client>;
const brief = (): Brief => structuredClone(fixture.fourChannelOutline.brief) as Brief;
const create = (c: Client, input = brief()) => c.api<OutlineResult>('/api/outlines', 'POST', input);
const save = (c: Client, outline: OutlineResult) => c.api<OutlineResult>(`/api/outlines/${outline.id}`, 'PUT', { version: outline.version, platforms: outline.platforms });
const confirm = (c: Client, outline: OutlineResult) => c.api<OutlineResult>(`/api/outlines/${outline.id}/confirm`, 'POST', { version: outline.version });
const generate = (c: Client, outline: OutlineResult, signal = new AbortController().signal) => c.generateFromOutline(outline.id, outline.version, signal, () => {});
const structuredError = (status: number, kind: ApiError['kind']) => (error: unknown) => error instanceof ApiError && error.status === status && error.kind === kind;
async function run(c: Client, input = brief()) { return generate(c, await confirm(c, await create(c, input))); }
async function render(c: Client, result: RunResult, platform: Platform, templateId?: string) {
  const template = fixture.renderTemplates.templates.find(t => t.platform === platform)!;
  return c.api<RenderBundle>('/api/render', 'POST', { runId: result.id, revision: result.revision, platform, selectedTitleIndex: 0, templateId: templateId || template.id });
}

test('mock query parsing is explicit, safe in Node, and supports workflow failure scenarios', () => {
  assert.equal(mockScenario(''), null);
  for (const scenario of ['ok', 'blocked', 'needs_input', 'error', 'empty', 'slow', 'expired', 'conflict', 'disconnected', 'insufficient-images']) assert.equal(mockScenario(`?mock=${scenario}`), scenario);
  assert.equal(mockScenario('?mock=unknown'), 'ok');
});

test('mock boots complete workflow catalogs and isolates credential settings and verification', async () => {
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('Real network is forbidden in this test'); };
  const c = client();
  const [before, products, options, templates] = await Promise.all([
    c.api<AppStatus>('/api/status'), c.api<{ products: Product[] }>('/api/products'), c.api<TaskOptions>('/api/task-options'), c.api<{ templates: RenderTemplate[] }>('/api/render-templates'),
  ]);
  assert.equal(products.products.length, 1); assert.match(products.products[0].name, /占位/);
  assert.equal(before.local.available, true); assert.equal(before.model.configured, false); assert.equal(before.ima.verified, false);
  assert.equal(options.platforms.length, 4); assert.equal(templates.templates.length, 8);
  assert.equal(templates.templates.find(t => t.platform === 'wechat')?.height, 900);
  assert.deepEqual(await c.api('/api/connections/settings', 'POST', { apiKey: 'test-secret-never-saved', imaApiKey: 'test-secret-never-saved', model: 'not-a-model' }), before);
  assert.deepEqual(await c.api('/api/connections/verify', 'POST', {}), before);
  assert.equal((await c.api<{ verified: boolean }>('/api/connections/model/verify', 'POST', {})).verified, false);
  assert.equal(JSON.stringify(await c.api('/api/status')).includes('test-secret-never-saved'), false);
  const result = await run(c);
  for (const platform of result.brief.platforms) {
    const bundle = await render(c, result, platform);
    for (const artifact of bundle.artifacts) {
      assert.ok(artifact.previewUrl.startsWith('data:'));
      const response = await c.apiFetch(artifact.previewUrl); assert.equal(response.ok, true);
      if (artifact.downloadUrl) assert.equal((await c.apiFetch(artifact.downloadUrl)).ok, true);
    }
    assert.equal((await c.apiFetch(bundle.zipUrl!)).ok, true);
  }
  await assert.rejects(c.api('/api/unregistered'), structuredError(404, 'http'));
  assert.equal((await c.apiFetch('https://example.invalid/api/status')).status, 403);
  assert.equal((await c.apiFetch('data:text/html,<script>untrusted</script>')).status, 403);
  assert.equal(networkCalls, 0);
});

test('mock saves versioned outlines, invalidates confirmation, and binds four-channel generation to the snapshot', async () => {
  const c = client(); let outline = await create(c);
  assert.equal(outline.status, 'editing'); assert.equal(outline.platforms.length, 4);
  assert.deepEqual(await c.api(`/api/outlines/${outline.id}`), outline);
  await assert.rejects(generate(c, outline), structuredError(409, 'conflict'));
  outline.platforms[0].title = '纯模拟手动编辑标题';
  outline = await save(c, outline); assert.equal(outline.version, 2);
  const confirmed = await confirm(c, outline); assert.equal(confirmed.status, 'confirmed');
  const revised = await c.api<OutlineResult>(`/api/outlines/${outline.id}/revise`, 'POST', { version: outline.version, instructions: '精简' });
  assert.equal(revised.version, 3); assert.equal(revised.status, 'editing'); assert.equal(revised.confirmedAt, undefined);
  await assert.rejects(generate(c, confirmed), structuredError(409, 'conflict'));
  const current = await confirm(c, revised); const entries: string[] = [];
  const result = await c.generateFromOutline(current.id, current.version, new AbortController().signal, e => entries.push(e.detail));
  assert.equal(result.drafts.length, 4); assert.equal(result.drafts[0].titles[0], '纯模拟手动编辑标题');
  assert.deepEqual(result.outline, { id: current.id, version: 3 });
  assert.deepEqual(result.drafts.map(d => d.platform), current.brief.platforms);
  assert.ok(entries.length > 0); assert.ok(entries.every(detail => detail.includes('纯模拟')));
});

test('mock filters channels consistently for a subset and rejects foreign product or fact IDs', async () => {
  const c = client(); const input = { ...brief(), platforms: ['moments'] as Platform[] };
  const result = await run(c, input);
  assert.deepEqual(result.brief.platforms, ['moments']); assert.deepEqual(result.drafts.map(d => d.platform), ['moments']);
  await assert.rejects(create(c, { ...input, productId: 'real-product-id' }), structuredError(400, 'http'));
  const outline = await create(c); outline.platforms[0].sections[0].factIds = ['foreign-fact'];
  await assert.rejects(save(c, outline), structuredError(400, 'http'));
});

test('mock four-channel artifacts have real PNG bytes, correct output counts and safe downloadable ZIPs', async () => {
  const c = client(); const result = await run(c);
  for (const platform of result.brief.platforms) {
    const bundle = await render(c, result, platform);
    assert.equal(bundle.artifacts.length, platform === 'wechat' ? 2 : platform === 'xiaohongshu' ? 3 : 1);
    assert.equal(bundle.runId, result.id); assert.equal(bundle.revision, result.revision); assert.equal(bundle.platform, platform);
    for (const artifact of bundle.artifacts.filter(a => a.format === 'png')) {
      const response = await c.apiFetch(artifact.downloadUrl!); assert.equal(response.headers.get('Content-Type'), 'image/png');
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      const view = new DataView(bytes.buffer); assert.equal(view.getUint32(16), artifact.width); assert.equal(view.getUint32(20), artifact.height);
    }
    const zipResponse = await c.apiFetch(bundle.zipUrl!);
    assert.equal(zipResponse.headers.get('Content-Type'), 'application/zip');
    const files = unzipSync(new Uint8Array(await zipResponse.arrayBuffer()));
    assert.match(strFromU8(files['来源与审核.txt']), /纯模拟/);
  }
});

test('mock blocks downloads and copy payloads when review is blocked', async () => {
  const c = client('blocked'); const result = await run(c); assert.equal(result.review.status, 'blocked');
  for (const platform of result.brief.platforms) {
    const bundle = await render(c, result, platform);
    assert.equal(bundle.reviewStatus, 'blocked'); assert.equal(bundle.zipUrl, undefined); assert.equal(bundle.copyText, '');
    assert.ok(bundle.artifacts.every(a => a.downloadUrl === undefined && a.previewUrl.startsWith('data:')));
  }
  assert.equal((await c.apiFetch('/__mock/resources/unknown')).status, 410);
});

test('mock portrait moments template matches declared PNG dimensions', async () => {
  const c = client(); const result = await run(c, { ...brief(), platforms: ['moments'] });
  const bundle = await render(c, result, 'moments', 'moments-portrait');
  const artifact = bundle.artifacts[0];
  const bytes = await (await c.apiFetch(artifact.previewUrl)).arrayBuffer(); const view = new DataView(bytes);
  assert.equal(artifact.width, 1080); assert.equal(artifact.height, 1440);
  assert.equal(view.getUint32(16), 1080); assert.equal(view.getUint32(20), 1440);
});

test('mock exposes needs_input, empty products, stream errors and disconnection without successful results', async () => {
  const needsInput = client('needs_input');
  await assert.rejects(create(needsInput), error => error instanceof ApiError && error.status === 422 && error.kind === 'needs_input' && error.fields.length > 0);
  assert.deepEqual(await client('empty').api('/api/products'), { products: [] });
  assert.equal((await client('empty').api<AppStatus>('/api/status')).local.available, false);
  await assert.rejects(run(client('error')), error => error instanceof ApiError && error.kind === 'stream');
  await assert.rejects(run(client('disconnected')), error => error instanceof ApiError && error.kind === 'incomplete');
});

test('mock conflict is recoverable by loading the new version and expiry requires a new outline', async () => {
  const c = client('conflict'); const outline = await create(c);
  await assert.rejects(confirm(c, outline), structuredError(409, 'conflict'));
  const latest = await c.api<OutlineResult>(`/api/outlines/${outline.id}`);
  assert.equal(latest.version, outline.version + 1); assert.equal((await confirm(c, latest)).status, 'confirmed');
  const expired = client('expired'); const old = await create(expired);
  await assert.rejects(confirm(expired, old), structuredError(410, 'expired'));
  const replacement = await create(expired); assert.equal((await confirm(expired, replacement)).status, 'confirmed');
});

test('mock rejects insufficient images, stale render versions and invalid templates', async () => {
  const c = client('insufficient-images');
  await assert.rejects(create(c), structuredError(422, 'http'));
  assert.deepEqual(await c.api('/api/history'), { items: [] });
  const result = await run(c, { ...brief(), platforms: ['poster'] });
  await assert.rejects(render(c, { ...result, revision: 2 }, 'poster'), structuredError(409, 'conflict'));
  await assert.rejects(render(c, result, 'poster', 'xhs-cream'), structuredError(400, 'http'));
  assert.equal((await render(c, result, 'poster')).artifacts.length, 1);
});

test('mock validates channel image bounds before saving or confirming an outline', async () => {
  const c = client(); const outline = await create(c);
  const invalid = structuredClone(outline);
  invalid.platforms.find(p => p.platform === 'wechat')!.imageIds = [outline.evidence.images[0].id];
  await assert.rejects(save(c, invalid), structuredError(422, 'http'));
  invalid.platforms = structuredClone(outline.platforms);
  invalid.platforms.find(p => p.platform === 'poster')!.imageIds = outline.evidence.images.slice(0, 2).map(i => i.id);
  await assert.rejects(save(c, invalid), structuredError(422, 'http'));
  assert.deepEqual(await c.api(`/api/outlines/${outline.id}`), outline);
  assert.equal((await confirm(c, outline)).status, 'confirmed');
});

test('mock history restores original run snapshots and unexpired artifacts independently of later outline edits', async () => {
  const c = client(); assert.deepEqual(await c.api('/api/history'), { items: [] });
  const outline = await confirm(c, await create(c)); const result = await generate(c, outline);
  const bundle = await render(c, result, 'poster');
  const changed = structuredClone(outline); changed.platforms[0].title = '纯模拟的新版本标题';
  const latest = await save(c, changed);
  const detail = await c.api<RunDetail>(`/api/runs/${result.id}`);
  assert.deepEqual(detail.result, result); assert.equal(detail.outlineSnapshot?.version, outline.version);
  assert.equal(detail.outlineSnapshot?.platforms[0].title, outline.platforms[0].title);
  assert.equal(latest.version, outline.version + 1); assert.deepEqual(detail.renderBundles, [bundle]);
  const items = (await c.api<{ items: HistoryItem[] }>('/api/history')).items;
  assert.equal(items.length, 2); assert.equal(items.find(i => i.kind === 'outline')?.version, latest.version);
  assert.equal(items.find(i => i.kind === 'run')?.id, result.id);
  assert.equal(detail.history.evidenceStatus, 'ready');
  const isolated = client(); assert.deepEqual(await isolated.api('/api/history'), { items: [] });
  await assert.rejects(isolated.api(`/api/runs/${result.id}`), structuredError(410, 'expired'));
});

test('mock keeps seven-day history read-only when evidence expires and never extends artifact or history expiry', async () => {
  let now = Date.now();
  const c = createWorkflowClient(createMockTransport('ok', { latencyMs: 0, now: () => now, evidenceExpiresAt: now + 30 * 60_000 }));
  const outline = await confirm(c, await create(c)); const result = await generate(c, outline); const bundle = await render(c, result, 'poster');
  const original = await c.api<RunDetail>(`/api/runs/${result.id}`);
  now += 10 * 60_000;
  assert.equal((await c.api<RunDetail>(`/api/runs/${result.id}`)).renderBundles[0].expiresAt, bundle.expiresAt);
  now += 21 * 60_000;
  const stale = await c.api<RunDetail>(`/api/runs/${result.id}`);
  assert.equal(stale.history.evidenceStatus, 'refresh_required'); assert.equal(stale.history.expiresAt, original.history.expiresAt);
  assert.equal(stale.renderBundles.length, 0); assert.deepEqual(stale.result, result);
  assert.equal((await c.api<OutlineResult>(`/api/outlines/${outline.id}`)).history?.evidenceStatus, 'refresh_required');
  await assert.rejects(confirm(c, outline), structuredError(410, 'expired'));
  await assert.rejects(render(c, result, 'poster'), structuredError(410, 'expired'));
  assert.equal((await c.apiFetch(bundle.zipUrl!)).status, 410);
  now += 7 * 24 * 60 * 60_000;
  assert.deepEqual(await c.api('/api/history'), { items: [] });
  await assert.rejects(c.api(`/api/runs/${result.id}`), structuredError(410, 'expired'));
});

test('mock cancellation stops pending generation and preserves the confirmed outline', async () => {
  const c = client('slow', 10); const outline = await confirm(c, await create(c));
  const controller = new AbortController(); let progressCount = 0;
  const promise = c.generateFromOutline(outline.id, outline.version, controller.signal, () => { progressCount++; controller.abort(); });
  await assert.rejects(promise, error => error instanceof DOMException && error.name === 'AbortError');
  assert.equal(progressCount, 1); assert.deepEqual(await c.api(`/api/outlines/${outline.id}`), outline);
  assert.equal((await generate(c, outline)).outline?.version, outline.version);
});

test('mock cancellation before a JSON mutation leaves the saved outline untouched', async () => {
  const c = client('ok', 10); const outline = await create(c);
  const controller = new AbortController();
  const mutation = c.api(`/api/outlines/${outline.id}`, 'PUT', { version: outline.version, platforms: outline.platforms }, controller.signal);
  controller.abort(); await assert.rejects(mutation, error => error instanceof DOMException && error.name === 'AbortError');
  assert.equal((await c.api<OutlineResult>(`/api/outlines/${outline.id}`)).version, 1);
});

test('real client cancels a silent open stream immediately and classifies transport failures', async () => {
  const controller = new AbortController(); let canceled = false;
  const c = createWorkflowClient(async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const pending = c.generateFromOutline('outline', 1, controller.signal, () => {});
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError'); assert.equal(canceled, true);
  const broken = createWorkflowClient(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(broken.api('/api/status'), error => error instanceof ApiError && error.kind === 'network');
});

test('real client rejects mismatched four-channel result sets and preserves HTTP error metadata', async () => {
  const value = structuredClone(fixture.fourChannelResult);
  value.drafts.pop();
  const c = createWorkflowClient(async () => new Response(`data: ${JSON.stringify({ type: 'result', result: value })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } }));
  await assert.rejects(c.generateFromOutline(value.outline.id, value.outline.version, new AbortController().signal, () => {}), error => error instanceof ApiError && error.kind === 'protocol');
  const stale = createWorkflowClient(async () => new Response(JSON.stringify({ message: '版本已更新' }), { status: 409, headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(stale.api('/api/outlines/id', 'PUT', {}), structuredError(409, 'conflict'));
});
