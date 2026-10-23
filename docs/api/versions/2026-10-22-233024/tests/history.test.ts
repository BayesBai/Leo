import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, mkdtemp, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkflowClient } from '../src/api/client.js';
import type { HistoryItem, OutlineResult, Product, RenderBundle, RunDetail, RunResult } from '../shared/types.js';

async function boot(directory: string) {
  const child = fork(path.resolve('tests/fixtures/history-server.ts'), [], { execArgv: ['--import', 'tsx'], env: { ...process.env, AGENT_STATE_DIR: directory }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let diagnostic = ''; child.stderr?.on('data', chunk => { diagnostic += chunk; });
  const message = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error(`test server stopped: ${diagnostic}`); })]);
  const base = `http://127.0.0.1:${(message[0] as { port: number }).port}`;
  const client = createWorkflowClient((url, init) => fetch(base + url, init));
  return { child, base, client, stop: async () => { const done = once(child, 'exit'); child.send('stop'); await done; } };
}
async function make(server: Awaited<ReturnType<typeof boot>>) {
  const products = await server.client.api<{ products: Product[] }>('/api/products');
  const product = products.products.find(p => p.system.includes('HarmonyOS'))!;
  const outline = await server.client.api<OutlineResult>('/api/outlines', 'POST', { productId: product.id, audience: '测试客户', scene: '纯模拟恢复验收', goal: '到店体验', buyingStage: '对比选择', platforms: ['moments'], instructions: '', mode: 'demo', knowledgeSource: 'local' });
  await server.client.api(`/api/outlines/${outline.id}/confirm`, 'POST', { version: outline.version });
  const result = await server.client.generateFromOutline(outline.id, outline.version, new AbortController().signal, () => {});
  const bundle = await server.client.api<RenderBundle>('/api/render', 'POST', { runId: result.id, revision: result.revision, platform: 'moments', selectedTitleIndex: 0, templateId: 'moments-square' });
  return { outline, result, bundle };
}
test('HTTP restart restores seven-day history, exact approved snapshot, original assets and downloadable artifacts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'history-restart-')); let server = await boot(directory);
  try {
    const { outline, result, bundle } = await make(server);
    const assetUrl = outline.evidence.images[0].url;
    const image = Buffer.from(await (await fetch(server.base + assetUrl)).arrayBuffer());
    const preview = Buffer.from(await (await fetch(server.base + bundle.artifacts[0].previewUrl)).arrayBuffer());
    const platforms = structuredClone(outline.platforms); platforms[0].title = '纯模拟保存后的新标题';
    await server.client.api(`/api/outlines/${outline.id}`, 'PUT', { version: 1, platforms });
    await server.stop(); server = await boot(directory);
    const items = (await server.client.api<{ items: HistoryItem[] }>('/api/history')).items;
    assert.ok(items.some(i => i.id === outline.id && i.version === 2)); assert.ok(items.some(i => i.id === result.id));
    const detail = await server.client.api<RunDetail>(`/api/runs/${result.id}`);
    assert.equal(detail.outlineSnapshot?.version, 1); assert.equal(detail.outlineSnapshot?.platforms[0].title, outline.platforms[0].title);
    assert.equal(detail.history.evidenceStatus, 'ready'); assert.equal(detail.renderBundles[0].expiresAt, bundle.expiresAt);
    assert.equal((await server.client.api<OutlineResult>(`/api/outlines/${outline.id}`)).version, 2);
    assert.deepEqual(Buffer.from(await (await fetch(server.base + assetUrl)).arrayBuffer()), image);
    assert.deepEqual(Buffer.from(await (await fetch(server.base + bundle.artifacts[0].previewUrl)).arrayBuffer()), preview);
    assert.equal((await fetch(server.base + bundle.zipUrl)).status, 200);
    assert.ok(detail.result.evidence.sources.every(s => !('text' in s)));
    const persisted = await readFile(path.join(directory, 'state.v1.json'), 'utf8');
    assert.ok(!persisted.includes(process.env.LLM_API_KEY!));
    assert.equal((await server.client.api<{ items: HistoryItem[] }>('/api/history')).items.find(i => i.id === result.id)?.expiresAt, detail.history.expiresAt);
    await server.stop();
    const state = JSON.parse(await readFile(path.join(directory, 'state.v1.json'), 'utf8'));
    for (const a of Object.values(state.buckets.renderAssets) as { expires: number }[]) a.expires = Date.now() - 1;
    state.buckets.renderBundles[bundle.id].expiresAt = new Date(Date.now() - 1).toISOString();
    await writeFile(path.join(directory, 'state.v1.json'), JSON.stringify(state)); server = await boot(directory);
    assert.equal((await fetch(server.base + bundle.artifacts[0].previewUrl)).status, 410);
    assert.equal((await server.client.api<RunDetail>(`/api/runs/${result.id}`)).renderBundles.length, 0);
    await server.stop();
    const expired = JSON.parse(await readFile(path.join(directory, 'state.v1.json'), 'utf8')); expired.buckets.runs[result.id].expiresAt = Date.now() - 1;
    await writeFile(path.join(directory, 'state.v1.json'), JSON.stringify(expired)); server = await boot(directory);
    assert.equal((await fetch(`${server.base}/api/runs/${result.id}`)).status, 410);
  } finally { if (server.child.exitCode === null) await server.stop(); }
});
test('changed local evidence becomes read-only while history stays readable and fresh planning bypasses stale catalog', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'history-changed-')); const server = await boot(directory);
  let original: Buffer | undefined; let filename = '';
  try {
    const { outline, result } = await make(server);
    const category = path.join(process.env.LOCAL_KB_ROOT!, 'P1-产品参数库', '01-鸿蒙电脑');
    filename = path.join(category, (await readdir(category))[0], '产品事实.md'); original = await readFile(filename);
    await writeFile(filename, Buffer.concat([original, Buffer.from('\n\n纯模拟文件变更。\n')]));
    const detail = await server.client.api<RunDetail>(`/api/runs/${result.id}`); assert.equal(detail.history.evidenceStatus, 'refresh_required');
    assert.equal((await server.client.api<OutlineResult>(`/api/outlines/${outline.id}`)).history?.evidenceStatus, 'refresh_required');
    const response = await fetch(`${server.base}/api/outlines/${outline.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: outline.version }) }); assert.equal(response.status, 410);
    assert.equal((await fetch(`${server.base}/api/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: result.id, revision: result.revision, platform: 'moments', selectedTitleIndex: 0, templateId: 'moments-square' }) })).status, 410);
    const fresh = await server.client.api<OutlineResult>('/api/outlines', 'POST', outline.brief); assert.notEqual(fresh.id, outline.id); assert.equal(fresh.history?.evidenceStatus, 'ready');
  } finally { if (original) await writeFile(filename, original); await server.stop(); }
});
