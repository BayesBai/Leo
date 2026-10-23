import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStateStore, StateError } from '../server/state-store.js';

function directory() { return mkdtempSync(path.join(os.tmpdir(), 'hackson-state-test-')); }

test('file state commits multiple buckets, survives reopening and persists removals', () => {
  const root = directory();
  let store = new FileStateStore(root);
  try {
    store.update(buckets => {
      buckets.outlines = { 'outline-1': { version: 2, status: 'confirmed' } };
      buckets.runs = { 'run-1': { outline: { id: 'outline-1', version: 2 }, review: 'needs_attention' } };
    });
    const read = store.get<{ version: number }>('outlines', 'outline-1')!;
    read.version = 99;
    assert.equal(store.get<{ version: number }>('outlines', 'outline-1')!.version, 2);
    assert.deepEqual(readdirSync(root).sort(), ['state.v1.json', 'writer.lock']);
    store.close();
    store = new FileStateStore(root);
    assert.deepEqual(store.get('runs', 'run-1'), { outline: { id: 'outline-1', version: 2 }, review: 'needs_attention' });
    assert.deepEqual(store.entries('outlines'), [['outline-1', { version: 2, status: 'confirmed' }]]);
    store.remove('runs', 'run-1'); store.close();
    store = new FileStateStore(root);
    assert.deepEqual(store.entries('runs'), []);
    assert.equal(store.get<{ version: number }>('outlines', 'outline-1')!.version, 2);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('a failed state commit preserves the previous bytes and in-memory records without partial files', () => {
  const root = directory(); const store = new FileStateStore(root);
  try {
    store.set('outlines', 'saved', { version: 1 });
    const file = path.join(root, 'state.v1.json'); const committed = readFileSync(file);
    assert.throws(() => store.set('outlines', 'invalid', { cannotSerialize: 1n }), StateError);
    assert.deepEqual(readFileSync(file), committed);
    assert.equal(store.get('outlines', 'invalid'), undefined);
    assert.deepEqual(store.get('outlines', 'saved'), { version: 1 });
    assert.deepEqual(readdirSync(root).sort(), ['state.v1.json', 'writer.lock']);
    store.close();
    const reopened = new FileStateStore(root);
    try { assert.deepEqual(reopened.entries('outlines'), [['saved', { version: 1 }]]); }
    finally { reopened.close(); }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('corrupt or unsupported history is rejected without replacing the original file or retaining a lock', () => {
  for (const content of ['{broken', 'null', '{"version":2,"buckets":{}}', '{"version":1,"buckets":{"runs":null}}']) {
    const root = directory(); const file = path.join(root, 'state.v1.json');
    try {
      writeFileSync(file, content);
      assert.throws(() => new FileStateStore(root), StateError);
      assert.equal(readFileSync(file, 'utf8'), content);
      assert.equal(existsSync(path.join(root, 'writer.lock')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('only one writer can own a directory and closing releases its lock exactly once', () => {
  const root = directory(); const first = new FileStateStore(root);
  let second: FileStateStore | undefined;
  try {
    first.set('outlines', 'saved', { version: 1 });
    assert.throws(() => new FileStateStore(root), StateError);
    assert.deepEqual(first.get('outlines', 'saved'), { version: 1 });
    first.close();
    second = new FileStateStore(root);
    first.close();
    assert.throws(() => new FileStateStore(root), StateError);
    assert.throws(() => first.set('outlines', 'late', {}), StateError);
    second.close();
    assert.equal(existsSync(path.join(root, 'writer.lock')), false);
  } finally { first.close(); second?.close(); rmSync(root, { recursive: true, force: true }); }
});
