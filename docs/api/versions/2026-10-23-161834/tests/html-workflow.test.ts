import { imageConfigurationHash } from '../server/image-binding.js';
import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';
import type { Brief, Draft, Platform, RenderBundle, RenderRequest, ReviewReport, RunResult } from '../shared/types.js';
import { listProducts } from '../server/knowledge.js';
import { createOutline, confirmOutline, confirmedOutline } from '../server/outlines.js';
import { deliveryRenderSource, saveDelivery } from '../server/deliveries.js';
import { stateStore } from '../server/state-store.js';
import { renderVisualDelivery } from '../server/visual-workflow.js';
import { getRenderAsset } from '../server/render/index.js';
import { closeRenderRuntime } from '../server/render/browser-pool.js';
import type { JobContext, StoredJob } from '../server/job-store.js';
import { HTML_SKILL_HASHES } from '../server/design/html-rules.js';

const originalFetch=globalThis.fetch;
const originalKey=process.env.IMAGE_API_KEY;
afterEach(()=>{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.IMAGE_API_KEY;else process.env.IMAGE_API_KEY=originalKey;});
after(()=>closeRenderRuntime());
const platforms=['xiaohongshu','wechat'] as const;
async function fixture(blocked=false){
 const product=(await listProducts())[0];
 const brief:Brief={productId:product.id,audience:'大学生',scene:'纯模拟开学准备',goal:'到店逐项核对',buyingStage:'比较',platforms:[...platforms],instructions:'',mode:'demo',knowledgeSource:'local'};
 const planned=await createOutline(brief);confirmOutline(planned.id,planned.version);const outline=confirmedOutline(planned.id,planned.version);
 // Obtain only synthetic local evidence in demo; visual dispatch below deliberately
 // exercises live production routing with an already-approved immutable snapshot.
 outline.brief={...outline.brief,mode:'live'};
 const review:ReviewReport={status:blocked?'blocked':'passed',issues:blocked?[{id:'mock-block',severity:'error',category:'fact',message:'纯模拟阻断',suggestion:'核实后再交付'}]:[],checks:[],reviewedBy:'rules+model',factCount:0,citedFactCount:0,imageCount:1};
 const runId=randomUUID(),sources=new Map<Platform,{source:RunResult;request:RenderRequest}>();
 for(const platform of platforms){
  const draft:Draft={id:randomUUID(),platform,titles:['带着需求，逐项体验'],intro:'把日常需求带到店里。',blocks:[{id:'first',heading:'先核对软件',text:'带上常用软件清单，核对适配情况。以实际销售版本为准。',factIds:[]},{id:'second',heading:'再看携带体验',text:'带上背包，按个人习惯体验。',factIds:[]}],cta:'带上清单，到店交流。',tags:[],images:[{imageId:outline.evidence.images[0].id,afterBlock:0,caption:'纯模拟同型号原图',reason:'真实素材独立叠加'}]};
  const delivery=saveDelivery({runId,outline,draft,review});
  sources.set(platform,{source:deliveryRenderSource(delivery.id),request:{runId,revision:1,deliveryId:delivery.id,platform,templateId:platform==='wechat'?'wechat-editorial':'xhs-cream',selectedTitleIndex:0,visualMode:'html'}});
 }
 const now=new Date().toISOString();
 const record:StoredJob={inputHash:'mock-html-input',configHash:'mock-config',imageConfigHash:imageConfigurationHash(),rendererMode:'html',snapshot:outline,runId,checkpoints:{},pendingPaid:{},job:{id:randomUUID(),idempotencyKey:randomUUID(),kind:'generate',status:'running',createdAt:now,updatedAt:now,expiresAt:new Date(Date.now()+7*86400_000).toISOString(),input:{kind:'generate',outlineId:outline.id,version:outline.version},model:{name:'gpt-6.1-sol',baseUrl:'https://relay.nccnxta.cn/v1'},channels:platforms.map(platform=>({platform,status:'running',stage:'render'})),calls:[],renderBundles:[]}};
 const context=(target:StoredJob,signal?:AbortSignal):JobContext=>({signal:signal||new AbortController().signal,save(){stateStore().set('jobs',target.job.id,target);},acknowledge(){},call(call){const index=target.job.calls.findIndex(item=>item.id===call.id);if(index<0)target.job.calls.push(structuredClone(call));else target.job.calls[index]=structuredClone(call);}});
 return {record,sources,render:(platform:typeof platforms[number],target=record,signal?:AbortSignal)=>{const {source,request}=sources.get(platform)!;return renderVisualDelivery(source,request,target,context(target,signal));}};
}
async function archive(bundle:RenderBundle){assert.ok(bundle.zipUrl);const handle=bundle.zipUrl.split('/').pop()!.split('?')[0];return unzipSync((await getRenderAsset(handle,true)).data);}
function sourceAssertions(files:Record<string,Uint8Array>,platform:typeof platforms[number]){
 assert.ok(files['source/design.json']);assert.ok(Object.keys(files).some(name=>/^配图\/产品-1\./.test(name)));
 for(const name of ['premium-animations','ui-animation','gsap-skills','html-animation'])assert.ok(files[`source/licenses/${name}-LICENSE.txt`]);
 const htmlNames=Object.keys(files).filter(name=>/^source\/.*\.html$/.test(name));assert.ok(htmlNames.length>= (platform==='wechat'?2:3));
 for(const name of htmlNames){const html=strFromU8(files[name]);assert.doesNotMatch(html,/审核中|仅供预览|发布前复核|检查通过|本地资料/);assert.match(html,/data:image\/png;base64/);assert.doesNotMatch(html,/api\.canva|sk-test/);}
 const design=JSON.parse(strFromU8(files['source/design.json']));const composition=design.article||design.composition;
 assert.equal(composition.version,'virgo-html-1.0.0');assert.deepEqual(composition.skillHashes,HTML_SKILL_HASHES);
 assert.match(strFromU8(files[platform==='wechat'?'source/article.html':'source/page-02.html']),/以实际销售版本为准/);
}

test('HTML fallback with missing image key publishes both channels without Canva/text/image calls and retains source/licenses',async()=>{
 delete process.env.IMAGE_API_KEY;
 let calls=0;globalThis.fetch=async()=>{calls++;assert.fail('HTML fallback must not access external services');};
 const f=await fixture();const bundles=await Promise.all(platforms.map(platform=>f.render(platform)));
 assert.equal(calls,0);assert.equal(f.record.job.calls.length,0);
 for(const [index,bundle]of bundles.entries()){assert.equal(bundle.publication,'released');assert.equal(bundle.rendererVersion,4);assert.ok(bundle.copyText);assert.ok(bundle.warnings.some(warning=>warning.includes('未配置生图 Key')));sourceAssertions(await archive(bundle),platforms[index]);}
});

test('concurrent HTML channels share one paid background, retain independent product/text layers and cached expiry',async()=>{
 process.env.IMAGE_API_KEY='sk-test-html-image-workflow';
 const generated=await sharp({create:{width:120,height:180,channels:3,background:'#e4d7c1'}}).png().toBuffer();
 const expectedHash=createHash('sha256').update(generated).digest('hex');let calls=0;
 globalThis.fetch=async(input,init)=>{assert.equal(String(input),'https://ark.cn-beijing.volces.com/api/v3/images/generations');calls++;const body=JSON.parse(String(init?.body));assert.equal(body.model,'doubao-seedream-5-0-pro-260628');assert.deepEqual(Object.keys(body).sort(),['model','output_format','prompt','response_format','size','watermark']);assert.equal(body.response_format,'b64_json');assert.equal(body.watermark,false);assert.equal(body.output_format,'png');assert.ok(['1024x1536','1536x1024'].includes(body.size));assert.equal(new Headers(init?.headers).get('authorization'),'Bearer sk-test-html-image-workflow');assert.doesNotMatch(body.prompt,/带着需求，逐项体验/);return new Response(JSON.stringify({data:[{b64_json:generated.toString('base64')}],usage:{total_tokens:11}}),{headers:{'content-type':'application/json','x-request-id':'mock-html-request'}});};
 const f=await fixture();const [xhs,wechat]=await Promise.all(platforms.map(platform=>f.render(platform)));
 assert.equal(calls,1);assert.equal(f.record.job.calls.filter(call=>call.stage==='image'&&call.outcome==='succeeded').length,1);
 for(const bundle of [xhs,wechat]){assert.equal(bundle.publication,'released');assert.equal(bundle.creativeAssets?.length,1);assert.equal(bundle.creativeAssets[0].sha256,expectedHash);const files=await archive(bundle);sourceAssertions(files,bundle.platform as typeof platforms[number]);assert.deepEqual(Buffer.from(files['source/background.png']),generated);assert.match(strFromU8(files['来源与审核.md']),new RegExp(expectedHash));const html=strFromU8(files[bundle.platform==='wechat'?'source/cover.html':'source/page-01.html']);assert.match(html,/class="environment"/);assert.match(html,/class="product"/);assert.match(html,/<h1/);}
 const now=Date.now;try{Date.now=()=>now()+5000;const repeated=await f.render('xiaohongshu');assert.equal(calls,1);assert.equal(repeated.id,xhs.id);assert.equal(repeated.expiresAt,xhs.expiresAt);}finally{Date.now=now;}
});

test('blocked HTML delivery does not buy a background and direct downloads remain denied',async()=>{
 process.env.IMAGE_API_KEY='sk-test-html-image-workflow';let calls=0;globalThis.fetch=async()=>{calls++;assert.fail('blocked review must not dispatch image or Canva');};
 const f=await fixture(true),bundle=await f.render('wechat');assert.equal(calls,0);assert.equal(bundle.publication,'blocked');assert.equal(bundle.copyText,'');assert.equal(bundle.zipUrl,undefined);
 for(const artifact of bundle.artifacts){assert.equal(artifact.downloadUrl,undefined);await assert.rejects(getRenderAsset(artifact.id,true),(error:any)=>error.status===409);}
});

test('configuring an image key after HTML fallback produces a new background composition without renewing the old expiry',async()=>{
 delete process.env.IMAGE_API_KEY;
 globalThis.fetch=async()=>assert.fail('fallback must not dispatch');
 const f=await fixture(),plain=await f.render('wechat');
 const plainCover=await getRenderAsset(plain.artifacts.find(a=>a.role==='cover')!.id,true);
 process.env.IMAGE_API_KEY='sk-test-html-image-workflow';
 const generated=await sharp({create:{width:120,height:180,channels:3,background:'#dbb99c'}}).png().toBuffer();let calls=0;
 globalThis.fetch=async(input)=>{assert.equal(String(input),'https://ark.cn-beijing.volces.com/api/v3/images/generations');calls++;return new Response(JSON.stringify({data:[{b64_json:generated.toString('base64')}]}),{headers:{'content-type':'application/json'}});};
 const configured=separateRecord(f.record);configured.imageConfigHash=imageConfigurationHash();const upgraded=await f.render('wechat',configured);
 assert.equal(calls,1);assert.notEqual(upgraded.id,plain.id);assert.equal(upgraded.expiresAt,plain.expiresAt);
 assert.equal(upgraded.creativeAssets?.[0].sha256,createHash('sha256').update(generated).digest('hex'));
 const upgradedCover=await getRenderAsset(upgraded.artifacts.find(a=>a.role==='cover')!.id,true);assert.equal(upgradedCover.data.equals(plainCover.data),false);
 const files=await archive(upgraded);assert.deepEqual(Buffer.from(files['source/background.png']),generated);
});

test('separate explicit regenerations use their new background bytes instead of a previous HTML cache entry',async()=>{
 process.env.IMAGE_API_KEY='sk-test-html-image-workflow';let calls=0;
 const generated=await Promise.all(['#f0c1a1','#a8d9ce'].map(background=>sharp({create:{width:120,height:180,channels:3,background}}).png().toBuffer()));
 globalThis.fetch=async(input)=>{assert.equal(String(input),'https://ark.cn-beijing.volces.com/api/v3/images/generations');const bytes=generated[calls++];assert.ok(bytes,'exactly two explicit requests are expected');return new Response(JSON.stringify({data:[{b64_json:bytes.toString('base64')}]}),{headers:{'content-type':'application/json'}});};
 const f=await fixture();f.sources.get('wechat')!.request.regenerateVisual=true;
 const first=await f.render('wechat');
 // A new user-triggered render job receives fresh visual checkpoints, while the
 // immutable delivery, approved text and submitted regenerate flag stay equal.
 f.record.job.id=randomUUID();f.record.job.calls=[];f.record.checkpoints={};
 const second=await f.render('wechat');
 assert.equal(calls,2);assert.notEqual(second.id,first.id);assert.equal(second.expiresAt,first.expiresAt);
 assert.notEqual(second.creativeAssets?.[0].sha256,first.creativeAssets?.[0].sha256);
 const firstCover=await getRenderAsset(first.artifacts.find(a=>a.role==='cover')!.id,true),secondCover=await getRenderAsset(second.artifacts.find(a=>a.role==='cover')!.id,true);
 assert.equal(firstCover.data.equals(secondCover.data),false);
 for(const [index,bundle]of [first,second].entries()){const files=await archive(bundle);assert.deepEqual(Buffer.from(files['source/background.png']),generated[index]);assert.equal(bundle.creativeAssets?.[0].sha256,createHash('sha256').update(generated[index]).digest('hex'));}
});

function separateRecord(record:StoredJob){const next=structuredClone(record);next.job.id=randomUUID();next.job.calls=[];next.checkpoints={};return next;}

test('independent concurrent channel jobs share the durable main visual and buy one background',async()=>{
 process.env.IMAGE_API_KEY='sk-test-html-image-workflow';let calls=0;
 const generated=await sharp({create:{width:120,height:180,channels:3,background:'#cadace'}}).png().toBuffer();
 globalThis.fetch=async(input)=>{assert.equal(String(input),'https://ark.cn-beijing.volces.com/api/v3/images/generations');calls++;await new Promise(resolve=>setTimeout(resolve,30));return new Response(JSON.stringify({data:[{b64_json:generated.toString('base64')}]}),{headers:{'content-type':'application/json'}});};
 const f=await fixture(),other=separateRecord(f.record);
 const [wechat,xhs]=await Promise.all([f.render('wechat'),f.render('xiaohongshu',other)]);
 assert.equal(calls,1);assert.equal(wechat.creativeAssets?.[0].id,xhs.creativeAssets?.[0].id);assert.equal(wechat.expiresAt,xhs.expiresAt);
 assert.equal(f.record.job.calls.length+other.job.calls.length,1);
 assert.equal(stateStore().entries('creativeRequests').filter(([,value])=>(value as {jobId:string}).jobId===f.record.job.id).length,0,'asset and marker removal commit together');
});

test('unknown background outcomes persist across channel jobs and only an explicit owner retry can redispatch',async()=>{
 process.env.IMAGE_API_KEY='sk-test-html-image-workflow';let calls=0,started!:()=>void,fail!:()=>void;
 const dispatched=new Promise<void>(resolve=>started=resolve),failureGate=new Promise<void>(resolve=>fail=resolve);
 globalThis.fetch=async(input)=>{assert.equal(String(input),'https://ark.cn-beijing.volces.com/api/v3/images/generations');calls++;started();await failureGate;throw new Error('synthetic lost response sk-test-html-image-workflow');};
 const f=await fixture(),other=separateRecord(f.record);
 const first=f.render('wechat');await dispatched;const second=f.render('xiaohongshu',other);fail();
 const results=await Promise.allSettled([first,second]);
 assert.equal(calls,1);for(const result of results){assert.equal(result.status,'rejected');assert.equal((result as PromiseRejectedResult).reason.outcomeUnknown,true);}
 const saved=stateStore().entries<{jobId:string;state:string;expiresAt:number}>('creativeRequests').find(([,value])=>value.jobId===f.record.job.id)![1];
 assert.equal(saved.state,'failed');assert.ok(saved.expiresAt>Date.now()+6*86400_000);assert.doesNotMatch(JSON.stringify(saved),/sk-test-html-image-workflow/);
 await assert.rejects(f.render('xiaohongshu',separateRecord(f.record)),(error:any)=>error.outcomeUnknown===true);assert.equal(calls,1,'a later independent job also pauses');
 const generated=await sharp({create:{width:120,height:180,channels:3,background:'#e1dbc9'}}).png().toBuffer();
 globalThis.fetch=async(input)=>{assert.equal(String(input),'https://ark.cn-beijing.volces.com/api/v3/images/generations');calls++;return new Response(JSON.stringify({data:[{b64_json:generated.toString('base64')}]}),{headers:{'content-type':'application/json'}});};
 f.record.retrySequence=1;const retried=await f.render('wechat');assert.equal(calls,2);assert.equal(retried.publication,'released');
});

test('cancelling a material-slot waiter does not abort the job that already dispatched its image',async()=>{
 process.env.IMAGE_API_KEY='sk-test-html-image-workflow';let calls=0,started!:()=>void,respond!:()=>void;
 const dispatched=new Promise<void>(resolve=>started=resolve),responseGate=new Promise<void>(resolve=>respond=resolve);
 const generated=await sharp({create:{width:120,height:180,channels:3,background:'#d1dacc'}}).png().toBuffer();
 globalThis.fetch=async(input)=>{assert.equal(String(input),'https://ark.cn-beijing.volces.com/api/v3/images/generations');calls++;started();await responseGate;return new Response(JSON.stringify({data:[{b64_json:generated.toString('base64')}]}),{headers:{'content-type':'application/json'}});};
 const f=await fixture(),other=separateRecord(f.record),controller=new AbortController();
 const first=f.render('wechat');await dispatched;
 const cancelled=f.render('xiaohongshu',other,controller.signal);const rejected=assert.rejects(cancelled);
 for(let i=0;i<100&&other.job.channels.find(channel=>channel.platform==='xiaohongshu')?.stage!=='image';i++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(other.job.channels.find(channel=>channel.platform==='xiaohongshu')?.stage,'image');controller.abort();await rejected;
 assert.equal(calls,1);respond();const completed=await first;assert.equal(completed.publication,'released');assert.equal(calls,1);
});
