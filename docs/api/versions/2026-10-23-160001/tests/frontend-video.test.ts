import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import type { BackgroundJob, Brief, ChannelDelivery, JobStage, OutlineResult } from '../shared/types.js';
import { ApiError, createWorkflowClient } from '../src/api/client.js';
import { createMockTransport } from '../src/api/mock.js';
import { mergeJobBundles, videoNeedsRecovery } from '../src/job-state.js';
import { deliveryRenderOptions } from '../src/delivery-render-request.js';
import fixture from '../src/api/fixtures/frontend.mock.json';

type Client = ReturnType<typeof createWorkflowClient>;
const pause = () => new Promise(resolve => setTimeout(resolve, 4));
async function done(client: Client, id: string) {
  const limit = Date.now() + 6000;
  do {
    const { job } = await client.api<{ job: BackgroundJob }>(`/api/jobs/${id}`);
    if (!['queued', 'running'].includes(job.status)) return job;
    await pause();
  } while (Date.now() < limit);
  throw new Error('Mock video did not finish');
}
async function deliveries(client: Client) {
  const brief = structuredClone(fixture.fourChannelOutline.brief) as Brief;
  brief.platforms = ['xiaohongshu', 'wechat'];
  const outline = await client.api<OutlineResult>('/api/outlines', 'POST', brief);
  await client.api(`/api/outlines/${outline.id}/confirm`, 'POST', { version: outline.version });
  const submitted = await client.submitJob({ kind: 'generate', outlineId: outline.id, version: outline.version, idempotencyKey: crypto.randomUUID() });
  const completed = await done(client, submitted.id); assert.equal(completed.status, 'completed');
  return completed.channels.map(channel => channel.delivery!);
}

test('HTML channel defaults work without image keys or Canva and include design source files', async () => {
  const client = createWorkflowClient(createMockTransport('ok', { latencyMs: 0 }));
  for (const delivery of await deliveries(client)) {
    assert.equal(delivery.bundle?.rendererVersion, 4);
    const files = unzipSync(new Uint8Array(await (await client.apiFetch(delivery.bundle!.zipUrl!)).arrayBuffer()));
    assert.equal(JSON.parse(strFromU8(files['制作源/design.json'])).mode, 'html');
    assert.ok(files['制作源/index.html']);
    assert.equal(delivery.externalDesigns, undefined);
  }
});

test('video lost acknowledgement and repeated clicks reconcile once, preserve static bundle and recover through a new client', async () => {
  const transport = createMockTransport('ok', { latencyMs: 3 }); const original = createWorkflowClient(transport);
  const [delivery] = await deliveries(original); const staticBundle = delivery.bundle!;
  let posts = 0;
  const client = createWorkflowClient(async (url, init) => {
    const response = await transport(url, init);
    if (url === `/api/deliveries/${delivery.id}/video` && init?.method === 'POST') { posts++; throw new TypeError('lost video acknowledgement'); }
    return response;
  });
  const input = { kind: 'video' as const, deliveryId: delivery.id, idempotencyKey: crypto.randomUUID() };
  const job = await client.submitJob(input); assert.equal(posts, 1);
  const duplicate = await original.submitJob(input); assert.equal(duplicate.id, job.id);
  const alias = await original.submitJob({ ...input, idempotencyKey: crypto.randomUUID() }); assert.equal(alias.id, job.id);
  const completed = await done(createWorkflowClient(transport), job.id);
  assert.equal(completed.status, 'completed'); assert.equal(completed.result, undefined); assert.deepEqual(completed.renderBundles, []); assert.deepEqual(completed.calls.map(call => call.stage), ['video_script', 'video_review']);
  assert.equal(completed.videoScript?.version, 'video-script-v2'); assert.equal(completed.videoScriptReview?.status, 'passed');
  const restored = (await original.api<{ delivery: ChannelDelivery }>(`/api/deliveries/${delivery.id}`)).delivery;
  assert.equal(restored.bundle!.id, staticBundle.id); assert.equal(restored.bundle!.expiresAt, staticBundle.expiresAt);
  assert.equal(restored.videoBundle!.kind, 'video'); assert.equal(restored.videoBundle!.expiresAt, staticBundle.expiresAt);
  assert.equal(restored.videoBundle!.artifacts.find(a => a.format === 'mp4')?.frameCount, 600);
  assert.equal(completed.channels[0].progress?.completedFrames, 600);
  assert.equal((await original.apiFetch(staticBundle.zipUrl!)).status, 200);
  const video = restored.videoBundle!.artifacts.find(a => a.format === 'mp4')!;
  const ranged = await original.apiFetch(video.downloadUrl!, { headers: { Range: 'bytes=0-31' } });
  assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 32); assert.match(ranged.headers.get('Content-Range')!, /^bytes 0-31\//);
  assert.equal((await original.apiFetch(video.downloadUrl!, { headers: { Range: 'bytes=999999-' } })).status, 416);
  assert.equal(mergeJobBundles([staticBundle], [restored.videoBundle!]).length, 2, 'video rendition cannot supersede static output');
});

test('video retry reuses storyboard, affects no text or static stages and cancel only stops video', async () => {
  const stages: JobStage[] = [];
  const client = createWorkflowClient(createMockTransport('ok', { latencyMs: 2, videoFailureStage: 'video_render', onStage: (_id, _platform, stage) => stages.push(stage) }));
  const [delivery] = await deliveries(client); const baseline = stages.length;
  const job = await client.submitJob({ kind: 'video', deliveryId: delivery.id, idempotencyKey: crypto.randomUUID() });
  const failed = await done(client, job.id); assert.equal(failed.status, 'failed'); assert.equal(failed.error?.stage, 'video_render');
  assert.equal(videoNeedsRecovery(failed),true);
  const calls=failed.calls.length;const repeated=await client.submitJob({kind:'video',deliveryId:delivery.id,idempotencyKey:crypto.randomUUID()});
  assert.equal(repeated.id,failed.id);assert.equal(repeated.status,'failed');assert.equal(repeated.calls.length,calls,'new submit key cannot buy a duplicate short script after failure');
  assert.equal((await client.apiFetch(delivery.bundle!.zipUrl!)).status, 200);
  await client.api(`/api/jobs/${job.id}/retry`, 'POST', {});
  assert.equal((await done(client, job.id)).status, 'completed');
  assert.deepEqual(stages.slice(baseline), ['video_script', 'video_review', 'storyboard', 'video_render', 'video_render', 'video_encode']);
  const other = await client.submitJob({ kind: 'video', deliveryId: delivery.id, idempotencyKey: crypto.randomUUID() });
  await client.api(`/api/jobs/${other.id}/cancel`, 'POST', {}); const stopped=await done(client, other.id);assert.equal(stopped.status,'cancelled');assert.equal(videoNeedsRecovery(stopped),true);const aliased=await client.submitJob({kind:'video',deliveryId:delivery.id,idempotencyKey:crypto.randomUUID()});assert.equal(aliased.id,other.id);assert.equal(aliased.status,'cancelled');await client.api(`/api/jobs/${other.id}/retry`,'POST',{});assert.equal((await done(client,other.id)).error?.stage,'video_render');await client.api(`/api/jobs/${other.id}/retry`,'POST',{});assert.equal((await done(client,other.id)).status,'completed');
  const restored = (await client.api<{ delivery: ChannelDelivery }>(`/api/deliveries/${delivery.id}`)).delivery;
  assert.equal(restored.bundle?.id, delivery.bundle?.id); assert.ok(restored.videoBundle);
});

test('video requires an unexpired released source, explicitly rebinds rerendered layout and never extends original expiry', async () => {
  let now = Date.now();
  const client = createWorkflowClient(createMockTransport('ok', { latencyMs: 0, now: () => now, videoFailureStage: 'video_render' }));
  const [delivery] = await deliveries(client); const originalExpiry = delivery.bundle!.expiresAt;
  const job = await client.submitJob({ kind: 'video', deliveryId: delivery.id, idempotencyKey: crypto.randomUUID() });
  assert.equal((await done(client, job.id)).status, 'failed');
  const reflow = (await client.api<{ job: BackgroundJob }>(`/api/deliveries/${delivery.id}/rerender`, 'POST', { idempotencyKey: crypto.randomUUID(), visualMode: 'html' })).job;
  assert.equal((await done(client, reflow.id)).status, 'completed');
  await client.api(`/api/jobs/${job.id}/retry`, 'POST', {});
  const rebound = await done(client, job.id); assert.equal(rebound.status,'completed');assert.deepEqual(rebound.calls.map(call=>call.stage),['video_script','video_review']);
  assert.equal((await client.api<{ delivery: ChannelDelivery }>(`/api/deliveries/${delivery.id}`)).delivery.bundle?.expiresAt, originalExpiry);
  now = Date.parse(originalExpiry) + 1;
  await assert.rejects(client.submitJob({ kind: 'video', deliveryId: delivery.id, idempotencyKey: crypto.randomUUID() }), error => error instanceof ApiError && error.status === 410);
});

test('explicit background regeneration stays on HTML without Canva; expired backgrounds do not trigger automatic image requests', async () => {
  let now = Date.now(); const stages: JobStage[] = []; const posted: { url: string; body: Record<string, unknown> }[] = [];
  const transport = createMockTransport('ok', { latencyMs: 0, now: () => now, imageConfigured: true, canvaConnected: false, onStage: (_id, _platform, stage) => stages.push(stage) });
  const client = createWorkflowClient(async (url, init) => { if (init?.method === 'POST' && init.body) posted.push({ url, body: JSON.parse(String(init.body)) }); return transport(url, init); });
  const [delivery] = await deliveries(client);
  async function reflow(operation: 'html' | 'html-regenerate') {
    return client.submitJob({ kind: 'render', idempotencyKey: crypto.randomUUID(), request: { runId: delivery.runId, revision: delivery.revision, platform: delivery.platform, selectedTitleIndex: 0, templateId: 'xhs-cream', deliveryId: delivery.id, ...deliveryRenderOptions(operation) } });
  }
  const background = await done(client, (await reflow('html-regenerate')).id); assert.equal(background.status, 'completed');
  assert.equal(stages.filter(stage => stage === 'image').length, 1); assert.equal(stages.some(stage => stage.startsWith('canva_')), false);
  const request = [...posted].reverse().find(entry => entry.url === '/api/jobs' && entry.body.kind === 'render')!.body.request as Record<string, unknown>;
  assert.equal(request.visualMode, 'html'); assert.equal(request.regenerateVisual, true); assert.equal(request.canvaSync, undefined);
  assert.equal((await done(client, (await reflow('html')).id)).status, 'completed'); assert.equal(stages.filter(stage => stage === 'image').length, 1);
  now += 31 * 60_000;
  assert.equal((await done(client, (await reflow('html')).id)).error?.code, 'IMAGE_ASSET_EXPIRED'); assert.equal(stages.filter(stage => stage === 'image').length, 1);
  assert.equal((await done(client, (await reflow('html-regenerate')).id)).status, 'completed'); assert.equal(stages.filter(stage => stage === 'image').length, 2);
  assert.deepEqual(deliveryRenderOptions('poster-regenerate'), { visualMode: 'poster-image', regenerateVisual: true }, 'poster regeneration explicitly selects a billable image workflow');
});
