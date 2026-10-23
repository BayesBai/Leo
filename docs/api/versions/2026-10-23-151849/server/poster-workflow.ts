import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { CreativeAsset, RenderBundle, RenderRequest, RunResult } from '../shared/types.js';
import type { PosterApprovalInput } from '../shared/poster.js';
import { buildPosterPrompt, posterContentFingerprint, POSTER_NATIVE_SIZE } from './design/poster.js';
import { deliveryDetail, deliveryRenderSource, updateDeliveryBundle } from './deliveries.js';
import { FairLimiter } from './fair-limiter.js';
import { generateImage, snapshotImageConfig } from './image-provider.js';
import { digest, jobError, type JobContext, type StoredJob } from './job-store.js';
import { getAsset } from './knowledge.js';
import { WorkflowError } from './outlines.js';
import { getRunBundles, publishPosterCandidate, releasePosterCandidate, validateRender } from './render/index.js';
import { stateStore, HISTORY_TTL } from './state-store.js';

const posterSlots=new FairLimiter(1);
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
interface SavedPoster { asset:CreativeAsset; file:string; contentFingerprint:string; width:number; height:number; pngSha256:string }
interface PosterRequestMarker { jobId:string; round:number; state:'dispatched'|'failed'; error?:ReturnType<typeof jobError>; expiresAt:number }
const fail=(status:number,message:string,code:string,retryable=false)=>Object.assign(new WorkflowError(status,message),{code,retryable});

export async function renderPosterDelivery(result:RunResult,input:RenderRequest,record:StoredJob,ctx:JobContext):Promise<RenderBundle>{
  validateRender(result,input);ctx.signal.throwIfAborted();
  if(input.platform!=='poster'||!input.deliveryId)throw new WorkflowError(400,'整图海报需要独立海报交付 ID。');
  if(result.review.status==='blocked')throw fail(409,'本渠道审核阻断，未调用生图。','POSTER_REVIEW_BLOCKED');
  if(result.brief.mode!=='live')throw fail(409,'API 整图海报需要模型创作模式。本地演示不会调用生图，请创建模型任务。','POSTER_REQUIRES_LIVE');
  const config=snapshotImageConfig();if(!config.configured)throw fail(409,'尚未配置生图密钥，海报任务已暂停；其他渠道及正文保留。','IMAGE_NOT_CONFIGURED',true);
  const design=buildPosterPrompt(result,input),channel=record.job.channels.find(value=>value.platform==='poster');
  const setStage=(value:'design'|'image'|'publish')=>{if(channel)channel.stage=value;ctx.save();};
  setStage('design');
  // Confirm original bytes can actually be opened for the later human comparison.
  for(const image of design.referenceImages){ctx.signal.throwIfAborted();if(!/^\/api\/assets\/[a-f0-9-]{36}$/i.test(image.url))throw new WorkflowError(422,'海报原图引用无效。');await getAsset(image.url.split('/').pop()!);}
  const binding=digest({baseUrl:config.baseUrl,model:config.name,key:config.apiKey}),key=digest({content:design.contentFingerprint,model:config.name,baseUrl:config.baseUrl});
  const cp=(record.checkpoints.poster ||= {}) as {asset?:SavedPoster; configHash?:string; fingerprint?:string; design?:ReturnType<typeof buildPosterPrompt>};
  if(cp.fingerprint&&cp.fingerprint!==design.contentFingerprint)throw fail(409,'海报内容或设计版本已变化，请创建新海报任务。','POSTER_VERSION');
  if(cp.configHash&&cp.configHash!==binding)throw fail(409,'此海报任务绑定的生图配置已变化，请恢复原配置或创建新任务。','IMAGE_CONFIG_CHANGED');
  cp.fingerprint=design.contentFingerprint;cp.design=design;ctx.save();setStage('image');
  const release=await posterSlots.acquire(record.job.id,ctx.signal);
  let saved:SavedPoster;
  try{
    const prior=cp.asset||(!input.regenerateVisual?stateStore().get<SavedPoster>('posterMaterials',key):undefined);
    if(prior){
      if(prior.contentFingerprint!==design.contentFingerprint)throw fail(409,'缓存海报与当前内容不一致。','POSTER_VERSION');
      if(Date.parse(prior.asset.expiresAt)<=Date.now())throw fail(410,'已生成海报已过期，请明确重新生成，不会自动重发生图请求。','POSTER_EXPIRED');
      saved=prior;cp.asset=saved;ctx.acknowledge('image','poster');ctx.save();
    }else{
      const marker=stateStore().get<PosterRequestMarker>('posterRequests',key),round=record.retrySequence||0;
      const retry=marker?.jobId===record.job.id&&round>marker.round;
      // A same-round regeneration is still one user request; another paused
      // channel/job cannot turn an uncertain HTTP result into a second charge.
      const explicitNew=input.regenerateVisual&&marker?.jobId!==record.job.id;
      if(marker&&marker.expiresAt>Date.now()&&!retry&&!explicitNew){if(marker.error)throw Object.assign(new Error(marker.error.message),marker.error);throw Object.assign(new Error('此海报已派发生图但结果未确认；请在原任务明确重试，不会自动重发。'),{code:'IMAGE_PENDING_UNKNOWN',retryable:true,outcomeUnknown:true});}
      let generated:Awaited<ReturnType<typeof generateImage>>;
      try{
        generated=await generateImage({prompt:design.prompt,size:POSTER_NATIVE_SIZE,signal:ctx.signal,jobId:record.job.id,platform:'poster',config,
          beforeDispatch(){validateRender(result,input);cp.configHash=binding;ctx.save();},
          onCall(call){if(call.outcome==='dispatched')stateStore().set<PosterRequestMarker>('posterRequests',key,{jobId:record.job.id,round,state:'dispatched',expiresAt:Date.now()+HISTORY_TTL});ctx.call(call);}});
      }catch(error){stateStore().set<PosterRequestMarker>('posterRequests',key,{jobId:record.job.id,round,state:'failed',error:jobError(error,'image','poster'),expiresAt:Date.now()+HISTORY_TTL});throw error;}
      try {
      const meta=await sharp(generated.buffer).metadata();
      // Format conversion preserves the image dimensions and pixels; no crop,
      // resize, product redraw or local overlay is performed.
      const png=meta.format==='png'?generated.buffer:await sharp(generated.buffer).png().toBuffer();
      const id=randomUUID(),directory=path.join(stateStore().directory,'creative'),file=path.join(directory,id);await mkdir(directory,{recursive:true,mode:0o700});await writeFile(file,png,{mode:0o600});
      const asset:CreativeAsset={id,kind:'generated-visual',platform:'poster',model:generated.model,provider:generated.baseUrl,promptHash:design.promptHash,skillVersion:design.skillVersion,
        sourceImageIds:design.referenceImages.map(image=>image.id),sha256:sha(png),createdAt:generated.createdAt,expiresAt:new Date(Date.parse(generated.createdAt)+30*60_000).toISOString()};
      saved={asset,file,contentFingerprint:design.contentFingerprint,width:generated.width,height:generated.height,pngSha256:sha(png)};
      stateStore().update(b=>{(b.posterMaterials||={})[key]=saved;(b.creativeAssets||={})[id]={asset,file,expiresAt:Date.parse(asset.expiresAt)};delete b.posterRequests?.[key];});cp.asset=saved;ctx.acknowledge('image','poster');ctx.save();
      }catch(error){throw Object.assign(new WorkflowError(503,'服务商已返回图片，但本机保存结果尚未确认。重试可能再次计费；请先检查恢复情况，再明确重试，不会自动重新生图。'),{code:'IMAGE_PERSISTENCE_UNKNOWN',retryable:true,outcomeUnknown:true});}
    }
  }finally{release();}
  ctx.signal.throwIfAborted();validateRender(result,input);
  if(path.dirname(path.resolve(saved.file))!==path.join(stateStore().directory,'creative'))throw new WorkflowError(503,'海报素材索引损坏，已保留记录。');
  const bytes=await readFile(saved.file).catch(()=>{throw new WorkflowError(410,'海报素材不可读取，不会自动再次生图。');});
  if(sha(bytes)!==saved.pngSha256||sha(bytes)!==saved.asset.sha256)throw new WorkflowError(503,'海报素材校验失败，未发布。');
  setStage('publish');
  const bundle=await publishPosterCandidate(result,input,{data:bytes,width:saved.width,height:saved.height,sha256:saved.pngSha256,creativeAsset:saved.asset,
    approval:{sha256:saved.pngSha256,contentFingerprint:design.contentFingerprint,requiredCopy:design.requiredCopy,factChecks:design.factChecks,referenceImages:design.referenceImages,notice:design.notice},design},ctx.signal);
  updateDeliveryBundle(input.deliveryId,bundle);return bundle;
}

export async function approvePosterDelivery(id:string,input:PosterApprovalInput){
  if(!input||!input.checks||input.checks.text!==true||input.checks.product!==true||input.checks.facts!==true)throw new WorkflowError(422,'请逐项核对并确认中文、产品型号外观、参数和适用条件。');
  const bundle=stateStore().get<RenderBundle>('renderBundles',input.bundleId),approval=bundle?.posterApproval;
  if(!bundle||!approval||bundle.deliveryId!==id)throw new WorkflowError(409,'海报候选不属于当前交付。');
  if(input.artifactId!==approval.artifactId||input.sha256!==approval.sha256)throw new WorkflowError(409,'图片版本或校验值已变化，请重新核对当前海报。');
  if(Date.parse(approval.expiresAt)<=Date.now())throw new WorkflowError(410,'海报已超过原三十分钟有效期，请明确重新生成。');
  const current=deliveryDetail(id),source=deliveryRenderSource(id);
  const request:RenderRequest={runId:bundle.runId,revision:bundle.revision,deliveryId:id,platform:'poster',selectedTitleIndex:bundle.selectedTitleIndex,templateId:bundle.templateId,visualMode:'poster-image'};
  const assertCurrent=()=>{const latest=deliveryDetail(id),canonical=deliveryRenderSource(id);if(canonical.review.status==='blocked')throw new WorkflowError(409,'海报审核已阻断。');if(posterContentFingerprint(canonical,request)!==approval.contentFingerprint)throw new WorkflowError(409,'海报正文、事实或设计版本已变化，请重新生成并核对。');if(approval.status!=='approved'&&latest.bundle?.id!==input.bundleId)throw new WorkflowError(409,'已有更新的海报候选，请核对当前版本。');};
  assertCurrent();
  if(approval.status==='approved')return current;
  const released=await releasePosterCandidate(source,request,input.bundleId,input.checks,assertCurrent);
  return updateDeliveryBundle(id,released);
}
