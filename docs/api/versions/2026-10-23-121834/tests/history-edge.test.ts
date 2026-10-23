import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OutlineResult, RunResult } from '../shared/types.js';
import { getSavedRun, historyItems, pruneHistory, runDetail } from '../server/history.js';
import { closeStateStore, finishOperation, HISTORY_TTL, markOperation, runtimeId, stateStore, wasInterrupted } from '../server/state-store.js';
import { getOutline } from '../server/outlines.js';
import { renderDirectory } from '../server/render/path.js';

/** All records and files are fictional and isolated from application history. */
function isolatedState(check: (directory: string) => void) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'hackson-history-edge-'));
  const previousDirectory = process.env.AGENT_STATE_DIR; const previousRenderDirectory = process.env.AGENT_RENDER_DIR; const previousCwd = process.cwd();
  closeStateStore(); process.env.AGENT_STATE_DIR = path.join(directory, 'state'); process.env.AGENT_RENDER_DIR = path.join(directory, 'render');
  try { check(directory); }
  finally {
    process.chdir(previousCwd); closeStateStore();
    if (previousDirectory === undefined) delete process.env.AGENT_STATE_DIR; else process.env.AGENT_STATE_DIR = previousDirectory;
    if (previousRenderDirectory === undefined) delete process.env.AGENT_RENDER_DIR; else process.env.AGENT_RENDER_DIR = previousRenderDirectory;
    rmSync(directory, { recursive: true, force: true });
  }
}

function record(id = randomUUID(), createdAt = new Date().toISOString()): RunResult {
  const product = { id: `synthetic-${id}`, name: '纯模拟历史边界机型', system: '纯模拟系统', category: '测试', description: '不代表真实产品', imageCount: 0 };
  const brief: RunResult['brief'] = { productId: product.id, audience: '纯模拟客户', scene: '纯模拟历史恢复', goal: '核对协议', buyingStage: '测试', platforms: ['moments'], instructions: '', mode: 'demo', knowledgeSource: 'local' };
  return { id, createdAt, brief, product, evidence: { product, facts: [], images: [], sources: [], retrievedAt: createdAt, sourceMode: 'local', warnings: ['纯模拟测试记录'] },
    strategies: [], drafts: [{ id: 'synthetic-draft', platform: 'moments', titles: ['纯模拟历史标题'], intro: '只用于历史状态测试。', blocks: [{ id: 'b1', heading: '纯模拟段落', text: '不承载真实产品断言。', factIds: [] }], cta: '请勿作为真实产品内容使用。', tags: [], images: [] }],
    review: { status: 'needs_attention', issues: [], factCount: 0, citedFactCount: 0, imageCount: 0, checks: [], reviewedBy: 'rules' }, trace: [], revision: 1, notice: '纯模拟历史边界测试' };
}

function outline(result: RunResult): OutlineResult {
  return { id: randomUUID(), version: 1, status: 'confirmed', createdAt: result.createdAt, confirmedAt: result.createdAt, brief: result.brief, product: result.product, evidence: result.evidence,
    platforms: [{ platform: 'moments', title: '纯模拟历史大纲', angle: '测试', intro: '纯模拟', sections: [{ id: 'b1', heading: '纯模拟', points: ['仅用于读取历史'], factIds: [] }], imageIds: [], cta: '纯模拟' }], warnings: ['纯模拟测试记录'] };
}

function savedRun(result: RunResult, expiresAt = Date.now() + HISTORY_TTL) {
  return { result, canonicalEvidence: result.evidence, updatedAt: Date.parse(result.createdAt), expiresAt };
}
test('loading more than forty saved outlines never evicts retained disk history', () => isolatedState(() => {
  const records = Array.from({ length: 45 }, () => outline(record()));
  stateStore().update(b => { b.outlines = Object.fromEntries(records.map(value => [value.id, { outline: value, updatedAt: Date.now(), expiresAt: Date.now() + HISTORY_TTL }])); });
  for (const value of records) assert.equal(getOutline(value.id).id, value.id);
  assert.equal(getOutline(records[0].id).version, 1);
  assert.equal(stateStore().entries('outlines').length, 45);
}));

test('seven-day pruning removes expired outlines, runs and their markers without extending or deleting retained history', () => isolatedState(() => {
  const now = Date.now(); const old = record(randomUUID(), new Date(now - HISTORY_TTL - 60_000).toISOString()); const oldOutline = outline(old);
  const kept = record(); const keptOutline = outline(kept); const keptExpiry = now + 60_000;
  stateStore().update(b => {
    b.outlines = { [oldOutline.id]: { outline: oldOutline, expiresAt: now - 1, updatedAt: now - HISTORY_TTL - 60_000 }, [keptOutline.id]: { outline: keptOutline, expiresAt: keptExpiry, updatedAt: now } };
    b.runs = { [old.id]: savedRun(old, now - 1), [kept.id]: savedRun(kept, keptExpiry) };
    b.operations = { expiredOutline: { id: oldOutline.id, runtimeId: 'old-runtime' }, expiredRun: { id: old.id, runtimeId: 'old-runtime' }, retained: { id: kept.id, runtimeId: 'old-runtime' } };
  });
  pruneHistory();
  assert.equal(stateStore().get('outlines', oldOutline.id), undefined); assert.equal(stateStore().get('runs', old.id), undefined);
  assert.equal(stateStore().get('operations', 'expiredOutline'), undefined); assert.equal(stateStore().get('operations', 'expiredRun'), undefined);
  assert.ok(stateStore().get('operations', 'retained'));
  assert.equal(stateStore().get<{ expiresAt: number }>('runs', kept.id)?.expiresAt, keptExpiry);
  const items = historyItems(); assert.deepEqual(new Set(items.map(item => item.id)), new Set([kept.id, keptOutline.id]));
  assert.ok(items.every(item => Date.parse(item.expiresAt) === keptExpiry));
  assert.throws(() => getSavedRun(old.id), (error: any) => error.status === 410);
}));

test('a persisted run without an evidence binding remains readable but cannot resume generation or rendering', () => isolatedState(() => {
  const result = record(); stateStore().set('runs', result.id, savedRun(result));
  const detail = runDetail(result.id);
  assert.equal(detail.result.id, result.id); assert.equal(detail.result.drafts[0].titles[0], '纯模拟历史标题');
  assert.equal(detail.history.evidenceStatus, 'refresh_required'); assert.deepEqual(detail.renderBundles, []);
  assert.equal(historyItems().find(item => item.id === result.id)?.evidenceStatus, 'refresh_required');
  assert.throws(() => getSavedRun(result.id, true), (error: any) => error.status === 410);
  assert.equal(getSavedRun(result.id).result.id, result.id);
}));

test('two operations for one saved target keep distinct tokens and finishing one leaves its active sibling intact', () => isolatedState(() => {
  const id = randomUUID(); const first = markOperation(id, 'generate'); const second = markOperation(id, 'render');
  assert.notEqual(first, second); assert.equal(wasInterrupted(id), false);
  assert.equal(stateStore().get<{ runtimeId: string }>('operations', first)?.runtimeId, runtimeId);
  finishOperation(first);
  assert.equal(stateStore().get('operations', first), undefined);
  assert.equal(stateStore().get<{ id: string }>('operations', second)?.id, id);
  finishOperation(second); assert.deepEqual(stateStore().entries('operations'), []);
}));

test('a successful operation clears stale interruption markers only for its own saved target', () => isolatedState(() => {
  const result = record(); const other = randomUUID();
  stateStore().update(b => {
    b.operations = { stale: { id: result.id, kind: 'generate', runtimeId: 'previous-runtime' }, unrelated: { id: other, kind: 'revise', runtimeId: 'previous-runtime' } };
  });
  stateStore().set('runs', result.id, savedRun(result)); assert.equal(runDetail(result.id).history.interrupted, true);
  const completed = markOperation(result.id, 'generate'); const stillRunning = markOperation(result.id, 'render');
  // Publishing the saved result precedes successful operation cleanup.
  stateStore().set('runs', result.id, savedRun(result)); finishOperation(completed);
  assert.equal(wasInterrupted(result.id), false); assert.equal(runDetail(result.id).history.interrupted, undefined);
  assert.equal(stateStore().get('operations', 'stale'), undefined); assert.ok(stateStore().get('operations', stillRunning));
  assert.equal(wasInterrupted(other), true); assert.ok(stateStore().get('operations', 'unrelated'));
}));

test('pruning expired ima media and render bundles removes their physical files while preserving fresh resources', () => isolatedState(directory => {
  const working = path.join(directory, 'workspace'); mkdirSync(working); process.chdir(working);
  const now = Date.now(); const expiredMedia = randomUUID(); const freshMedia = randomUUID(); const expiredGroup = randomUUID(); const freshGroup = randomUUID();
  const mediaDirectory = path.join(stateStore().directory, 'media'); mkdirSync(mediaDirectory, { recursive: true });
  for (const id of [expiredMedia, freshMedia]) writeFileSync(path.join(mediaDirectory, id), Buffer.from('纯模拟缓存字节'));
  for (const id of [expiredGroup, freshGroup]) { mkdirSync(path.join(renderDirectory(), id), { recursive: true }); writeFileSync(path.join(renderDirectory(), id, 'synthetic.png'), '纯模拟成品字节'); }
  stateStore().update(b => {
    b.knowledgeAssets = { [expiredMedia]: { kind: 'ima', expiresAt: now - 1 }, [freshMedia]: { kind: 'ima', expiresAt: now + 60_000 }, local: { kind: 'local' } };
    b.renderBundles = { [expiredGroup]: { expiresAt: new Date(now - 1).toISOString() }, [freshGroup]: { expiresAt: new Date(now + 60_000).toISOString() } };
    b.renderAssets = { expired: { group: expiredGroup }, anotherExpired: { group: expiredGroup }, fresh: { group: freshGroup } };
  });
  pruneHistory();
  assert.equal(stateStore().get('knowledgeAssets', expiredMedia), undefined); assert.ok(stateStore().get('knowledgeAssets', freshMedia)); assert.ok(stateStore().get('knowledgeAssets', 'local'));
  assert.equal(existsSync(path.join(mediaDirectory, expiredMedia)), false); assert.equal(existsSync(path.join(mediaDirectory, freshMedia)), true);
  assert.equal(stateStore().get('renderBundles', expiredGroup), undefined); assert.ok(stateStore().get('renderBundles', freshGroup));
  assert.equal(stateStore().get('renderAssets', 'expired'), undefined); assert.equal(stateStore().get('renderAssets', 'anotherExpired'), undefined); assert.ok(stateStore().get('renderAssets', 'fresh'));
  assert.equal(existsSync(path.join(renderDirectory(), expiredGroup)), false); assert.equal(existsSync(path.join(renderDirectory(), freshGroup, 'synthetic.png')), true);
}));
