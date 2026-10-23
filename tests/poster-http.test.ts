import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID,createHash } from 'node:crypto';
import sharp from 'sharp';
import { unzipSync,strFromU8 } from 'fflate';
import type { BackgroundJob,Brief,Draft,ReviewReport } from '../shared/types.js';
import { createApp } from '../server/index.js';
import { listProducts } from '../server/knowledge.js';
import { createOutline,confirmOutline,confirmedOutline } from '../server/outlines.js';
import { saveDelivery,deliveryRenderSource } from '../server/deliveries.js';
import { publishRunBundles } from '../server/render/index.js';
const post=(body:unknown)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
async function wait(base:string,id:string){for(let i=0;i<200;i++){const job=(await(await fetch(`${base}/api/jobs/${id}`)).json()).job as BackgroundJob;if(['completed','failed'].includes(job.status))return job;await new Promise(r=>setTimeout(r,10));}throw new Error('mock poster task did not settle');}

test('poster HTTP submits once, keeps manual preview gated through full-run publication, and releases only checked bytes',async()=>{
 const originalFetch=globalThis.fetch,oldKey=process.env.IMAGE_API_KEY;
 const product=(await listProducts())[0];const brief:Brief={productId:product.id,audience:'学生',scene:'纯模拟海报HTTP',goal:'到店核对',buyingStage:'比较',platforms:['poster'],instructions:'',mode:'demo',knowledgeSource:'local'};
 const planned=await createOutline(brief);confirmOutline(planned.id,planned.version);const outline=confirmedOutline(planned.id,planned.version);outline.brief={...outline.brief,mode:'live'};
 const fact=outline.evidence.facts[0];const draft:Draft={id:randomUUID(),platform:'poster',titles:['带上需要，现场核对'],intro:'先了解自己的日常任务。',blocks:[{id:'main',heading:'逐项核对',text:fact.statement+' '+fact.qualifiers.join('；'),factIds:[fact.id]}],cta:'带上清单到店交流。',tags:[],images:[{imageId:outline.evidence.images[0].id,afterBlock:0,caption:'仅供人比对',reason:'同型号'}]};
 const review:ReviewReport={status:'passed',issues:[],checks:[],reviewedBy:'rules+model',factCount:1,citedFactCount:1,imageCount:1};
 const delivery=saveDelivery({runId:randomUUID(),outline,draft,review});
 const app=await createApp({apiOnly:true}),server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const bytes=await sharp({create:{width:96,height:144,channels:3,background:'#b1c4ad'}}).png().toBuffer();let imageCalls=0;
 try{
  process.env.IMAGE_API_KEY='sk-test-poster-http';globalThis.fetch=async(input,init)=>{if(String(input).startsWith(base))return originalFetch(input,init);assert.equal(String(input),'https://ark.cn-beijing.volces.com/api/v3/images/generations');imageCalls++;const body=JSON.parse(String(init?.body));assert.deepEqual(Object.keys(body).sort(),['model','output_format','prompt','response_format','size','watermark']);assert.equal(body.model,'doubao-seedream-5-0-pro-260628');assert.equal(body.size,'1024x1536');assert.equal(body.response_format,'b64_json');assert.equal(body.watermark,false);assert.equal(body.output_format,'png');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer sk-test-poster-http');return Response.json({data:[{b64_json:bytes.toString('base64')}]});};
  const key=randomUUID(),url=`${base}/api/deliveries/${delivery.id}/rerender`,request={idempotencyKey:key,visualMode:'poster-image'};
  const submitted=await fetch(url,post(request));assert.equal(submitted.status,202);const job=(await submitted.json()).job as BackgroundJob;
  const duplicate=await fetch(url,post(request));assert.equal((await duplicate.json()).job.id,job.id);
  const completed=await wait(base,job.id);assert.equal(completed.status,'completed');assert.equal(imageCalls,1);assert.equal(completed.calls.filter(c=>c.outcome==='succeeded').length,1);
  let detail=(await(await fetch(`${base}/api/deliveries/${delivery.id}`)).json()).delivery;const pending=detail.bundle;const approval=detail.posterApproval;
  assert.equal(detail.status,'visual_pending');assert.equal(detail.copyText,'');assert.equal(pending.publication,'preview');assert.equal(approval.status,'pending');assert.equal(pending.zipUrl,undefined);assert.equal(pending.artifacts[0].downloadUrl,undefined);
  assert.deepEqual(Buffer.from(await(await fetch(base+pending.artifacts[0].previewUrl)).arrayBuffer()),bytes);
  assert.equal((await fetch(base+pending.artifacts[0].previewUrl+'?download=1')).status,409);
  await publishRunBundles(deliveryRenderSource(delivery.id));
  detail=(await(await fetch(`${base}/api/deliveries/${delivery.id}`)).json()).delivery;assert.equal(detail.bundle.publication,'preview','old full-run promotion cannot approve a generated image');
  const body={bundleId:pending.id,artifactId:approval.artifactId,sha256:approval.sha256,checks:{text:true,product:true,facts:true}},approve=`${base}/api/deliveries/${delivery.id}/poster/approve`;
  assert.equal((await fetch(approve,post({...body,checks:{text:true,product:true,facts:false}}))).status,422);
  assert.equal((await fetch(approve,post({...body,sha256:'0'.repeat(64)}))).status,409);
  assert.equal((await fetch(approve,post({...body,unsafe:true}))).status,400);
  const approved=await fetch(approve,post(body));assert.equal(approved.status,200);const released=(await approved.json()).delivery;
  assert.equal(released.posterApproval.status,'approved');assert.equal(released.bundle.publication,'released');assert.equal(released.bundle.expiresAt,pending.expiresAt);
  assert.equal((await fetch(base+pending.artifacts[0].previewUrl+'?download=1')).status,409,'original unchecked handle never becomes a formal download');
  assert.deepEqual(Buffer.from(await(await fetch(base+released.bundle.artifacts[0].downloadUrl)).arrayBuffer()),bytes);
  const repeated=(await(await fetch(approve,post(body))).json()).delivery;assert.equal(repeated.bundle.artifacts[0].id,released.bundle.artifacts[0].id);
  const zip=await fetch(base+released.bundle.zipUrl);assert.equal(zip.status,200);const files=unzipSync(new Uint8Array(await zip.arrayBuffer()));assert.equal(files['文案.txt'],undefined);assert.deepEqual(Buffer.from(files['海报.png']),bytes);
  assert.doesNotMatch(strFromU8(files['海报核对与来源.json']),/\/api\/assets|sk-test|Bearer/);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),approval.sha256);assert.equal(imageCalls,1);
  const wrongPlatform=await fetch(`${base}/api/jobs`,post({kind:'render',idempotencyKey:randomUUID(),request:{runId:delivery.runId,revision:1,platform:'moments',selectedTitleIndex:0,templateId:'moments-square',deliveryId:delivery.id,visualMode:'poster-image'}}));assert.equal(wrongPlatform.status,400);
 }finally{globalThis.fetch=originalFetch;if(oldKey===undefined)delete process.env.IMAGE_API_KEY;else process.env.IMAGE_API_KEY=oldKey;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
