import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RunResult } from '../shared/types.js';
import type { VideoScript } from '../shared/video.js';
import { prepareVideoScript, reviewVideoScriptRules, videoScriptFingerprint, type VideoScriptCheckpoint } from '../server/video-script.js';
import { withModelExecution, type ModelConfigSnapshot } from '../server/model.js';
import { planVideoTimings, videoSceneText } from '../server/render/video.js';
import { JobQueue, type StoredJob } from '../server/job-store.js';
import { FileStateStore } from '../server/state-store.js';

const source: RunResult = {
  id:'synthetic-script-source',createdAt:new Date().toISOString(),revision:1,brief:{productId:'synthetic',audience:'学生',scene:'开学',goal:'到店',buyingStage:'比较',platforms:['xiaohongshu'],instructions:'',knowledgeSource:'local',mode:'live'},
  product:{id:'synthetic',name:'纯模拟机型',system:'模拟系统',category:'笔记本',description:'纯模拟',imageCount:1},
  evidence:{product:{id:'synthetic',name:'纯模拟机型',system:'模拟系统',category:'笔记本',description:'纯模拟',imageCount:1},facts:[{id:'f1',statement:'标准版约798g。',quote:'纯模拟来源记载：标准版约798g。',sourceTitle:'纯模拟来源',retrievedAt:new Date().toISOString(),qualifiers:['仅标准版；以实际销售版本为准。','不得跨系统、年份、屏幕或处理器版本套用。'],status:'supported',sourceMode:'local'}],images:[],sources:[],retrievedAt:new Date().toISOString(),sourceMode:'local',warnings:[]},
  drafts:[{id:'source-draft',platform:'xiaohongshu',titles:['开学选电脑先看需求'],intro:'这是独立视频的纯模拟测试。',blocks:[{id:'b1',heading:'试试携带',text:'标准版约798g，以实际销售版本为准。',factIds:['f1']}],cta:'带上清单到店核对。',tags:[],images:[]}],review:{status:'passed',issues:[],checks:[],factCount:1,citedFactCount:1,imageCount:1,reviewedBy:'rules+model'},strategies:[],trace:[],notice:'纯模拟',outline:{id:'outline-fixture',version:1},
};
const config:ModelConfigSnapshot={configured:true,apiKey:'test-video-script-only',baseUrl:'https://invalid.video.test/v1',name:'gpt-6.1-sol',timeoutMs:5000};
function payload() {
 return {title:'随身携带，亲手体验',cta:'带上清单，到店核对。',scenes:[{id:'s1',heading:'试试携带',text:'标准版约798g。',kind:'fact' as const,factIds:['f1'],conditions:source.evidence.facts[0].qualifiers.map((text,qualifierIndex)=>({factId:'f1',qualifierIndex,text,mode:(qualifierIndex?'scope':'display') as 'scope'|'display'}))}]};
}
function script():VideoScript{return {...payload(),version:'video-script-v2',sourceFingerprint:videoScriptFingerprint(source)};}
const okay={summary:'事实、适用条件与引用一致。',issues:[]};
function harness(outputs:unknown[]) {
 const original=globalThis.fetch;const requests:Record<string,unknown>[]=[],calls:Array<{stage:string;outcome:string}>=[];
 globalThis.fetch=async(_input,init)=>{
  requests.push(JSON.parse(String(init?.body)));
  assert.ok(outputs.length,'unexpected extra paid request');
  const next=outputs.shift();
  if(next instanceof Response)return next;
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(next)},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});
 };
 let checkpoint:VideoScriptCheckpoint|undefined;const acknowledgements:string[]=[];
 const options={signal:new AbortController().signal,onStage(){},onCheckpoint(value:VideoScriptCheckpoint,completed?:string){checkpoint=structuredClone(value);if(completed)acknowledgements.push(completed);}};
 return {requests,calls,acknowledgements,options,get checkpoint(){return checkpoint;},run(checkpointValue?:VideoScriptCheckpoint,beforeDispatch?:()=>void){return withModelExecution({config,jobId:'synthetic-video',onCall:call=>calls.push({stage:call.stage,outcome:call.outcome}),beforeDispatch},()=>prepareVideoScript(source,{...options,checkpoint:checkpointValue}));},restore(){globalThis.fetch=original;}};
}

test('live video prepares and independently reviews short copy with two paid calls and keeps original article untouched',async()=>{
 const original=structuredClone(source);const h=harness([payload(),okay]);
 try{const result=await h.run();assert.equal(result.stage,'ready');assert.equal(result.review?.status,'passed');assert.equal(result.review?.reviewedBy,'rules+model');assert.equal(h.requests.length,2);assert.deepEqual(h.acknowledgements,['video_script','video_review']);assert.deepEqual(h.calls.filter(c=>c.outcome==='dispatched').map(c=>c.stage),['video_script','video_review']);assert.deepEqual(source,original);assert.ok(videoSceneText(result.script!.scenes[0]).includes(source.evidence.facts[0].qualifiers[0]));assert.ok(!videoSceneText(result.script!.scenes[0]).includes(source.evidence.facts[0].qualifiers[1]));}finally{h.restore();}
});

test('mixed or unrecognized qualifier cannot be hidden as scope and receives at most one repair/recheck',async()=>{
 const bad=payload();bad.scenes[0].conditions[0].mode='scope';const h=harness([bad,okay,payload(),okay]);
 try{const result=await h.run();assert.equal(result.review?.status,'passed');assert.equal(result.repairAttempted,true);assert.equal(result.repaired,true);assert.equal(h.requests.length,4);assert.deepEqual(h.acknowledgements,['video_script','video_review','video_repair','video_recheck']);}finally{h.restore();}
});

test('review failure is retried without regenerating a completed script and approved local retries need no current model permission',async()=>{
 const h=harness([payload(),new Response('upstream timeout',{status:524})]);
 try{
  await assert.rejects(h.run(),(e:any)=>e.outcomeUnknown===true);
  assert.ok(h.checkpoint?.script);assert.equal(h.checkpoint?.review,undefined);assert.deepEqual(h.acknowledgements,['video_script']);
  const saved=h.checkpoint!;h.restore();
  const continuation=harness([okay]);
  try{const result=await continuation.run(saved);assert.equal(continuation.requests.length,1);assert.deepEqual(continuation.acknowledgements,['video_review']);assert.deepEqual(result.script,saved.script);const local=await continuation.run(result,()=>{assert.fail('approved checkpoint must never dispatch a model');});assert.equal(local.review?.status,'passed');assert.equal(continuation.requests.length,1);}finally{continuation.restore();}
 }finally{h.restore();}
});

test('a second blocked review stops without a second repair, retaining separate diagnostics',async()=>{
 const blocked={summary:'缺少证据。',issues:[{severity:'error',message:'模拟审核阻断',suggestion:'删除该断言。',sceneId:'s1'}]};const h=harness([payload(),blocked,payload(),blocked]);
 try{await assert.rejects(h.run(),(e:any)=>e.code==='VIDEO_REVIEW_BLOCKED');assert.equal(h.requests.length,4);assert.equal(h.checkpoint?.review?.status,'blocked');await assert.rejects(h.run(h.checkpoint),(e:any)=>e.code==='VIDEO_REVIEW_BLOCKED');assert.equal(h.requests.length,4);}finally{h.restore();}
});

test('unknown HTTP 200 business result and before-dispatch config conflict never silently start another stage',async()=>{
 const h=harness([new Response(JSON.stringify({error:{message:'unknown result',code:'upstream_unknown'}}),{headers:{'Content-Type':'application/json'}})]);
 try{await assert.rejects(h.run(),(e:any)=>e.outcomeUnknown===true);assert.equal(h.requests.length,1);assert.equal(h.checkpoint?.script,undefined);assert.deepEqual(h.acknowledgements,[]);}finally{h.restore();}
 const changed=harness([]);
 try{await assert.rejects(changed.run(undefined,()=>{throw Object.assign(new Error('configuration changed'),{status:409});}),(e:any)=>e.status===409);assert.equal(changed.requests.length,0);assert.deepEqual(changed.calls,[]);}finally{changed.restore();}
});

test('script rules preserve exact display conditions, reject fabricated fact links, and use dynamic twenty-second budgets',()=>{
 assert.equal(reviewVideoScriptRules(script(),source).status,'passed');
 const altered=script();altered.scenes[0].conditions[0].text='以实际为准。';assert.equal(reviewVideoScriptRules(altered,source).status,'blocked');
 const missing=script();missing.scenes[0].conditions=[];assert.equal(reviewVideoScriptRules(missing,source).status,'blocked');
 const unbound=script();unbound.scenes[0].factIds=['foreign'];assert.equal(reviewVideoScriptRules(unbound,source).status,'blocked');
 const timings=planVideoTimings('一'.repeat(29),'请'.repeat(28),[{heading:'核对需求',text:'带上常用资料，到店核对。'}]);assert.ok(timings[0].end>4);assert.equal(timings.at(-1)!.end,20);assert.ok(timings.every(t=>Number.isInteger(Math.round(t.start*30))&&t.end>t.start));
 const changed=structuredClone(source);changed.evidence.facts[0].retrievedAt=new Date(0).toISOString();changed.product.coverUrl='/api/assets/new-visual-handle';changed.drafts[0].images=[{imageId:'new-visual-image',afterBlock:0,caption:'新的版式',reason:'纯视觉变化'}];assert.equal(videoScriptFingerprint(changed),videoScriptFingerprint(source));changed.evidence.facts[0].qualifiers.push('新增真实条件。');assert.notEqual(videoScriptFingerprint(changed),videoScriptFingerprint(source));
});

test('durable video restart pauses unknown review, and explicit retry buys review only while retaining successful script',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'video-script-jobs-')),store=new FileStateStore(directory);
 const stopped=new JobQueue(store,async()=>assert.fail('seeding must not execute'),()=> 'config-v1');stopped.close();
 const h=harness([okay]);let executions=0;
 const job=stopped.submit('synthetic-video-restart',{kind:'video',deliveryId:'fixture'}, {name:config.name,baseUrl:config.baseUrl},['xiaohongshu'],{checkpoints:{videoMode:'script-v2'}});
 const record=store.get<StoredJob>('jobs',job.id)!;
 const queuedAt=new Date().toISOString();
 record.job.status='running';record.job.channels[0].status='running';record.job.channels[0].stage='video_review';
 record.job.calls=[{id:'saved-script-http',stage:'video_script',platform:'xiaohongshu',attempt:1,queuedAt,outcome:'succeeded'},{id:'unknown-review-http',stage:'video_review',platform:'xiaohongshu',attempt:1,queuedAt,outcome:'dispatched'}];
 record.pendingPaid={'unknown-review-http':{stage:'video_review',platform:'xiaohongshu'}};
 record.checkpoints.videoScript={sourceFingerprint:videoScriptFingerprint(source),stage:'video_review',script:script()} satisfies VideoScriptCheckpoint;
 store.set('jobs',job.id,record);
 const recovered=new JobQueue(store,async(r,ctx)=>{
  executions++;await withModelExecution({config,jobId:r.job.id,onCall:ctx.call},()=>prepareVideoScript(source,{signal:ctx.signal,checkpoint:r.checkpoints.videoScript as VideoScriptCheckpoint,onStage(stage){r.job.channels[0].stage=stage;ctx.save();},onCheckpoint(cp,completed){r.checkpoints.videoScript=cp;if(completed)ctx.acknowledge(completed,'xiaohongshu');ctx.save();}}));
  r.job.channels[0].status='completed';
 },()=> 'config-v1');
 try{
  recovered.start();await new Promise(resolve=>setTimeout(resolve,15));assert.equal(executions,0);assert.equal(recovered.get(job.id).status,'interrupted');assert.equal(h.requests.length,0);
  recovered.retry(job.id);
  for(let i=0;i<100&&recovered.get(job.id).status!=='completed';i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(recovered.get(job.id).status,'completed');assert.equal(h.requests.length,1);assert.equal(executions,1);assert.deepEqual(store.get<StoredJob>('jobs',job.id)!.pendingPaid,{});
  assert.deepEqual((store.get<StoredJob>('jobs',job.id)!.checkpoints.videoScript as VideoScriptCheckpoint).script,script());
 }finally{recovered.close();stopped.close();store.close();rmSync(directory,{recursive:true,force:true});h.restore();}
});

test('damaged saved short copy fails closed instead of buying a replacement',async()=>{
 const h=harness([]);
 try{await assert.rejects(h.run({sourceFingerprint:videoScriptFingerprint(source),stage:'video_review',script:{...script(),scenes:[]} }),(e:any)=>e.status===503&&e.code==='VIDEO_SCRIPT_CORRUPT');assert.equal(h.requests.length,0);}finally{h.restore();}
});
