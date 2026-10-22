import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStateStore } from '../server/state-store.js';
import { JobQueue, type StoredJob } from '../server/job-store.js';
import type { JobInput, ModelCallRecord } from '../shared/types.js';
const model = { name: 'mock-model', baseUrl: 'https://mock.invalid/v1' };
const input = (id = 'outline'): JobInput => ({ kind: 'generate', outlineId: id, version: 1 });
function fixture(execute: ConstructorParameters<typeof JobQueue>[1], max = 2) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jobs-')); const store = new FileStateStore(dir);
  const queue = new JobQueue(store, execute, () => 'config-v1', max);
  return { dir, store, queue, cleanup() { queue.close(); store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
async function until(check: () => boolean) { for (let n = 0; n < 200; n++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('job did not settle'); }

test('persistent idempotency and logical duplicate submissions dispatch exactly once; payload mismatch conflicts', async () => {
  let count = 0; let finish!: () => void;
  const f = fixture(async r => { count++; await new Promise<void>(resolve => { finish = resolve; }); r.job.channels[0].status = 'completed'; });
  try {
    const a = f.queue.submit('test-key-a', input(), model, ['moments']);
    assert.equal(f.queue.submit('test-key-a', input(), model, ['moments']).id, a.id);
    assert.equal(f.queue.submit('test-key-b', input(), model, ['moments']).id, a.id);
    assert.throws(() => f.queue.submit('test-key-a', input('other'), model, ['moments']), (e: any) => e.status === 409);
    assert.equal(f.queue.list('test-key-b')[0].id, a.id);
    await until(() => count === 1); finish(); await until(() => f.queue.get(a.id).status === 'completed'); assert.equal(count, 1);
    assert.equal(f.queue.submit('test-key-a', input(), model, ['moments']).id, a.id);
  } finally { f.cleanup(); }
});
test('two active jobs, queued FIFO jobs and independent cancellation; subscription close never cancels execution', async () => {
  const started: string[] = []; const finishes = new Map<string, () => void>(); let peak = 0; let active = 0;
  const f = fixture(async (r, ctx) => {
    active++; peak = Math.max(peak, active); started.push(r.job.id);
    try { await new Promise<void>((resolve, reject) => { finishes.set(r.job.id, resolve); ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true }); }); r.job.channels[0].status = 'completed'; }
    finally { active--; }
  });
  try {
    const a = f.queue.submit('queue-key-a', input('a'), model, ['moments']);
    const b = f.queue.submit('queue-key-b', input('b'), model, ['moments']);
    const c = f.queue.submit('queue-key-c', input('c'), model, ['moments']);
    const stop = f.queue.subscribe(() => {}); stop(); await until(() => started.length === 2);
    assert.equal(f.queue.get(c.id).status, 'queued'); f.queue.cancel(a.id); await until(() => started.length === 3);
    assert.equal(f.queue.get(b.id).status, 'running'); assert.equal(f.queue.get(a.id).status, 'cancelled');
    finishes.get(b.id)!(); finishes.get(c.id)!(); await until(() => f.queue.get(c.id).status === 'completed'); assert.equal(peak, 2);
  } finally { f.cleanup(); }
});
test('manual retry keeps successful channel and draft checkpoints; outcome unknown is never auto retried', async () => {
  let tries = 0; let writes = 0; let reviews = 0;
  const f = fixture(async (r, ctx) => {
    tries++; if (!r.checkpoints.draft) { writes++; r.checkpoints.draft = { text: 'paid success' }; ctx.save(); }
    reviews++;
    if (tries === 1) { r.job.channels[0].status = 'completed'; r.job.channels[1].status = 'failed'; r.job.channels[1].error = { code: 'MODEL_HTTP', message: '524', stage: 'review', platform: 'wechat', upstreamStatus: 524, outcomeUnknown: true, retryable: true }; return; }
    assert.equal(r.job.channels[0].status, 'completed'); assert.deepEqual(r.checkpoints.draft, { text: 'paid success' }); r.job.channels[1].status = 'completed';
  });
  try {
    const job = f.queue.submit('retry-key', input(), model, ['moments', 'wechat']); await until(() => f.queue.get(job.id).status === 'failed');
    await new Promise(r => setTimeout(r, 25)); assert.equal(tries, 1); assert.equal(f.queue.get(job.id).error?.outcomeUnknown, true);
    f.queue.retry(job.id); await until(() => f.queue.get(job.id).status === 'completed'); assert.equal(writes, 1); assert.equal(reviews, 2);
  } finally { f.cleanup(); }
});
test('restart resumes never-dispatched work but does not replay paid dispatch; configuration is bound', async () => {
  const f = fixture(async () => {}); f.queue.close();
  try {
    const fresh = f.queue.submit('restart-queued', input('queued'), model, ['moments']);
    const unknown = f.queue.submit('restart-unknown', input('unknown'), model, ['moments']);
    const r = f.store.get<StoredJob>('jobs', unknown.id)!; r.job.status = 'running'; r.job.channels[0].status = 'running'; r.job.channels[0].stage = 'review';
    const call: ModelCallRecord = { id: 'paid-call', stage: 'review', platform: 'moments', attempt: 1, queuedAt: new Date().toISOString(), startedAt: new Date().toISOString(), outcome: 'dispatched' };
    r.job.calls.push(call); r.checkpoints.draft = 'retained'; f.store.set('jobs', unknown.id, r);
    let count = 0; const recovered = new JobQueue(f.store, async r => { count++; r.job.channels[0].status = 'completed'; }, () => 'config-v1');
    recovered.start(); await until(() => recovered.get(fresh.id).status === 'completed');
    assert.equal(count, 1); assert.equal(recovered.get(unknown.id).status, 'interrupted'); assert.equal(recovered.get(unknown.id).calls[0].outcome, 'unknown');
    recovered.retry(unknown.id); await until(() => recovered.get(unknown.id).status === 'completed'); assert.equal(count, 2); recovered.close();
    const changed = new JobQueue(f.store, async () => assert.fail('wrong model must not dispatch'), () => 'config-v2');
    const bad = f.store.get<StoredJob>('jobs', unknown.id)!; bad.job.status = 'failed'; f.store.set('jobs', unknown.id, bad); changed.close();
    const changed2 = new JobQueue(f.store, async () => {}, () => 'config-v2'); assert.throws(() => changed2.retry(unknown.id), (e: any) => e.status === 409); changed2.close();
  } finally { f.cleanup(); }
});
test('damaged job records fail closed without overwriting corrupt record', () => {
  const f = fixture(async () => {}); f.queue.close();
  try { f.store.set('jobs', 'broken', { broken: true }); assert.throws(() => new JobQueue(f.store, async () => {}, () => 'x'), /损坏/); assert.deepEqual(f.store.get('jobs', 'broken'), { broken: true }); }
  finally { f.cleanup(); }
});

test('HTTP success before a durable output checkpoint is interrupted on restart rather than bought again', async () => {
  const call: ModelCallRecord = { id: 'success-without-checkpoint', stage: 'write', platform: 'moments', attempt: 1, queuedAt: new Date().toISOString(), outcome: 'dispatched' };
  const f = fixture(async (r, ctx) => {
    r.job.channels[0].status = 'running'; ctx.call(call);
    ctx.call({ ...call, outcome: 'succeeded', endedAt: new Date().toISOString() });
    await new Promise(() => {}); // failpoint: process exits after HTTP success, before parsing/checkpoint.
  });
  try {
    const job = f.queue.submit('checkpoint-gap', input('gap'), model, ['moments']);
    await until(() => f.queue.get(job.id).calls[0]?.outcome === 'succeeded'); f.queue.close();
    let dispatches = 0;
    const recovered = new JobQueue(f.store, async (r, ctx) => {
      dispatches++; r.checkpoints.draft = 'manual retry output'; ctx.acknowledge('write', 'moments'); ctx.save(); r.job.channels[0].status = 'completed';
    }, () => 'config-v1');
    recovered.start(); await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(dispatches, 0); assert.equal(recovered.get(job.id).status, 'interrupted');
    assert.equal(recovered.get(job.id).error?.outcomeUnknown, true);
    assert.equal(recovered.get(job.id).calls[0].outcome, 'succeeded', 'ledger retains the known HTTP success');
    recovered.retry(job.id); await until(() => recovered.get(job.id).status === 'completed');
    assert.equal(dispatches, 1); assert.deepEqual(f.store.get<StoredJob>('jobs', job.id)!.pendingPaid, {}); recovered.close();
  } finally { f.cleanup(); }
});

test('a committed stage output and acknowledgement resume an un-dispatched next stage after restart', async () => {
  const call: ModelCallRecord = { id: 'acknowledged-write', stage: 'write', platform: 'moments', attempt: 1, queuedAt: new Date().toISOString(), outcome: 'dispatched' };
  const f = fixture(async (r, ctx) => {
    r.job.channels[0].status = 'running'; ctx.call(call); ctx.call({ ...call, outcome: 'succeeded' });
    r.checkpoints.draft = 'known paid result'; ctx.acknowledge('write', 'moments'); ctx.save();
    r.job.channels[0].stage = 'review'; ctx.save(); await new Promise(() => {});
  });
  try {
    const job = f.queue.submit('checkpoint-safe-resume', input('safe'), model, ['moments']);
    await until(() => f.store.get<StoredJob>('jobs', job.id)?.job.channels[0].stage === 'review'); f.queue.close();
    let reviews = 0;
    const recovered = new JobQueue(f.store, async r => { reviews++; assert.equal(r.checkpoints.draft, 'known paid result'); r.job.channels[0].status = 'completed'; }, () => 'config-v1');
    recovered.start(); await until(() => recovered.get(job.id).status === 'completed');
    assert.equal(reviews, 1); assert.equal(recovered.get(job.id).calls.length, 1); recovered.close();
  } finally { f.cleanup(); }
});

test('known explicit failures clear their own marker while an earlier uncheckpointed success remains pending', async () => {
  const f = fixture(async (r, ctx) => {
    r.job.channels[0].status = 'running';
    const call: ModelCallRecord = { id: 'invalid-output', stage: 'write', platform: 'moments', attempt: 1, queuedAt: new Date().toISOString(), outcome: 'dispatched' };
    ctx.call(call); ctx.call({ ...call, outcome: 'succeeded' });
    ctx.call({ ...call, id: 'explicit-rejection', attempt: 2 });
    ctx.call({ ...call, id: 'explicit-rejection', attempt: 2, outcome: 'failed', upstreamStatus: 401 });
    await new Promise(() => {});
  });
  try {
    const job = f.queue.submit('checkpoint-failed-correction', input('correction'), model, ['moments']);
    await until(() => f.queue.get(job.id).calls.length === 2); f.queue.close();
    assert.deepEqual(Object.keys(f.store.get<StoredJob>('jobs', job.id)!.pendingPaid!), ['invalid-output']);
    const recovered = new JobQueue(f.store, async () => assert.fail('uncheckpointed success must not replay'), () => 'config-v1');
    assert.equal(recovered.get(job.id).status, 'interrupted'); recovered.close();
  } finally { f.cleanup(); }
});

test('standalone renders have two slots independent of the two active creative jobs', async () => {
  const started: string[] = []; const finishes = new Map<string, () => void>();
  const f = fixture(async (r, ctx) => {
    started.push(r.job.id); await new Promise<void>((resolve, reject) => { finishes.set(r.job.id, resolve); ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true }); }); r.job.channels[0].status = 'completed';
  });
  try {
    const creatives = ['a', 'b', 'c'].map(id => f.queue.submit(`separate-creative-${id}`, input(id), model, ['moments']));
    const renders = ['a', 'b', 'c'].map(id => f.queue.submit(`separate-render-${id}`, { kind: 'render', request: { runId: id, revision: 1, platform: 'moments', templateId: 'moments-square', selectedTitleIndex: 0 } }, model, ['moments']));
    await until(() => started.length === 4);
    assert.equal(f.queue.get(creatives[2].id).status, 'queued'); assert.equal(f.queue.get(renders[2].id).status, 'queued');
    for (const job of [...creatives.slice(0, 2), ...renders.slice(0, 2)]) finishes.get(job.id)!();
    await until(() => started.length === 6); finishes.get(creatives[2].id)!(); finishes.get(renders[2].id)!();
    await until(() => f.queue.get(renders[2].id).status === 'completed');
  } finally { f.cleanup(); }
});

test('jobs that expire while waiting do not dispatch or keep configuration and outline locks', async () => {
  const currentTime = Date.now; let dispatches = 0; const f = fixture(async () => { dispatches++; });
  try {
    const job = f.queue.submit('expires-before-dispatch', input('expired-outline'), model, ['moments']);
    Date.now = () => currentTime() + 8 * 24 * 60 * 60_000;
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(dispatches, 0); assert.equal(f.queue.hasPending(), false); assert.equal(f.queue.hasOutlineUse('expired-outline'), false);
    assert.deepEqual(f.queue.list('expires-before-dispatch'), []); assert.throws(() => f.queue.get(job.id), (error: any) => error.status === 410);
  } finally { f.queue.close(); Date.now = currentTime; f.cleanup(); }
});

test('explicit cancel retains configuration and record locks until async cleanup finishes', async () => {
  let cleanup!: () => void; let started = false;
  const f = fixture(async (r, ctx) => {
    started = true;
    await new Promise<void>(resolve => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
    await new Promise<void>(resolve => { cleanup = resolve; });
  });
  try {
    const job = f.queue.submit('cancel-cleanup', input(), model, ['moments']); await until(() => started);
    f.queue.cancel(job.id); await until(() => !!cleanup);
    assert.equal(f.queue.hasPending(), true); assert.equal(f.queue.hasOutlineUse('outline'), true);
    cleanup(); await until(() => !f.queue.hasPending()); assert.equal(f.queue.hasOutlineUse('outline'), false);
  } finally { f.cleanup(); }
});
