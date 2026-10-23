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

test('retry rejects another running Job and its cancellation cleanup for the same outline', async () => {
  let first = true; let cleanup!: () => void; const starts: string[] = [];
  const f = fixture(async (record, ctx) => {
    starts.push(record.job.id);
    if (first) { first = false; throw new Error('isolated retryable failure'); }
    if (starts.length === 2) {
      await new Promise<void>(resolve => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
      await new Promise<void>(resolve => { cleanup = resolve; });
    } else record.job.channels[0].status = 'completed';
  });
  try {
    const failed = f.queue.submit('retry-conflict-failed', input(), model, ['moments']);
    await until(() => f.queue.get(failed.id).status === 'failed' && !f.queue.hasPending());
    const running = f.queue.submit('retry-conflict-running', input(), model, ['moments']);
    await until(() => f.queue.get(running.id).status === 'running');
    assert.throws(() => f.queue.retry(failed.id), (error: any) => error.status === 409);
    assert.throws(() => f.queue.submit('retry-conflict-new', { kind: 'generate', outlineId: 'outline', version: 2 }, model, ['moments']), (error: any) => error.status === 409);
    assert.equal(f.queue.get(failed.id).status, 'failed'); assert.equal(starts.length, 2);
    f.queue.cancel(running.id); await until(() => !!cleanup);
    assert.throws(() => f.queue.retry(failed.id), (error: any) => error.status === 409);
    assert.equal(starts.length, 2);
    cleanup(); await until(() => !f.queue.hasPending());
    f.queue.retry(failed.id); await until(() => f.queue.get(failed.id).status === 'completed');
    assert.equal(starts.length, 3);
  } finally { cleanup?.(); f.cleanup(); }
});

test('retry rejects another queued Job for the same outline and resumes after queued cancellation', async () => {
  let first = true; let release!: () => void;
  const starts: string[] = [];
  const f = fixture(async record => {
    starts.push(record.job.id);
    if (first) { first = false; throw new Error('isolated retryable failure'); }
    if (record.job.input.kind === 'generate' && record.job.input.outlineId === 'unrelated') await new Promise<void>(resolve => { release = resolve; });
    record.job.channels[0].status = 'completed';
  }, 1);
  try {
    const failed = f.queue.submit('retry-queued-failed', input(), model, ['moments']);
    await until(() => f.queue.get(failed.id).status === 'failed' && !f.queue.hasPending());
    f.queue.submit('retry-queued-blocker', input('unrelated'), model, ['moments']);
    await until(() => !!release);
    const queued = f.queue.submit('retry-queued-same', input(), model, ['moments']);
    assert.equal(f.queue.get(queued.id).status, 'queued');
    assert.throws(() => f.queue.retry(failed.id), (error: any) => error.status === 409);
    assert.equal(f.queue.get(failed.id).status, 'failed'); assert.equal(starts.length, 2);
    f.queue.cancel(queued.id); f.queue.retry(failed.id);
    assert.equal(f.queue.get(failed.id).status, 'queued'); assert.equal(starts.length, 2);
    release(); await until(() => f.queue.get(failed.id).status === 'completed');
    assert.equal(starts.length, 3); assert.ok(!starts.includes(queued.id));
  } finally { release?.(); f.cleanup(); }
});

test('retry waits until its own failed worker has detached before resuming', async () => {
  let tries = 0; let rejectedDuringCleanup = false;
  const f = fixture(async record => { if (++tries === 1) throw new Error('isolated retryable failure'); record.job.channels[0].status = 'completed'; });
  let id = '';
  const stop = f.queue.subscribe(() => {
    if (id && f.queue.get(id).status === 'failed' && !rejectedDuringCleanup) {
      assert.throws(() => f.queue.retry(id), (error: any) => error.status === 409);
      rejectedDuringCleanup = true;
    }
  });
  try {
    id = f.queue.submit('retry-own-cleanup', input(), model, ['moments']).id;
    await until(() => rejectedDuringCleanup && !f.queue.hasPending());
    f.queue.retry(id); await until(() => f.queue.get(id).status === 'completed'); assert.equal(tries, 2);
  } finally { stop(); f.cleanup(); }
});

test('suspended external-design jobs never dispatch after restart or through retry, preserving paid uncertainty', async()=>{
  let count=0;const f=fixture(async()=>{count++;});
  try {
    const old=f.queue.submit('paused-old-job',input('legacy'),model,['poster']);f.queue.close();
    const record=f.store.get<StoredJob>('jobs',old.id)!;
    record.job.kind='render';record.job.input={kind:'render',request:{runId:'old-run',revision:1,platform:'poster',selectedTitleIndex:0,templateId:'poster-paper',visualMode:'canva'}};
    record.job.status='running';record.job.channels[0].status='running';record.job.channels[0].stage='canva_import';record.pendingPaid={oldPaid:{stage:'image',platform:'poster'}};
    f.store.set('jobs',old.id,record);
    const recovered=new JobQueue(f.store,async()=>{count++;},()=> 'config-v1');
    try {
      recovered.start();await new Promise(r=>setTimeout(r,15));const paused=recovered.get(old.id);
      assert.equal(count,0);assert.equal(paused.status,'failed');assert.equal(paused.error?.code,'EXTERNAL_DESIGN_PAUSED');assert.equal(paused.error?.outcomeUnknown,true);
      assert.throws(()=>recovered.retry(old.id),(e:any)=>e.status===410&&e.code==='EXTERNAL_DESIGN_PAUSED');
      assert.throws(()=>recovered.submit('paused-new-job',record.job.input,model,['poster']),(e:any)=>e.status===410);
      assert.deepEqual(f.store.get<StoredJob>('jobs',old.id)?.pendingPaid,record.pendingPaid);
    } finally {recovered.close();}
  } finally {f.cleanup();}
});

test('a legacy live generator with pending external poster cannot resume through the generic retry route',async()=>{
 let count=0;const f=fixture(async()=>{count++;});
 try{
  const old=f.queue.submit('legacy-generator',input('old-outline'),model,['poster']);f.queue.close();
  const record=f.store.get<StoredJob>('jobs',old.id)!;const now=new Date().toISOString();
  const product={id:'synthetic-product',name:'纯模拟机型',system:'模拟系统',category:'测试',description:'仅用于队列恢复',imageCount:0};
  const brief={productId:product.id,audience:'测试',scene:'测试恢复',goal:'测试',buyingStage:'测试',platforms:['poster' as const],instructions:'',mode:'live' as const,knowledgeSource:'local' as const};
  record.snapshot={id:'old-outline',version:1,status:'confirmed',createdAt:now,confirmedAt:now,brief,product,evidence:{product,facts:[],images:[],sources:[],retrievedAt:now,sourceMode:'local',warnings:[]},platforms:[],warnings:[]};
  record.rendererMode='html';record.job.status='queued';f.store.set('jobs',old.id,record);
  const recovered=new JobQueue(f.store,async()=>{count++;},()=> 'config-v1');
  try{recovered.start();await new Promise(r=>setTimeout(r,15));assert.equal(count,0);assert.equal(recovered.get(old.id).error?.code,'EXTERNAL_DESIGN_PAUSED');assert.throws(()=>recovered.retry(old.id),(e:any)=>e.status===410);}finally{recovered.close();}
 }finally{f.cleanup();}
});

test('fresh video keys retain failed or cancelled v2 paid checkpoints and require explicit continuation',async()=>{
 let attempts=0,writes=0,reviews=0;
 const f=fixture(async(record,ctx)=>{
  attempts++;const platform='xiaohongshu' as const;
  const call=(id:string,stage:string,outcome:ModelCallRecord['outcome']):ModelCallRecord=>({id,stage,platform,attempt:1,queuedAt:new Date().toISOString(),outcome});
  if(!record.checkpoints.videoScript){writes++;ctx.call(call('write','video_script','dispatched'));record.checkpoints.videoScript={sourceFingerprint:'same-text',script:{title:'纯模拟已付费短稿'}};ctx.call(call('write','video_script','succeeded'));ctx.acknowledge('video_script',platform);ctx.save();}
  record.job.channels[0].stage='video_review';reviews++;ctx.call(call(`review-${attempts}`,'video_review','dispatched'));
  if(attempts===1){ctx.call(call('review-1','video_review','unknown'));throw Object.assign(new Error('synthetic response lost'),{outcomeUnknown:true});}
  ctx.call(call('review-2','video_review','succeeded'));ctx.acknowledge('video_review',platform);record.job.channels[0].status='completed';ctx.save();
 });
 try{
  const video:JobInput={kind:'video',deliveryId:'11111111-1111-4111-8111-111111111111'};
  const original=f.queue.submit('first-video-key',video,model,['xiaohongshu'],{checkpoints:{videoMode:'script-v2',videoTextFingerprint:'same-text',videoSource:{fingerprint:'old-layout',expiresAt:new Date(Date.now()+60000).toISOString()}}});
  await until(()=>f.queue.get(original.id).status==='failed');
  const retained=f.queue.recoverVideoSubmission('new-video-key',video,'same-text','new-layout');assert.equal(retained?.id,original.id);assert.equal(retained?.error?.outcomeUnknown,true);assert.equal(writes,1);assert.equal(reviews,1);assert.equal(attempts,1);
  assert.equal(f.queue.findSubmission('new-video-key',video)?.id,original.id);
  assert.equal(f.queue.recoverVideoSubmission('changed-video-key',video,'different-text','different-layout'),undefined);
  f.queue.cancel(original.id);assert.equal(f.queue.recoverVideoSubmission('cancelled-video-key',video,'same-text','new-layout')?.id,original.id);
  f.queue.retry(original.id);await until(()=>f.queue.get(original.id).status==='completed');assert.equal(writes,1);assert.equal(reviews,2);assert.equal(attempts,2);assert.deepEqual(f.store.get<StoredJob>('jobs',original.id)?.pendingPaid,{});
 }finally{f.cleanup();}
});
