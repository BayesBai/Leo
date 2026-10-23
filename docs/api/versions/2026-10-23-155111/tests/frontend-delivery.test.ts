import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import type { BackgroundJob, Brief, ChannelDelivery, OutlineResult, RunResult } from '../shared/types.js';
import { createWorkflowClient, ApiError } from '../src/api/client.js';
import { createMockTransport } from '../src/api/mock.js';
import { canRetryJob, oldVideoNeedsNewJob, pausedExternalDesign, videoNeedsRecovery, visibleJobError } from '../src/job-state.js';
import { channelReview, reviewHeading } from '../src/channel-review.js';
import { viewableDeliveryBundle } from '../src/delivery-render-request.js';
import fixture from '../src/api/fixtures/frontend.mock.json';

type Client = ReturnType<typeof createWorkflowClient>;
async function done(c: Client, id: string) {
  for(let tries=0;tries<100;tries++){const {job}=await c.api<{job:BackgroundJob}>(`/api/jobs/${id}`);if(!['queued','running'].includes(job.status))return job;await new Promise(r=>setTimeout(r,5));}throw new Error('Mock did not finish');
}
async function run(c: Client) {
  const outline=await c.api<OutlineResult>('/api/outlines','POST',structuredClone(fixture.fourChannelOutline.brief) as Brief);
  await c.api(`/api/outlines/${outline.id}/confirm`,'POST',{version:outline.version});
  return done(c,(await c.submitJob({kind:'generate',outlineId:outline.id,version:outline.version,idempotencyKey:crypto.randomUUID()})).id);
}

test('current-channel warnings are deliverable reminders and another channel error never leaks into its banner',()=>{
  const result=structuredClone(fixture.fourChannelResult) as RunResult;
  result.review={...result.review,status:'blocked',issues:[{id:'local',severity:'warning',category:'source',message:'Local sources need a check',suggestion:'Verify before publishing'},{id:'poster',platform:'poster',severity:'error',category:'fact',message:'Poster fact error',suggestion:'Fix poster'}]};
  assert.equal(channelReview(result,'moments').status,'needs_attention');assert.equal(channelReview(result,'moments').issues.length,1);
  assert.equal(reviewHeading(channelReview(result,'moments')),'可交付 · 1 项发布提醒');assert.equal(channelReview(result,'poster').status,'blocked');
});

test('poster preview needs all three checks and exact immutable pointers, then publishes new download handles without extending expiry',async()=>{
  const c=createWorkflowClient(createMockTransport('ok',{latencyMs:0}));const job=await run(c);const initial=job.channels.find(c=>c.platform==='poster')!.delivery!;
  assert.equal(initial.bundle?.artifacts.length,1);assert.equal(initial.bundle?.artifacts[0].width,1024);assert.equal(initial.bundle?.artifacts[0].height,1536);assert.equal(initial.copyText,'');assert.equal(initial.bundle?.copyText,'');assert.equal(initial.bundle?.publication,'preview');assert.equal(initial.bundle?.zipUrl,undefined);
  const a=initial.posterApproval!;assert.equal(a.status,'pending');assert.equal(a.sha256.length,64);assert.ok(a.requiredCopy.length);assert.ok(a.referenceImages.length);
  const input={bundleId:a.bundleId,artifactId:a.artifactId,sha256:a.sha256,checks:{text:true,product:true,facts:true}};
  await assert.rejects(c.api(`/api/deliveries/${initial.id}/poster/approve`,'POST',{...input,checks:{text:true,product:false,facts:true}}),e=>e instanceof ApiError&&e.status===422);
  await assert.rejects(c.api(`/api/deliveries/${initial.id}/poster/approve`,'POST',{...input,sha256:'f'.repeat(64)}),e=>e instanceof ApiError&&e.status===409);
  assert.equal((await c.apiFetch(`/__mock/resources/${a.artifactId}?download=1`)).status,409);
  const approved=(await c.api<{delivery:ChannelDelivery}>(`/api/deliveries/${initial.id}/poster/approve`,'POST',input)).delivery;
  assert.equal(approved.posterApproval?.status,'approved');assert.equal(approved.posterApproval?.artifactId,a.artifactId);assert.equal(approved.bundle?.id,a.bundleId);assert.equal(approved.bundle?.expiresAt,initial.bundle?.expiresAt);
  assert.notEqual(approved.bundle?.artifacts[0].id,a.artifactId);assert.equal(approved.bundle?.publication,'released');
  assert.equal((await c.apiFetch(approved.bundle!.artifacts[0].downloadUrl!)).status,200);assert.equal((await c.apiFetch(`/__mock/resources/${a.artifactId}?download=1`)).status,409);
  const files=unzipSync(new Uint8Array(await(await c.apiFetch(approved.bundle!.zipUrl!)).arrayBuffer()));assert.equal(Object.keys(files).some(name=>/文案/.test(name)),false);
  const duplicate=(await c.api<{delivery:ChannelDelivery}>(`/api/deliveries/${initial.id}/poster/approve`,'POST',input)).delivery;assert.deepEqual(duplicate.bundle,approved.bundle);
});

test('a regenerated poster resets the checks and stale approval cannot approve the replacement',async()=>{
  const c=createWorkflowClient(createMockTransport('ok',{latencyMs:0}));const job=await run(c);const initial=job.channels.find(c=>c.platform==='poster')!.delivery!;
  const old=initial.posterApproval!;const request=await c.api<{job:BackgroundJob}>(`/api/deliveries/${initial.id}/rerender`,'POST',{idempotencyKey:crypto.randomUUID(),visualMode:'poster-image',regenerateVisual:true});const replaced=await done(c,request.job.id);
  const next=replaced.channels[0].delivery!.posterApproval!;assert.notEqual(next.bundleId,old.bundleId);assert.equal(next.status,'pending');assert.equal(next.checks,undefined);
  await assert.rejects(c.api(`/api/deliveries/${initial.id}/poster/approve`,'POST',{bundleId:old.bundleId,artifactId:old.artifactId,sha256:old.sha256,checks:{text:true,product:true,facts:true}}),e=>e instanceof ApiError&&e.status===409);
});

test('saved poster using a former alternate title remains readable without a title picker while other channels and expiry stay version-bound',async()=>{
  const c=createWorkflowClient(createMockTransport('ok',{latencyMs:0}));const job=await run(c);const poster=structuredClone(job.channels.find(channel=>channel.platform==='poster')!.delivery!);
  poster.bundle!.selectedTitleIndex=1;
  assert.equal(viewableDeliveryBundle(poster,0)?.id,poster.bundle!.id,'existing poster is viewable although parent now defaults to title zero');
  const wechat=structuredClone(job.channels.find(channel=>channel.platform==='wechat')!.delivery!);wechat.bundle!.selectedTitleIndex=1;
  assert.equal(viewableDeliveryBundle(wechat,0),undefined,'an article title change still requires a matching rendition');
  assert.equal(viewableDeliveryBundle(poster,0,true),undefined);assert.equal(viewableDeliveryBundle(poster,0,false,Date.parse(poster.bundle!.expiresAt)),undefined,'compatibility cannot revive expired images');
});

test('blocked independent video short-copy review produces no video but leaves released static output readable',async()=>{
  const c=createWorkflowClient(createMockTransport('ok',{latencyMs:0,videoReviewBlocked:true}));const job=await run(c);const d=job.channels.find(c=>c.platform==='wechat')!.delivery!;
  const video=await done(c,(await c.submitJob({kind:'video',deliveryId:d.id,idempotencyKey:crypto.randomUUID()})).id);
  assert.equal(video.status,'failed');assert.equal(video.error?.code,'VIDEO_REVIEW_BLOCKED');assert.equal(video.videoBundle,undefined);assert.equal(video.videoScriptReview?.status,'blocked');
  assert.ok(video.videoScript);assert.equal(video.calls.filter(c=>c.stage==='video_script').length,1);assert.equal((await c.apiFetch(d.bundle!.zipUrl!)).status,200);
});

test('old external design retries are hidden and old length-only videos create a new workflow instead of retrying',()=>{
  const baseline:BackgroundJob={id:'mock-job',idempotencyKey:'mock-test-key',kind:'outline',status:'completed',createdAt:'2030-01-01T00:00:00Z',updatedAt:'2030-01-01T00:00:00Z',expiresAt:'2030-01-08T00:00:00Z',input:{kind:'outline',brief:structuredClone(fixture.fourChannelOutline.brief) as Brief},model:{name:'pure-mock',baseUrl:'mock://local'},channels:[],calls:[],renderBundles:[]};
  const old:BackgroundJob={...baseline,kind:'render',status:'failed',input:{kind:'render',request:{runId:'r',revision:1,platform:'poster',selectedTitleIndex:0,templateId:'poster-paper',visualMode:'canva'}},error:{code:'CANVA_PROVIDER',message:'Canva initialize failed',stage:'canva_import',retryable:true,outcomeUnknown:false}};
  assert.equal(pausedExternalDesign(old),true);assert.equal(canRetryJob(old),false);assert.equal(/canva/i.test(visibleJobError(old)!),false);
  const video:BackgroundJob={...baseline,kind:'video',status:'failed',input:{kind:'video',deliveryId:'d'},channels:[],error:{code:'VIDEO_COPY_TOO_LONG',message:'old length check',stage:'storyboard',retryable:false,outcomeUnknown:false}};
  assert.equal(oldVideoNeedsNewJob(video),true);assert.equal(canRetryJob(video),false);
  assert.equal(videoNeedsRecovery(video),false);assert.equal(videoNeedsRecovery({...video,error:{...video.error!,code:'VIDEO_REVIEW_BLOCKED'}}),true);
});
