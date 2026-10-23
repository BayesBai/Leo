import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStateStore } from '../server/state-store.js';
import { JobQueue, type StoredJob } from '../server/job-store.js';
import type { JobInput } from '../shared/types.js';

const model={name:'unused-model',baseUrl:'https://mock.invalid/v1'};
const video=(id:string):JobInput=>({kind:'video',deliveryId:id});
const image:JobInput={kind:'render',request:{runId:'synthetic-run',revision:1,platform:'wechat',selectedTitleIndex:0,templateId:'wechat-editorial'}};
async function until(check:()=>boolean){for(let n=0;n<300;n++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('queue did not settle');}

test('video jobs use one of the shared two render slots and never monopolize static work',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'video-queue-')),store=new FileStateStore(directory);
  const finishes=new Map<string,()=>void>(),started:string[]=[];let videoActive=0,renderActive=0,peakVideo=0,peakRender=0;
  const queue=new JobQueue(store,async(record,ctx)=>{
    const isVideo=record.job.kind==='video';if(isVideo)videoActive++;renderActive++;peakVideo=Math.max(peakVideo,videoActive);peakRender=Math.max(peakRender,renderActive);started.push(record.job.id);
    try{await new Promise<void>((resolve,reject)=>{finishes.set(record.job.id,resolve);ctx.signal.addEventListener('abort',()=>reject(ctx.signal.reason),{once:true});});record.job.channels[0].status='completed';}
    finally{if(isVideo)videoActive--;renderActive--;}
  },()=> 'config');
  try{
    const a=queue.submit('video-queue-a',video('a'),model,['wechat']);
    const b=queue.submit('video-queue-b',video('b'),model,['wechat']);
    const c=queue.submit('video-queue-c',image,model,['wechat']);
    await until(()=>started.length===2);assert.ok(started.includes(a.id));assert.ok(started.includes(c.id));assert.equal(queue.get(b.id).status,'queued');
    queue.cancel(a.id);await until(()=>started.includes(b.id));assert.equal(queue.get(a.id).status,'cancelled');
    finishes.get(b.id)!();finishes.get(c.id)!();await until(()=>queue.get(b.id).status==='completed'&&queue.get(c.id).status==='completed');
    assert.equal(peakVideo,1);assert.equal(peakRender,2);
  }finally{queue.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test('a restarted local video resumes from its checkpoint despite unrelated model configuration changes',async()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'video-restart-')),store=new FileStateStore(directory);
  const before=new JobQueue(store,async()=>{},()=> 'model-before');before.close();
  try{
    const submitted=before.submit('video-restart-key',video('delivery'),model,['wechat'],{checkpoints:{videoSource:{fingerprint:'frozen-visual',expiresAt:new Date(Date.now()+100000).toISOString()}}});
    const record=store.get<StoredJob>('jobs',submitted.id)!;record.job.status='running';record.job.channels[0].status='running';record.job.channels[0].stage='video_encode';store.set('jobs',submitted.id,record);
    let attempts=0;
    const after=new JobQueue(store,async r=>{attempts++;assert.equal((r.checkpoints.videoSource as {fingerprint:string}).fingerprint,'frozen-visual');if(attempts===1)throw new Error('synthetic local encoder failure');r.job.channels[0].status='completed';},()=> 'model-after');
    after.start();await until(()=>after.get(submitted.id).status==='failed');assert.equal(after.get(submitted.id).error?.outcomeUnknown,false);assert.equal(after.get(submitted.id).calls.length,0);
    after.retry(submitted.id);await until(()=>after.get(submitted.id).status==='completed');assert.equal(attempts,2);assert.equal(after.get(submitted.id).calls.length,0);after.close();
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
