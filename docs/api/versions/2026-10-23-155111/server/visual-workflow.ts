import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import type { CreativeAsset, ExternalDesign, Platform, RenderArtifact, RenderBundle, RenderRequest, RunResult } from '../shared/types.js';
import { buildDesignBrief, compileImagePrompt, buildLayeredDeck } from './design/index.js';
import { generateImage, snapshotImageConfig } from './image-provider.js';
import { assertImageConfiguration, imageConfigurationHash, imageProviderFingerprint } from './image-binding.js';
import { importCanvaPptx, syncCanvaDesign, canvaConnectionStatus, canvaConnectionIdentity, verifyCanvaConnection } from './integrations/canva.js';
import { stateStore, HISTORY_TTL } from './state-store.js';
import { FairLimiter } from './fair-limiter.js';
import { digest, jobError, type JobContext, type StoredJob } from './job-store.js';
import { getAsset, assertEvidenceCurrent } from './knowledge.js';
import { WorkflowError } from './outlines.js';
import { getRunBundles, renderRun, renderTemplates, validateRender } from './render/index.js';
import { revokeDelivery, updateDeliveryDesigns, deliveryDetail } from './deliveries.js';
import type { RenderImage } from './render/layouts.js';
const sharedImages = new Map<string,Promise<SavedVisual>>();
// Image HTTP is already serial. This lock also covers the durable cache check
// and commit, so independent channel jobs cannot queue duplicate paid requests.
const materialPreparation = new FairLimiter(1);
interface SavedVisual { asset: CreativeAsset; file: string }
interface CreativeRequest { jobId: string; round: number; state: 'dispatched' | 'failed'; error?: ReturnType<typeof jobError>; expiresAt: number; providerFingerprint?: string }
const sha = (s: Buffer) => createHash('sha256').update(s).digest('hex');
export async function originalImages(result:RunResult,platform:Platform,signal:AbortSignal):Promise<RenderImage[]> {
  const draft=result.drafts.find(d=>d.platform===platform)!;
  const images:RenderImage[]=[];
  for(const id of draft.images.map(i=>i.imageId)){
    const image=result.evidence.images.find(i=>i.id===id && i.productId===result.product.id);
    if(!image || !/^\/api\/assets\/[A-Za-z0-9_-]+$/.test(image.url)) throw new WorkflowError(422,'视觉制作至少需要一张有效的同型号原图。');
    signal.throwIfAborted(); const raw=await getAsset(image.url.split('/').pop()!);
    const {data,info}=await sharp(raw.data).rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
    images.push({id:image.id,name:image.name,uri:`data:image/png;base64,${data.toString('base64')}`,width:info.width,height:info.height});
  }
  if(!images.length)throw new WorkflowError(422,'AI 背景不能替代真实产品原图，请重新获取同型号素材。');
  return images;
}
/** Separate visual checkpoints never invalidate already-paid writing/review checkpoints. */
export async function renderVisualDelivery(result:RunResult,input:RenderRequest,record:StoredJob,ctx:JobContext):Promise<RenderBundle> {
  validateRender(result,input);
  if(input.platform==='moments')return renderRun(result,input,ctx.signal);
  const channel=record.job.channels.find(c=>c.platform===input.platform)!;
  const stage=(value:typeof channel.stage)=>{channel.stage=value;ctx.save();};
  const draft=result.drafts.find(d=>d.platform===input.platform)!;
  const key=`visual:${input.platform}`;
  const cp=(record.checkpoints[key] ||= {}) as Record<string,any>;
  // A rerender may alter presentation, never weaken a completed channel's review.
  if(result.review.status==='blocked')return renderRun(result,input,ctx.signal);
  const originals=await originalImages(result,input.platform,ctx.signal);
  stage('design');
  const design=buildDesignBrief({draft,brief:result.brief,title:draft.titles[input.selectedTitleIndex],productName:result.product.name,template:renderTemplates.find(t=>t.id===input.templateId)});
  const compiled=compileImagePrompt(design);
  cp.design=design;cp.promptHash=compiled.promptHash;ctx.save();
  const assetKey=input.platform==='poster'?'image:poster':'image:main';
  const retainedVisual=record.checkpoints[assetKey] as SavedVisual|undefined;
  const imageConfigured=retainedVisual?true:snapshotImageConfig().configured;
  const htmlMode=input.visualMode==='html' && (input.platform==='wechat'||input.platform==='xiaohongshu');
  if(htmlMode&&result.brief.mode==='live'&&input.regenerateVisual&&!imageConfigured)throw Object.assign(new WorkflowError(409,'尚未配置生图密钥，无法重新生成背景；已审核图文保留。'),{code:'IMAGE_NOT_CONFIGURED',retryable:true});
  if(htmlMode && (result.brief.mode!=='live'||!imageConfigured)) {
    stage('render');
    const previous=getRunBundles(result.id).filter(b=>b.platform===input.platform).sort((a,b)=>Date.parse(a.expiresAt)-Date.parse(b.expiresAt))[0];
    const expiresAt=cp.expiresAt ||= previous?.expiresAt || new Date(Date.now()+30*60_000).toISOString();ctx.save();
    return renderRun(result,input,ctx.signal,{expiresAt,design, warnings:result.brief.mode==='live'?['未配置生图 Key，已采用真实产品图与 HTML 排版，未调用生图服务。']:[]});
  }
  const connection=htmlMode?{connected:true,configured:true}:canvaConnectionStatus();
  if(!htmlMode && !connection.connected)throw Object.assign(new WorkflowError(409, connection.configured?'请先完成 Canva 账号授权；已审核正文已保留。':'请先在本机配置 Canva 开发应用并授权；已审核正文已保留。'),{code:'CANVA_NOT_CONNECTED',retryable:true});
  if(!htmlMode)cp.connectionId ||= canvaConnectionIdentity();ctx.save();
  const assertCanvaIdentity=()=>{if(!htmlMode && cp.connectionId!==canvaConnectionIdentity())throw Object.assign(new WorkflowError(409,'任务绑定的 Canva 账号授权已变化，请重新确认后创建视觉任务。'),{code:'CANVA_CONNECTION_CHANGED',retryable:false});};
  assertCanvaIdentity();
  if(!htmlMode && (!record.checkpoints.canvaVerified || (record.checkpoints.canvaVerified as {connectionId?:string}).connectionId!==cp.connectionId)){await verifyCanvaConnection(ctx.signal);record.checkpoints.canvaVerified={connectionId:cp.connectionId,at:Date.now()};ctx.save();}
  // A shared single-flight material has no dependency on another channel's reviewer.
  const owner:Platform=input.platform==='poster'?'poster':record.snapshot?.brief.platforms.includes('xiaohongshu')?'xiaohongshu':input.platform;
  stage('image');
  const generate=async():Promise<SavedVisual>=>{
    const release = await materialPreparation.acquire(record.job.id,ctx.signal);
    try {
    const retained=record.checkpoints[assetKey] as SavedVisual|undefined;
    if(retained){if(Date.parse(retained.asset.expiresAt)<=Date.now())throw new WorkflowError(410,'已生成视觉素材已过期。请主动创建新的视觉任务；不会自动重新计费。');ctx.acknowledge('image',input.platform);ctx.save();return retained;}
    const logicalKey=digest({runId:result.id,role:input.platform==='poster'?'poster':'main',skillVersion:compiled.skillVersion});
    const config=snapshotImageConfig(),providerFingerprint=imageProviderFingerprint(config);
    const materialKey=digest({content:logicalKey,provider:providerFingerprint});
    assertImageConfiguration(record,config);
    const prior=(!input.regenerateVisual ? stateStore().get<SavedVisual>('creativeMaterials',materialKey):undefined) as SavedVisual|undefined;
    if(prior){if(Date.parse(prior.asset.expiresAt)<=Date.now())throw new WorkflowError(410,'已生成视觉素材已过期。请主动创建新的视觉任务；不会自动重新计费。');record.checkpoints[assetKey]=prior;ctx.acknowledge('image',input.platform);ctx.save();return prior;}
    const imageDesign=owner!==input.platform?buildDesignBrief({draft:{...draft,platform:owner},brief:result.brief,title:draft.titles[input.selectedTitleIndex],productName:result.product.name}):design;
    const imagePrompt=compileImagePrompt(imageDesign);
    const configHash=imageConfigurationHash(config);
    const bindingKey=`${assetKey}:config`;
    if(record.checkpoints[bindingKey]&&record.checkpoints[bindingKey]!==configHash)throw new WorkflowError(409,'此视觉步骤绑定的生图配置已变化，请恢复配置或创建新视觉任务。');
    assertImageConfiguration(record,config);
    const attemptKey=`${assetKey}:attempt`;const attempt=record.checkpoints[attemptKey] as {round:number;error?:ReturnType<typeof jobError>;state:string}|undefined;
    const round=record.retrySequence||0;
    if(attempt?.round===round){if(attempt.error)throw Object.assign(new Error(attempt.error.message),attempt.error);if(attempt.state==='dispatched')throw Object.assign(new Error('此轮共用生图已派发，结果尚未确认；请从任务中心显式重试。'),{code:'IMAGE_PENDING_UNKNOWN',outcomeUnknown:true,retryable:true});}
    const marker=stateStore().get<CreativeRequest>('creativeRequests',logicalKey);
    const explicitRetry=marker?.jobId===record.job.id && round>marker.round;
    if(marker && marker.expiresAt>Date.now() && (!marker.error||marker.error.outcomeUnknown||marker.providerFingerprint===providerFingerprint) && !explicitRetry && !input.regenerateVisual) {
      if(marker.error)throw Object.assign(new Error(marker.error.message),marker.error);
      throw Object.assign(new Error('此主视觉曾派发生图但结果尚未确认，不会从其他渠道重复请求。请在原任务主动重试，或明确重新生成视觉。'),{code:'IMAGE_PENDING_UNKNOWN',outcomeUnknown:true,retryable:true});
    }
    let generated:Awaited<ReturnType<typeof generateImage>>,paidDispatched=false;
    try{generated=await generateImage({prompt:imagePrompt.prompt,size:owner==='wechat'?'1536x1024':'1024x1536',signal:ctx.signal,jobId:record.job.id,platform:input.platform,config,onCall:call=>{if(call.outcome==='dispatched'){paidDispatched=true;record.checkpoints[attemptKey]={round,state:'dispatched'};stateStore().set<CreativeRequest>('creativeRequests',logicalKey,{jobId:record.job.id,round,state:'dispatched',providerFingerprint,expiresAt:Date.now()+HISTORY_TTL});}ctx.call(call);},
      beforeDispatch:()=>{assertCanvaIdentity();assertEvidenceCurrent(result.evidence);assertImageConfiguration(record,config);record.checkpoints[bindingKey]=configHash;ctx.save();}});
    }catch(error){if(!paidDispatched)throw error;const safeError=jobError(error,'image',input.platform);record.checkpoints[attemptKey]={round,state:'failed',error:safeError};stateStore().set<CreativeRequest>('creativeRequests',logicalKey,{jobId:record.job.id,round,state:'failed',providerFingerprint,error:safeError,expiresAt:Date.now()+HISTORY_TTL});ctx.save();throw error;}
    const id=randomUUID(),directory=path.join(stateStore().directory,'creative');await mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,id);await writeFile(file,generated.buffer,{mode:0o600});
    const asset:CreativeAsset={id,kind:'generated-visual',platform:owner,model:generated.model,provider:generated.baseUrl,promptHash:imagePrompt.promptHash,skillVersion:imagePrompt.skillVersion,sourceImageIds:originals.map(i=>i.id),sha256:generated.sha256,createdAt:generated.createdAt,expiresAt:new Date(Date.now()+30*60_000).toISOString()};
    const saved={asset,file};record.checkpoints[assetKey]=saved;stateStore().update(b=>{(b.creativeAssets||={})[id]={...saved,expiresAt:Date.parse(asset.expiresAt)};(b.creativeMaterials||={})[materialKey]=saved;delete b.creativeRequests?.[logicalKey];});ctx.acknowledge('image',input.platform);ctx.save();return saved;
    } finally {release();}
  };
  const flightKey=`${record.job.id}:${assetKey}`;
  let flight=sharedImages.get(flightKey);if(!flight){flight=generate().finally(()=>sharedImages.delete(flightKey));sharedImages.set(flightKey,flight);}
  const saved=await flight;
  const backgroundBytes=await readFile(saved.file).catch(()=>{throw new WorkflowError(410,'已保存的主视觉不可读取；不会自动重新计费。');});
  if(sha(backgroundBytes)!==saved.asset.sha256)throw new WorkflowError(503,'视觉素材校验失败，已保留原文件。');
  const backgroundMetadata=await sharp(backgroundBytes).metadata();
  const background:RenderImage={id:saved.asset.id,name:'AI 场景背景',uri:`data:image/png;base64,${(await sharp(backgroundBytes).png().toBuffer()).toString('base64')}`,width:backgroundMetadata.width!,height:backgroundMetadata.height!};
  if(htmlMode) {
    const previous=getRunBundles(result.id).filter(b=>b.platform===input.platform).sort((a,b)=>Date.parse(a.expiresAt)-Date.parse(b.expiresAt))[0];
    const expiresAt=cp.expiresAt ||= previous?.expiresAt || saved.asset.expiresAt;ctx.save();
    stage('render');return renderRun(result,input,ctx.signal,{expiresAt,background,design,creativeAssets:[saved.asset]});
  }
  stage('compose');
  let deck=await buildLayeredDeck({draft,title:draft.titles[input.selectedTitleIndex],productName:result.product.name,platform:input.platform,images:originals,background,brief:design,signal:ctx.signal,editableTitlePlaceholder:true});
  if (cp.deckFile && cp.deckMetadata) {
    if(cp.deckMetadata.fingerprint!==deck.fingerprint)throw new WorkflowError(409,'分层设计规则或内容版本已变化，请主动创建新的视觉任务。');
    const bytes=await readFile(cp.deckFile); if(sha(bytes)!==cp.deckBytesHash)throw new WorkflowError(503,'分层文件校验失败，已保留原记录。');
    deck={...cp.deckMetadata,buffer:bytes};
  } else {
    const dir=path.join(stateStore().directory,'creative');await mkdir(dir,{recursive:true,mode:0o700});
    cp.deckFile=path.join(dir,randomUUID());await writeFile(cp.deckFile,deck.buffer,{mode:0o600});
    const {buffer,...metadata}=deck;cp.deckMetadata=metadata;cp.deckBytesHash=sha(buffer);
    stateStore().set('creativeFiles',path.basename(cp.deckFile),{file:cp.deckFile,expiresAt:Date.parse(saved.asset.expiresAt)});
  }
  cp.deckFingerprint=deck.fingerprint;ctx.save();
  const previous=getRunBundles(result.id).filter(b=>b.platform===input.platform).sort((a,b)=>Date.parse(a.expiresAt)-Date.parse(b.expiresAt))[0];
  const expiresAt=cp.expiresAt ||= previous?.expiresAt || saved.asset.expiresAt;ctx.save();
  stage('canva_import');assertEvidenceCurrent(result.evidence);
  if(!deck.verificationEdit)throw new WorkflowError(422,'分层文件缺少可验证的标题编辑层。');
  cp.operationId ||= randomUUID();ctx.save();
  const exported=await importCanvaPptx({operationId:cp.operationId,expectedConnectionId:cp.connectionId,bytes:deck.buffer,title:`${result.product.name} ${input.platform}`,platform:input.platform,expiresAt,checkpoint:cp.canva,
    verificationEdit:deck.verificationEdit,expectedText:deck.pages.flatMap(p=>p.texts),expectedImageCount:deck.pages.reduce((sum,p)=>sum+p.sourceImageIds.length,0)+1,width:deck.pages[0].width,height:deck.pages[0].height,signal:ctx.signal,onCheckpoint:(next:unknown)=>{cp.canva=next;const checkpoint=next as {design?:ExternalDesign};if(checkpoint.design&&input.deliveryId){channel.delivery=updateDeliveryDesigns(input.deliveryId,[{...checkpoint.design,expiresAt}]);}ctx.save();}});
  exported.design={...exported.design,expiresAt};cp.designs=[exported.design];ctx.save();stage('canva_export');
  const externalFiles=[];
  for(const [index,file] of expandCanvaFiles(exported.files).entries()){
    const data=await sharp(file).resize(deck.pages[index]?.width || 1080,deck.pages[index]?.height ||1440,{fit:'fill'}).png().toBuffer();
    externalFiles.push({data,name:`${input.platform}-${index+1}.png`,mimeType:'image/png',width:deck.pages[index]?.width,height:deck.pages[index]?.height,role:deck.pages[index]?.role as RenderArtifact['role']});
  }
  if(externalFiles.length!==deck.pages.length)throw new WorkflowError(502,'Canva 导出的页数与分层设计不一致，未发布成品。');
  stage('render');return renderRun(result,input,ctx.signal,{expiresAt,externalFiles,externalDesigns:[exported.design],creativeAssets:[saved.asset]});
}

function expandCanvaFiles(files:{bytes:Buffer;mime:string}[]):Buffer[]{
  const output:Buffer[]=[];
  for(const file of files){if(file.mime==='image/png'){output.push(file.bytes);continue;}
    let total=0,count=0;const unzipped=unzipSync(file.bytes,{filter:f=>{if(!/\.png$/i.test(f.name))return false;total+=f.originalSize;count++;if(count>6||total>100_000_000||f.originalSize>25_000_000)throw new WorkflowError(502,'Canva ZIP 解压大小或页数超过限制。');return true;}});
    for(const name of Object.keys(unzipped).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})))output.push(Buffer.from(unzipped[name]));
  }if(!output.length || output.length>6)throw new WorkflowError(502,'Canva 未返回有效的1–6页 PNG。');return output;
}
export async function syncVisualDelivery(result:RunResult,input:RenderRequest,record:StoredJob,ctx:JobContext):Promise<RenderBundle>{
  if(!input.deliveryId)throw new WorkflowError(400,'同步需要独立渠道交付 ID。');
  const previous=getRunBundles(result.id).find(b=>b.deliveryId===input.deliveryId && b.externalDesigns?.length);
  const designsToSync=previous?.externalDesigns || deliveryDetail(input.deliveryId).externalDesigns;
  const expiry=previous?.expiresAt || designsToSync?.[0]?.expiresAt;
  if(!expiry || Date.parse(expiry)<=Date.now() || !designsToSync?.length)throw new WorkflowError(410,'此渠道的 Canva 资源已过期或尚未导入，请主动重新排版。');
  record.checkpoints.canvaConnectionId ||= canvaConnectionIdentity();ctx.save();
  const channel=record.job.channels[0];channel.stage='canva_edit';ctx.save();
  const externalFiles:{data:Buffer;name:string;mimeType:string;width:number;height:number;role:RenderArtifact['role']}[]=[];const designs:ExternalDesign[]=[];
  for(const design of designsToSync){
    const cpKey=`sync:${design.id}`;let synced=record.checkpoints[cpKey] as Awaited<ReturnType<typeof syncCanvaDesign>>|undefined;
    // Buffers are not serialized into JSON checkpoints. Sync exports are local and never text/image paid requests.
    synced=await syncCanvaDesign({design,expectedConnectionId:record.checkpoints.canvaConnectionId as string|undefined,expiresAt:expiry,signal:ctx.signal});
    record.checkpoints[cpKey]={design:synced.design,contentChanged:synced.contentChanged,inspection:synced.inspection};ctx.save();
    if(synced.contentChanged){revokeDelivery(input.deliveryId);throw Object.assign(new WorkflowError(409,'Canva 中的文字或产品素材已改变，已撤销本渠道导出资格。请返回大纲重新核对与审稿。'),{code:'CANVA_CONTENT_CHANGED',retryable:false});}
    designs.push(synced.design);
    const width=input.platform==='wechat'?1200:1080,height=input.platform==='wechat'?510:input.platform==='poster'?1920:1440;
    for(const [index,bytes] of expandCanvaFiles(synced.files).entries())externalFiles.push({data:await sharp(bytes).resize(width,height).png().toBuffer(),name:`${input.platform}-${index+1}.png`,mimeType:'image/png',width,height,role:input.platform==='poster'?'poster':index===0?'cover':'card'});
  }
  channel.stage='render';ctx.save();return renderRun(result,input,ctx.signal,{expiresAt:expiry,externalFiles,externalDesigns:designs});
}
