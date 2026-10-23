import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { CreativeAsset, RenderRequest } from '../shared/types.js';
import { deliveryDetail, deliveryRenderSource, updateDeliveryBundle } from './deliveries.js';
import { digest, type JobContext, type StoredJob } from './job-store.js';
import { WorkflowError } from './outlines.js';
import { stateStore } from './state-store.js';
import { getRunBundles, publishVideoBundle, validateRender } from './render/index.js';
import type { RenderImage } from './render/layouts.js';
import { renderProductVideo, VIDEO_SPEC, VIDEO_RENDERER_VERSION } from './render/video.js';
import { HTML_DESIGN_VERSION, HTML_SKILL_HASHES } from './design/html-rules.js';
import { originalImages } from './visual-workflow.js';

/** Video is a presentation of a frozen, independently reviewed static delivery. */
export function videoSource(deliveryId: string) {
  const delivery=deliveryDetail(deliveryId);
  if(!['wechat','xiaohongshu'].includes(delivery.platform))throw new WorkflowError(422,'当前仅公众号和小红书支持按需产品视频。');
  if(delivery.review.status==='blocked')throw new WorkflowError(409,'本渠道审核阻断，请先处理审核问题。');
  if(!delivery.bundle || delivery.bundle.publication!=='released' || Date.parse(delivery.bundle.expiresAt)<=Date.now())throw new WorkflowError(410,'图文成品已过期或尚未交付，请重新排版后生成视频。');
  const source=deliveryRenderSource(deliveryId);
  const request:RenderRequest={runId:delivery.runId,revision:delivery.revision,platform:delivery.platform,deliveryId,
    selectedTitleIndex:delivery.bundle.selectedTitleIndex,templateId:delivery.bundle.templateId,visualMode:'html'};
  validateRender(source,request);
  const fingerprint=digest({version:VIDEO_RENDERER_VERSION,design:HTML_DESIGN_VERSION,skills:HTML_SKILL_HASHES,spec:VIDEO_SPEC,draft:delivery.draft,review:delivery.review,product:delivery.product,
    bundle:delivery.bundle.id,creative:delivery.bundle.creativeAssets?.map(a=>a.sha256)});
  return {delivery,source,request,fingerprint,expiresAt:delivery.bundle.expiresAt};
}

async function existingBackground(assets:CreativeAsset[]|undefined):Promise<{image?:RenderImage;assets:CreativeAsset[];expiresAt?:string}> {
  const asset=assets?.[0];if(!asset)return {assets:[]};
  if(Date.parse(asset.expiresAt)<=Date.now())throw new WorkflowError(410,'原 AI 背景已过期，请主动重新准备视觉素材；不会自动调用生图。');
  const saved=stateStore().get<{asset:CreativeAsset;file:string}>('creativeAssets',asset.id);
  if(!saved || saved.asset.sha256!==asset.sha256 || path.dirname(path.resolve(saved.file))!==path.join(stateStore().directory,'creative'))throw new WorkflowError(503,'背景素材记录不可读取或损坏，已保留记录；未调用生图。');
  const bytes=await readFile(saved.file).catch(()=>{throw new WorkflowError(410,'背景文件已不可读取，请重新准备素材；未调用生图。');});
  if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw new WorkflowError(503,'背景校验失败，已保留原文件。');
  const {data,info}=await sharp(bytes).rotate().png().toBuffer({resolveWithObject:true});
  return {assets:[asset],expiresAt:asset.expiresAt,image:{id:asset.id,name:'已生成场景背景',uri:`data:image/png;base64,${data.toString('base64')}`,width:info.width,height:info.height}};
}

export async function executeVideoJob(record:StoredJob,ctx:JobContext) {
  if(record.job.input.kind!=='video')throw new WorkflowError(400,'视频任务输入无效。');
  const id=record.job.input.deliveryId, current=videoSource(id), channel=record.job.channels[0];
  const binding=record.checkpoints.videoSource as {fingerprint:string;expiresAt:string}|undefined;
  if(binding && binding.fingerprint!==current.fingerprint)throw new WorkflowError(409,'排队期间图文或设计版本已变化，请为当前交付重新创建视频。');
  record.checkpoints.videoSource ||= {fingerprint:current.fingerprint,expiresAt:current.expiresAt};
  const assertCurrent=()=>{ctx.signal.throwIfAborted();if(videoSource(id).fingerprint!==current.fingerprint)throw new WorkflowError(409,'制作期间图文或审核版本已变化，视频未发布。');};
  channel.deliveryId=id;channel.delivery=current.delivery;channel.stage='storyboard';channel.status='running';ctx.save();
  const cached=getRunBundles(current.source.id,true).find(b=>b.kind==='video'&&b.deliveryId===id&&b.sourceFingerprint===current.fingerprint);
  if(cached) {record.job.videoBundle=cached;channel.delivery=updateDeliveryBundle(id,cached);channel.status='completed';channel.stage='publish';ctx.save();return;}
  const images=await originalImages(current.source,current.delivery.platform,ctx.signal);
  const background=await existingBackground(current.delivery.bundle!.creativeAssets);
  const expiresAt=new Date(Math.min(Date.parse(binding?.expiresAt||current.expiresAt),Date.parse(background.expiresAt||current.expiresAt))).toISOString();
  if(Date.parse(expiresAt)<=Date.now())throw new WorkflowError(410,'视频所用素材已过期，请重新准备。');
  const media=await renderProductVideo({draft:current.delivery.draft,title:current.delivery.draft.titles[current.request.selectedTitleIndex],productName:current.delivery.product.name,
    facts:current.source.evidence.facts,images,background:background.image,signal:ctx.signal,onProgress:p=>{
      channel.stage=p.phase==='storyboard'?'storyboard':p.phase==='encode'?'video_encode':'video_render';
      channel.progress={completedFrames:p.completedFrames,totalFrames:p.totalFrames};ctx.save();
    }});
  assertCurrent();
  const bundle=await publishVideoBundle(current.source,current.request,media,{expiresAt,fingerprint:current.fingerprint,creativeAssets:background.assets,assertCurrent},ctx.signal);
  record.checkpoints.videoBundleId=bundle.id;record.job.videoBundle=bundle;
  channel.delivery=updateDeliveryBundle(id,bundle);channel.status='completed';channel.stage='publish';ctx.save();
}
