import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundJob, Brief, JobStage, Platform } from '../shared/types.js';
import { createWorkflowClient, ApiError } from '../src/api/client.js';
import { createMockTransport } from '../src/api/mock.js';
import { mergeJobBundles, mergeJobSnapshot } from '../src/job-state.js';
import fixture from '../src/api/fixtures/frontend.mock.json';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  const limit = Date.now() + 6000;
  do { const value = await read(); if (predicate(value)) return value; await pause(5); } while (Date.now() < limit);
  throw new Error('Mock job did not reach expected state');
}
const brief = structuredClone(fixture.fourChannelOutline.brief) as Brief;
const detail = (client: ReturnType<typeof createWorkflowClient>, id: string) => async () => (await client.api<{ job: BackgroundJob }>(`/api/jobs/${id}`)).job;
async function confirmed(client: ReturnType<typeof createWorkflowClient>) {
  const job = await client.submitJob({ kind: 'outline', brief, idempotencyKey: crypto.randomUUID() });
  const done = await until(detail(client, job.id), job => job.status === 'completed');
  const outline = done.outline!;
  return client.api<typeof outline>(`/api/outlines/${outline.id}/confirm`, 'POST', { version: outline.version });
}

test('background submit reconciles a lost acknowledgement without dispatching twice', async () => {
  const transport = createMockTransport('ok', { latencyMs: 0 }); let posts = 0;
  const client = createWorkflowClient(async (url, init) => {
    const response = await transport(url, init);
    if (url === '/api/jobs' && init?.method === 'POST') { posts++; throw new TypeError('acknowledgement lost'); }
    return response;
  });
  const input = { kind: 'outline' as const, brief, idempotencyKey: 'persistent-key-for-lost-ack' };
  const job = await client.submitJob(input);
  assert.equal(posts, 1); assert.equal(job.idempotencyKey, input.idempotencyKey);
  const jobs = await client.api<{ jobs: BackgroundJob[] }>('/api/jobs'); assert.equal(jobs.jobs.length, 1);
  const duplicate = await transport('/api/jobs', { method: 'POST', body: JSON.stringify(input) });
  assert.equal((await duplicate.json()).job.id, job.id);
});

test('background jobs survive subscription and submit connection closure; a new client restores by ID', async () => {
  const transport = createMockTransport('slow', { latencyMs: 8 }); const client = createWorkflowClient(transport);
  const subscription = new AbortController(); const snapshots: BackgroundJob[][] = [];
  const watching = client.subscribeJobs(subscription.signal, jobs => { snapshots.push(jobs); if (jobs.some(job => job.status === 'running')) subscription.abort(); });
  const submit = new AbortController(); const job = await client.submitJob({ kind: 'outline', brief, idempotencyKey: crypto.randomUUID() }, submit.signal); submit.abort();
  await assert.rejects(watching, error => error instanceof DOMException && error.name === 'AbortError');
  const restored = createWorkflowClient(transport);
  const complete = await until(detail(restored, job.id), job => job.status === 'completed');
  assert.equal(complete.outline?.platforms.length, 4); assert.ok(snapshots.length > 0);
});

test('first channel delivers before slowest channel without pretending a partial set is a final result', async () => {
  const client = createWorkflowClient(createMockTransport('ok', { latencyMs: 10 })); const outline = await confirmed(client);
  const job = await client.submitJob({ kind: 'generate', outlineId: outline.id, version: outline.version, idempotencyKey: crypto.randomUUID() });
  const partial = await until(detail(client, job.id), job => job.renderBundles.length > 0);
  assert.equal(partial.status, 'running'); assert.equal(partial.result, undefined);
  assert.ok(partial.channels.some(channel => channel.status !== 'completed'));
  assert.ok(partial.renderBundles.every(bundle => bundle.publication === 'released' && bundle.deliveryId && bundle.zipUrl && bundle.copyText && bundle.artifacts.every(artifact => artifact.downloadUrl)));
  assert.equal((await client.apiFetch(partial.renderBundles[0].zipUrl!)).status, 200);
  const firstIds=partial.renderBundles.map(bundle=>bundle.id);
  const complete = await until(detail(client, job.id), job => job.status === 'completed');
  assert.equal(complete.result?.drafts.length, 4); assert.equal(complete.renderBundles.length, 4);
  assert.ok(complete.renderBundles.every(bundle => bundle.publication === 'released' && bundle.zipUrl));
  assert.ok(firstIds.every(id=>complete.renderBundles.some(bundle=>bundle.id===id)), 'whole-job completion must reuse already delivered assets');
});

test('failed channel retry preserves successful channel and completed writing checkpoints', async () => {
  const stages: string[] = [];
  const client = createWorkflowClient(createMockTransport('error', { latencyMs: 1, onStage: (_job: string, platform: Platform, stage: JobStage) => stages.push(`${platform}:${stage}`) }));
  const outline = await confirmed(client);
  const job = await client.submitJob({ kind: 'generate', outlineId: outline.id, version: outline.version, idempotencyKey: crypto.randomUUID() });
  const failed = await until(detail(client, job.id), job => job.status === 'failed');
  assert.equal(failed.error?.upstreamStatus, 524); assert.equal(failed.error?.outcomeUnknown, true);
  const successful = failed.channels.filter(channel => channel.status === 'completed'); assert.equal(successful.length, 3);
  const originalDraftIds = successful.map(channel => channel.preview!.draft.id);
  const writes = stages.filter(stage => stage.endsWith(':write')).length;
  await client.api(`/api/jobs/${job.id}/retry`, 'POST', {});
  const complete = await until(detail(client, job.id), job => job.status === 'completed');
  assert.equal(stages.filter(stage => stage.endsWith(':write')).length, writes);
  assert.deepEqual(complete.channels.filter(channel => successful.some(saved => saved.platform === channel.platform)).map(channel => channel.preview!.draft.id), originalDraftIds);
});

test('explicit cancel affects only one job and a blocked channel retains its own export gate', async () => {
  const client = createWorkflowClient(createMockTransport('blocked', { latencyMs: 5 })); const outline = await confirmed(client);
  const cancelled = await client.submitJob({ kind: 'generate', outlineId: outline.id, version: outline.version, idempotencyKey: crypto.randomUUID() });
  const other = await client.submitJob({ kind: 'outline', brief, idempotencyKey: crypto.randomUUID() });
  await client.api(`/api/jobs/${cancelled.id}/cancel`, 'POST', {});
  await until(detail(client, cancelled.id), job => job.status === 'cancelled');
  assert.equal((await until(detail(client, other.id), job => job.status === 'completed')).outline?.status, 'editing');
  const blocked = await client.submitJob({ kind: 'generate', outlineId: outline.id, version: outline.version, idempotencyKey: crypto.randomUUID() });
  const complete = await until(detail(client, blocked.id), job => job.status === 'completed');
  assert.equal(complete.result?.review.status, 'blocked');
  const blocking=complete.result!.review.issues.filter(issue=>issue.severity==='error');
  for(const bundle of complete.renderBundles){
    const blocked=blocking.some(issue=>!issue.platform||issue.platform===bundle.platform);
    assert.equal(bundle.publication,blocked?'blocked':'released');
    if(blocked){assert.equal(bundle.zipUrl,undefined);assert.equal(bundle.copyText,'');assert.ok(bundle.artifacts.every(artifact=>!artifact.downloadUrl));}
    else{assert.ok(bundle.zipUrl);assert.equal((await client.apiFetch(bundle.zipUrl!)).status,200);}
  }
  assert.ok(complete.renderBundles.some(bundle=>bundle.publication==='blocked'));
  assert.ok(complete.renderBundles.some(bundle=>bundle.publication==='released'));
});

test('unknown submission without a matching persistent key is never automatically resubmitted', async () => {
  let posts = 0;
  const client = createWorkflowClient(async (url, init) => {
    if (url === '/api/jobs' && init?.method === 'POST') { posts++; throw new TypeError('offline'); }
    return new Response(JSON.stringify({ jobs: [] }), { headers: { 'Content-Type': 'application/json' } });
  });
  await assert.rejects(client.submitJob({ kind: 'outline', brief, idempotencyKey: crypto.randomUUID() }), error => error instanceof ApiError && error.kind === 'incomplete');
  assert.equal(posts, 1);
});


test('lost acknowledgement reconciles an active logical job returned under an alias key', async () => {
  const transport = createMockTransport('ok', { latencyMs: 0 }); const existingClient = createWorkflowClient(transport);
  const original = await existingClient.submitJob({ kind: 'outline', brief, idempotencyKey: 'original-key' }); let posts = 0;
  const client = createWorkflowClient(async (url, init) => {
    if (url === '/api/jobs' && init?.method === 'POST') { posts++; throw new TypeError('lost alias acknowledgement'); }
    return new Response(JSON.stringify({ jobs: [original] }), { headers: { 'Content-Type': 'application/json' } });
  });
  const recovered = await client.submitJob({ kind: 'outline', brief, idempotencyKey: 'alias-key' });
  assert.equal(recovered.id, original.id); assert.equal(recovered.idempotencyKey, 'original-key'); assert.equal(posts, 1);
});


test('compact terminal events invalidate stale detail and keep the exact hydrated revision', async () => {
  const client = createWorkflowClient(createMockTransport('ok', { latencyMs: 0 }));
  const initial = await client.submitJob({ kind: 'outline', brief, idempotencyKey: crypto.randomUUID() });
  const full = await until(detail(client, initial.id), job => job.status === 'completed');
  const compact: BackgroundJob = { ...full, detailOmitted: true, outline: undefined, result: undefined, renderBundles: [], calls: [], channels: full.channels.map(({ preview: _, ...channel }) => channel) };
  assert.equal(mergeJobSnapshot([full], [compact])[0], full);
  assert.equal(mergeJobSnapshot([initial], [compact])[0], compact);
  assert.equal(mergeJobSnapshot([full], [{ ...initial, detailOmitted: true, updatedAt: '2000-01-01T00:00:00Z' }])[0], full);
});

test('independent assets retain identity at final completion and released identity cannot regress to a legacy preview', async () => {
  const client = createWorkflowClient(createMockTransport('ok', { latencyMs: 4 })); const outline = await confirmed(client);
  const job = await client.submitJob({ kind: 'generate', outlineId: outline.id, version: outline.version, idempotencyKey: crypto.randomUUID() });
  const partial = await until(detail(client, job.id), job => job.renderBundles.length > 0); const preview = partial.renderBundles[0];
  const complete = await until(detail(client, job.id), job => job.status === 'completed'); const released = complete.renderBundles.find(bundle => bundle.platform === preview.platform)!;
  assert.equal(released.id, preview.id);
  assert.equal(released.expiresAt,preview.expiresAt);
  const legacyPreview={...preview,id:'legacy-preview-handle',publication:'preview' as const,zipUrl:undefined,copyText:'',artifacts:preview.artifacts.map(({downloadUrl:_,...artifact})=>artifact)};
  assert.deepEqual(mergeJobBundles([legacyPreview], [released]), [released]);
  assert.deepEqual(mergeJobBundles([released], [legacyPreview]), [released]);
});
