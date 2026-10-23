import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { BackgroundJob, Brief, Draft, ReviewReport } from '../shared/types.js';
import { createApp } from '../server/index.js';
import { createOutline, confirmOutline, confirmedOutline } from '../server/outlines.js';
import { listProducts, getAsset } from '../server/knowledge.js';
import { saveDelivery, deliveryDetail, deliveryRenderSource, updateDeliveryBundle, revokeDelivery } from '../server/deliveries.js';
import { renderRun, publishVideoBundle, getRunBundles } from '../server/render/index.js';
import { videoSource, executeVideoJob, videoMediaFingerprint } from '../server/video-workflow.js';
import { stateStore } from '../server/state-store.js';
import type { StoredJob } from '../server/job-store.js';
import { prepareVideoScript, videoScriptFingerprint } from '../server/video-script.js';

const json=(body:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function fixture() {
  const product=(await listProducts())[0];
  const brief:Brief={productId:product.id,audience:'学生',scene:'纯模拟视频',goal:'到店核对',buyingStage:'对比',platforms:['wechat'],instructions:'',mode:'demo',knowledgeSource:'local'};
  const planned=await createOutline(brief);confirmOutline(planned.id,planned.version);const outline=confirmedOutline(planned.id,planned.version);
  const draft:Draft={id:randomUUID(),platform:'wechat',titles:['带上清单到店看看'],intro:'先了解自己的使用需要。',blocks:[{id:'b1',heading:'先列清单',text:'列出自己的软件需要。',factIds:[]},{id:'b2',heading:'再看实机',text:'带上常用资料试试看。',factIds:[]}],cta:'欢迎到店交流。',tags:[],images:[{imageId:outline.evidence.images[0].id,afterBlock:0,caption:'纯模拟产品图',reason:'离线测试'}]};
  const review:ReviewReport={status:'passed',issues:[],checks:[],reviewedBy:'rules',factCount:0,citedFactCount:0,imageCount:1};
  const delivery=saveDelivery({runId:randomUUID(),outline,draft,review});
  const source=deliveryRenderSource(delivery.id),request={deliveryId:delivery.id,runId:delivery.runId,revision:1,platform:'wechat' as const,selectedTitleIndex:0,templateId:'wechat-editorial'};
  const bundle=await renderRun(source,request);updateDeliveryBundle(delivery.id,bundle);
  return {delivery,source,request,bundle,outline};
}

test('video HTTP cache restores separate delivery, supports Range and closes revoked MP4 access without model dispatch',async()=>{
  const f=await fixture(),input=videoSource(f.delivery.id);
  // These arbitrary bytes deliberately test asset HTTP transport only. Encoding
  // correctness is covered separately by ffprobe validation and the real render.
  const media={data:Buffer.from(Array.from({length:256},(_,i)=>i)),cover:(await getAsset(f.outline.evidence.images[0].url.split('/').pop()!)).data,html:'<!doctype html><p>纯模拟源码</p>',storyboard:{fixture:true},width:1080,height:1920,durationSeconds:20,fps:30,frameCount:600};
  const video=await publishVideoBundle(f.source,f.request,media,{expiresAt:f.bundle.expiresAt,fingerprint:videoMediaFingerprint(input.fingerprint,'script-v2'),assertCurrent:()=>{}},new AbortController().signal);
  updateDeliveryBundle(f.delivery.id,video);
  assert.equal(deliveryDetail(f.delivery.id).bundle?.id,f.bundle.id);
  assert.equal(deliveryDetail(f.delivery.id).videoBundle?.id,video.id);
  assert.equal(getRunBundles(f.source.id).length,1,'legacy run bundles exclude optional video');
  const app=await createApp({apiOnly:true}),server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    const key=`video-${randomUUID()}`;
    const response=await fetch(`${base}/api/deliveries/${f.delivery.id}/video`,json({idempotencyKey:key}));assert.equal(response.status,202);
    const submitted=(await response.json()).job as BackgroundJob;
    let completed=submitted;
    for(let i=0;i<100&&!['completed','failed'].includes(completed.status);i++){await new Promise(r=>setTimeout(r,10));completed=(await(await fetch(`${base}/api/jobs/${submitted.id}`)).json()).job;}
    assert.equal(completed.status,'completed');assert.deepEqual(completed.calls,[]);assert.deepEqual(completed.renderBundles,[]);assert.equal(completed.videoBundle?.id,video.id);
    const duplicate=await fetch(`${base}/api/deliveries/${f.delivery.id}/video`,json({idempotencyKey:key}));assert.equal((await duplicate.json()).job.id,submitted.id);
    const spoof=await fetch(`${base}/api/deliveries/${f.delivery.id}/video`,json({idempotencyKey:randomUUID(),deliveryId:randomUUID()}));assert.equal(spoof.status,400);
    const url=video.artifacts.find(a=>a.format==='mp4')!.previewUrl;
    for(const [range,start,end] of [['bytes=10-19',10,19],['bytes=-5',251,255],['bytes=250-',250,255]] as const){
      const rangeResponse=await fetch(base+url,{headers:{Range:range}});assert.equal(rangeResponse.status,206);assert.equal(rangeResponse.headers.get('content-range'),`bytes ${start}-${end}/256`);assert.deepEqual(Buffer.from(await rangeResponse.arrayBuffer()),media.data.subarray(start,end+1));
    }
    for(const range of ['bytes=999-','bytes=-0','bytes=2-1','bytes=0-2,5-8','bytes=-'])assert.equal((await fetch(base+url,{headers:{Range:range}})).status,416);
    const history=await(await fetch(`${base}/api/deliveries/${f.delivery.id}`)).json();assert.equal(history.delivery.bundle.id,f.bundle.id);assert.equal(history.delivery.videoBundle.id,video.id);
    assert.equal(history.delivery.bundle.expiresAt,f.bundle.expiresAt);assert.equal(history.delivery.videoBundle.expiresAt,f.bundle.expiresAt);
    const missingCover=video.artifacts.find(a=>a.role==='cover')!;
    await rm(stateStore().get<{file:string}>('renderAssets',missingCover.id)!.file);
    assert.equal(getRunBundles(f.source.id,true).some(b=>b.id===video.id),false,'broken sibling does not appear as a complete bundle');
    revokeDelivery(f.delivery.id);
    assert.equal((await fetch(base+url,{headers:{Range:'bytes=0-5'}})).status,409);
    assert.equal((await fetch(base+url+'?download=1')).status,409);
    assert.equal((await fetch(`${base}/api/deliveries/${f.delivery.id}/video`,json({idempotencyKey:randomUUID()}))).status,409);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

test('queued video binds static version and expired media never triggers new upstream requests',async()=>{
  const f=await fixture(),original=videoSource(f.delivery.id);
  const job:BackgroundJob={id:randomUUID(),idempotencyKey:randomUUID(),kind:'video',input:{kind:'video',deliveryId:f.delivery.id},status:'running',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),model:{name:'no-model','baseUrl':'https://invalid.test'},channels:[{platform:'wechat',stage:'storyboard',status:'running'}],calls:[],renderBundles:[]};
  const record:StoredJob={job,runId:f.source.id,inputHash:'fixture',configHash:'fixture',checkpoints:{videoSource:{fingerprint:original.fingerprint,expiresAt:original.expiresAt}}};
  const changed=await renderRun(f.source,{...f.request,templateId:'wechat-warm'});updateDeliveryBundle(f.delivery.id,changed);
  await assert.rejects(executeVideoJob(record,{signal:new AbortController().signal,save(){},call(){assert.fail('video must not call a model');},acknowledge(){}}),(e:unknown)=>!!e&&typeof e==='object'&&'status'in e&&e.status===409);
  const saved=stateStore().get<{file:string;expires:number}>('renderAssets',changed.artifacts[0].id)!;
  stateStore().set('renderAssets',changed.artifacts[0].id,{...saved,expires:Date.now()-1});
  stateStore().set('renderBundles',f.bundle.id,{...f.bundle,expiresAt:new Date(Date.now()-1).toISOString()});
  assert.throws(()=>videoSource(f.delivery.id),(e:unknown)=>!!e&&typeof e==='object'&&'status'in e&&e.status===410);
  assert.deepEqual(job.calls,[]);assert.equal(deliveryDetail(f.delivery.id).copyText.length>0,true,'history text remains readable');
});

test('new script-v2 video never treats a legacy base-fingerprint MP4 as independently reviewed media',async()=>{
 const f=await fixture(),source=videoSource(f.delivery.id),controller=new AbortController();
 const media={data:Buffer.from('legacy-unreviewed-video'),cover:(await getAsset(f.outline.evidence.images[0].url.split('/').pop()!)).data,html:'<p>legacy</p>',storyboard:{fixture:true},width:1080,height:1920,durationSeconds:20,fps:30,frameCount:600};
 const old=await publishVideoBundle(f.source,f.request,media,{expiresAt:f.bundle.expiresAt,fingerprint:source.fingerprint,assertCurrent:()=>{}},controller.signal);updateDeliveryBundle(f.delivery.id,old);
 const job:BackgroundJob={id:randomUUID(),idempotencyKey:randomUUID(),kind:'video',input:{kind:'video',deliveryId:f.delivery.id},status:'running',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),model:{name:'no-model',baseUrl:'https://invalid.test'},channels:[{platform:'wechat',stage:'storyboard',status:'running'}],calls:[],renderBundles:[]};
 const record:StoredJob={job,runId:f.source.id,inputHash:'fixture',configHash:'fixture',checkpoints:{videoMode:'script-v2',videoSource:{fingerprint:source.fingerprint,expiresAt:source.expiresAt}}};
 await assert.rejects(executeVideoJob(record,{signal:controller.signal,save(){if(job.videoScript)controller.abort();},call(){assert.fail('demo short script must not call a model');},acknowledge(){}},{configurationHash:()=> 'fixture'}));
 assert.ok(job.videoScript,'new route must prepare its own short copy instead of returning legacy MP4');assert.equal(job.videoBundle,undefined);assert.equal(deliveryDetail(f.delivery.id).videoBundle?.id,old.id,'legacy media remains readable');assert.notEqual(videoMediaFingerprint(source.fingerprint,'script-v2'),videoMediaFingerprint(source.fingerprint,undefined));
});

test('only explicit v2 retry can rebind a pure layout update and reuse approved short copy; changed text still conflicts',async()=>{
 const f=await fixture(),before=videoSource(f.delivery.id),textFingerprint=videoScriptFingerprint(f.source);
 const prepared=await prepareVideoScript(f.source,{signal:new AbortController().signal,onStage(){},onCheckpoint(){}});
 const job:BackgroundJob={id:randomUUID(),idempotencyKey:randomUUID(),kind:'video',input:{kind:'video',deliveryId:f.delivery.id},status:'running',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),model:{name:'no-model',baseUrl:'https://invalid.test'},channels:[{platform:'wechat',stage:'storyboard',status:'running'}],calls:[],renderBundles:[]};
 const record:StoredJob={job,runId:f.source.id,inputHash:'fixture',configHash:'fixture',checkpoints:{videoMode:'script-v2',videoTextFingerprint:textFingerprint,videoScript:prepared,videoSource:{fingerprint:before.fingerprint,expiresAt:before.expiresAt,retrySequence:0}}};
 const layout=await renderRun(f.source,{...f.request,templateId:'wechat-warm'});updateDeliveryBundle(f.delivery.id,layout);
 const context={signal:new AbortController().signal,save(){},call(){assert.fail('video must not buy another script');},acknowledge(){}};
 await assert.rejects(executeVideoJob(record,context,{configurationHash:()=> 'wrong-config'}),(error:any)=>error.code==='VIDEO_SOURCE_CHANGED'&&error.retryable===true);
 assert.equal((record.checkpoints.videoSource as {fingerprint:string}).fingerprint,before.fingerprint,'first queued execution cannot silently rebind');
 record.retrySequence=1;const controller=new AbortController();
 await assert.rejects(executeVideoJob(record,{...context,signal:controller.signal,save(){if((job.channels[0].progress?.completedFrames||0)>0)controller.abort();}},{configurationHash:()=> 'wrong-config'}),{name:'AbortError'});
 const rebound=record.checkpoints.videoSource as {fingerprint:string;expiresAt:string;retrySequence:number};
 assert.equal(rebound.fingerprint,videoSource(f.delivery.id).fingerprint);assert.equal(rebound.expiresAt,layout.expiresAt);assert.equal(rebound.retrySequence,1);assert.deepEqual(job.videoScript,prepared.script);assert.deepEqual(job.calls,[]);
 const saved=stateStore().get<{delivery:{draft:Draft}}>('deliveries',f.delivery.id)!;saved.delivery.draft.blocks[0].text+='新增文字。';stateStore().set('deliveries',f.delivery.id,saved);record.retrySequence=2;
 await assert.rejects(executeVideoJob(record,context,{configurationHash:()=> 'fixture'}),(error:any)=>error.code==='VIDEO_SOURCE_CHANGED'&&error.retryable===false);
 assert.deepEqual(job.calls,[]);
});
