import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID}from'node:crypto';
import {unzipSync,strFromU8}from'fflate';
import type{Brief,Draft,RunResult}from'../shared/types.js';
import type{VideoScript,VideoScriptReview}from'../shared/video.js';
import{listProducts,getAsset}from'../server/knowledge.js';
import{createOutline}from'../server/outlines.js';
import{getRenderAsset,publishVideoBundle}from'../server/render/index.js';

test('video publication packages the independently reviewed short script, display conditions and only its own facts',async()=>{
 const product=(await listProducts())[0],brief:Brief={productId:product.id,audience:'学生',scene:'纯模拟视频包装',goal:'到店核对',buyingStage:'对比',platforms:['wechat'],instructions:'',mode:'demo',knowledgeSource:'local'};
 const outline=await createOutline(brief),first=outline.evidence.facts[0].id,second=outline.evidence.facts[1].id;
 const draft:Draft={id:randomUUID(),platform:'wechat',titles:['原文章标题'],intro:'原文章导语',blocks:[{id:'long-one',heading:'原长文标题',text:'原长文不应出现在短视频文案中。',factIds:[first]},{id:'long-two',heading:'其他原文事实',text:'另一个没有被视频选用的事实。',factIds:[second]}],cta:'原文章CTA',tags:[],images:[{imageId:outline.evidence.images[0].id,afterBlock:0,caption:'模拟原图',reason:'模拟'}]};
 const review={status:'passed' as const,issues:[],checks:[],reviewedBy:'rules+model' as const,factCount:2,citedFactCount:2,imageCount:1};
 const source:RunResult={id:randomUUID(),revision:1,createdAt:new Date().toISOString(),brief,product:outline.product,evidence:outline.evidence,drafts:[draft],review,strategies:[],trace:[],notice:'纯模拟包装测试'};
 const script:VideoScript={version:'video-script-v2',title:'独立视频短标题',cta:'视频到店引导',sourceFingerprint:'mock-fingerprint',scenes:[{id:'one',kind:'fact',heading:'独立视频看点',text:'用于校验附件选择的短句。',factIds:[first],conditions:[{factId:first,qualifierIndex:0,mode:'display',text:'画面必须展示的完整条件。'},{factId:first,qualifierIndex:1,mode:'scope',text:'不应进入画面文案的来源范围。',reason:'此句已局限具体型号'}]}]};
 const videoReview:VideoScriptReview={status:'passed',issues:[],reviewedBy:'rules+model',checkedAt:new Date().toISOString()};
 const request={runId:source.id,revision:1,platform:'wechat' as const,selectedTitleIndex:0,templateId:'wechat-editorial'};
 // Deliberately synthetic media bytes: this test checks publication packaging;
 // encoder correctness is covered by video-render and ffprobe acceptance.
 const media={data:Buffer.from('synthetic transport fixture'),cover:(await getAsset(outline.evidence.images[0].url.split('/').pop()!)).data,html:'<p>模拟视频HTML源</p>',storyboard:{fixture:true},width:1080,height:1920,durationSeconds:20,fps:30,frameCount:600};
 const options={expiresAt:new Date(Date.now()+1800000).toISOString(),fingerprint:'mock-fingerprint',assertCurrent(){},videoScript:script,videoScriptReview:videoReview};
 await assert.rejects(publishVideoBundle(source,request,media,{...options,videoScriptReview:{...videoReview,status:'blocked'}},new AbortController().signal),(error:any)=>error.status===409);
 await assert.rejects(publishVideoBundle(source,request,media,{...options,videoScriptReview:{...videoReview,issues:[{id:'error',severity:'error',message:'模拟错误',suggestion:'先修复'}]}},new AbortController().signal),(error:any)=>error.status===409);
 const before=structuredClone(source.review),bundle=await publishVideoBundle(source,request,media,options,new AbortController().signal);
 assert.deepEqual(source.review,before);assert.equal(bundle.reviewStatus,'passed');assert.deepEqual(bundle.artifacts[0].factIds,[first]);
 const zip=await getRenderAsset(bundle.zipUrl!.split('/').pop()!.split('?')[0],true),files=unzipSync(zip.data);
 assert.deepEqual(JSON.parse(strFromU8(files['source/video-script.json'])),script);assert.deepEqual(JSON.parse(strFromU8(files['source/video-review.json'])),videoReview);
 const copy=strFromU8(files['文案.txt']);assert.match(copy,/独立视频短标题/);assert.match(copy,/画面必须展示的完整条件/);assert.doesNotMatch(copy,/原长文|原文章CTA|不应进入画面文案/);
 assert.match(strFromU8(files['来源与审核.md']),/视频短稿独立审稿结论：passed/);
});
