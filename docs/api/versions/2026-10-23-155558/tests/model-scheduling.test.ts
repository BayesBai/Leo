import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { ModelCallRecord } from '../shared/types.js';
import { callModel, completeJson, ModelError, snapshotModelConfig, withModelExecution } from '../server/model.js';
import { FairLimiter } from '../server/fair-limiter.js';

const completion = (content = '{"ok":true}', headers: Record<string, string> = {}) => new Response(JSON.stringify({ choices: [{ index: 0, message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } }), { headers: { 'content-type': 'application/json', ...headers } });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(predicate: () => boolean) { for (let i = 0; i < 200 && !predicate(); i++) await tick(); assert.ok(predicate(), 'expected scheduling progress'); }

test('global four HTTP slots include legacy calls and give another job a fair turn', async () => {
  const calls: ModelCallRecord[] = [], gates: Array<() => void> = [], order: string[] = [];
  let active = 0, maximum = 0, hold = true;
  const fetcher: typeof fetch = async (_url, init) => {
    const owner = JSON.parse(String(init?.body)).messages[1].content;
    order.push(owner); active++; maximum = Math.max(maximum, active);
    if (hold) await new Promise<void>(resolve => gates.push(resolve));
    active--; return completion();
  };
  const first = withModelExecution({ jobId: 'first', stage: 'write', onCall: c => calls.push(c) }, () => Array.from({ length: 6 }, () => callModel('s', 'first', { fetcher })));
  await until(() => order.length === 4);
  const second = withModelExecution({ jobId: 'second', stage: 'review' }, () => callModel('s', 'second', { fetcher }));
  const legacy = callModel('s', 'legacy', { fetcher });
  try {
    assert.equal(maximum, 4);
    gates.shift()!(); await until(() => order.length === 5);
    assert.equal(order[4], 'second');
  } finally { hold = false; for (const release of gates) release(); await Promise.all([...first, second, legacy]); }
  assert.equal(maximum, 4);
  for (const id of new Set(calls.map(c => c.id))) {
    assert.deepEqual(calls.filter(c => c.id === id).map(c => c.outcome), ['dispatched', 'succeeded']);
  }
  assert.ok(calls.some(c => (c.queueMs || 0) > 0));
});

test('cancelled limiter waiter never steals a slot or dispatches', async () => {
  const slots = new FairLimiter(1), controller = new AbortController();
  const release = await slots.acquire('first');
  const waiting = slots.acquire('cancelled', controller.signal); controller.abort();
  await assert.rejects(waiting); release();
  const next = await slots.acquire('next'); next(); next();
});

test('per-node two HTTP attempts are shared by throttling and JSON correction', async () => {
  const original = globalThis.fetch;
  try {
    for (const throttleFirst of [true, false]) {
      let count = 0;
      globalThis.fetch = async () => {
        count++;
        return (count === 1) === throttleFirst ? new Response('', { status: 429, headers: { 'retry-after': '0.001' } }) : completion('{"ok":');
      };
      await assert.rejects(completeJson('s', 'u', z.object({ ok: z.boolean() })), error => error instanceof ModelError && ['MODEL_SCHEMA', 'MODEL_HTTP'].includes(error.code));
      assert.equal(count, 2);
    }
  } finally { globalThis.fetch = original; }
});

test('telemetry binds captured config, safe request ID, usage and changing stage without secrets', async () => {
  const config = snapshotModelConfig(), calls: ModelCallRecord[] = []; let stage = 'write';
  await withModelExecution({ jobId: 'job', stage: () => stage, config, onCall: c => calls.push(c) }, async () => {
    const fetcher: typeof fetch = async (_url, init) => {
      assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${config.apiKey}`);
      return completion('{"ok":true}', { 'x-request-id': 'request-safe-123' });
    };
    await callModel('s', 'u', { fetcher }); stage = 'review';
    await callModel('s', 'u', { fetcher });
  });
  const finished = calls.filter(c => c.outcome === 'succeeded');
  assert.deepEqual(finished.map(c => c.stage), ['write', 'review']);
  assert.equal(finished[0].requestId, 'request-safe-123'); assert.equal(finished[0].usage?.totalTokens, 18);
  for (const c of finished) for (const field of ['firstResponseMs', 'firstContentMs', 'maxIdleMs', 'totalMs', 'queueMs'] as const) assert.equal(typeof c[field], 'number');
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(config.apiKey!));
});

test('504 and 524 are outcome unknown and are never automatically replayed', async () => {
  for (const status of [504, 524]) {
    let count = 0; const calls: ModelCallRecord[] = [];
    await assert.rejects(withModelExecution({ jobId: 'uncertain', onCall: c => calls.push(c) }, () => callModel('s', 'u', { fetcher: async () => { count++; return new Response('', { status }); } })), error => error instanceof ModelError && error.upstreamStatus === status && error.outcomeUnknown);
    assert.equal(count, 1); assert.equal(calls.at(-1)?.outcome, 'unknown'); assert.equal(calls.at(-1)?.upstreamStatus, status);
  }
});

test('usage arriving in its own trailing stream chunk is captured without waiting for an open transport', async () => {
  const calls: ModelCallRecord[] = [];
  const bytes = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes({ choices: [{ index: 0, delta: { content: '完成' }, finish_reason: 'stop' }] }));
      setTimeout(() => controller.enqueue(bytes({ choices: [], usage: { total_tokens: 27 } })), 10);
    },
  });
  const text = await withModelExecution({ onCall: c => calls.push(c) }, () => callModel('s', 'u', { fetcher: async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }) }));
  assert.equal(text, '完成'); assert.equal(calls.at(-1)?.usage?.totalTokens, 27);
});

test('post-slot validity guards compose, reject expired queued work without dispatch, and release the slot', async () => {
  const gates: Array<() => void> = [], calls: ModelCallRecord[] = [];
  let dispatched = 0, valid = true, parentChecks = 0, childChecks = 0;
  const fetcher: typeof fetch = async () => { dispatched++; await new Promise<void>(resolve => gates.push(resolve)); return completion(); };
  const occupied = Array.from({ length: 4 }, () => callModel('s', 'u', { fetcher }));
  await until(() => dispatched === 4);
  const queued = withModelExecution({ beforeDispatch() { parentChecks++; if (!valid) throw new Error('source expired'); }, onCall: c => calls.push(c) }, () =>
    withModelExecution({ beforeDispatch() { childChecks++; } }, () => callModel('s', 'queued', { fetcher: async () => { dispatched++; return completion(); } })));
  const rejected = assert.rejects(queued, /source expired/);
  valid = false; gates.shift()!();
  await rejected;
  assert.equal(dispatched, 4); assert.equal(parentChecks, 1); assert.equal(childChecks, 0); assert.deepEqual(calls, []);
  for (const release of gates) release(); await Promise.all(occupied);
  await withModelExecution({ beforeDispatch() { parentChecks++; } }, () => withModelExecution({ beforeDispatch() { childChecks++; } }, () => callModel('s', 'valid', { fetcher: async () => completion() })));
  assert.equal(parentChecks, 2); assert.equal(childChecks, 1);
});
