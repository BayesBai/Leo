import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp, { type OutputInfo } from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import type { Draft, RenderArtifact, RenderBundle, RenderRequest, RenderTemplate, RunResult } from '../../shared/types.js';
import { getAsset, assertEvidenceCurrent, KnowledgeError } from '../knowledge.js';
import { stateStore } from '../state-store.js';
import { assertChannelImageCount } from '../asset-policy.js';
import { WorkflowError } from '../outlines.js';
import { reusableEvidence } from '../pipeline.js';
import { planXhs, renderXhs, fontFile, type RenderImage } from './layouts.js';
import { renderWechatArticle } from './wechat.js';
import { FairLimiter } from '../fair-limiter.js';
import { renderDirectory } from './path.js';
import { renderEditorialCover, renderMomentsCard, renderStorePoster } from './compositions.js';
import { planHtmlXhs, renderXhsWithSource, renderHtmlWechatCover } from './html-design.js';
import { renderWechatArticleWithSource } from './wechat.js';
import { HTML_DESIGN_VERSION, HTML_SKILL_HASHES } from '../design/html-rules.js';
import type { PosterApproval, PosterChecks } from '../../shared/poster.js';
import type { VideoScript, VideoScriptReview } from '../../shared/video.js';

export const renderTemplates: RenderTemplate[] = [
  { id: 'wechat-editorial', platform: 'wechat', name: '公众号 · 杂志阅读', width: 1200, height: 510 },
  { id: 'wechat-warm', platform: 'wechat', name: '公众号 · 清单手记', width: 1200, height: 510 },
  { id: 'xhs-cream', platform: 'xiaohongshu', name: '小红书 · 奶油笔记', width: 1080, height: 1440 },
  { id: 'xhs-sage', platform: 'xiaohongshu', name: '小红书 · 青绿手记', width: 1080, height: 1440 },
  { id: 'moments-square', platform: 'moments', name: '朋友圈 · 精选原图', width: 1080, height: 1080 },
  { id: 'moments-portrait', platform: 'moments', name: '朋友圈 · 场景原图', width: 1080, height: 1440 },
  { id: 'poster-paper', platform: 'poster', name: '海报 · 原色纸感', width: 1080, height: 1920 },
  { id: 'poster-ink', platform: 'poster', name: '海报 · 深色展陈', width: 1080, height: 1920 },
];
const root = renderDirectory();
const TTL = 30 * 60_000;
const assets = new Map<string, { file: string; group: string; expires: number; type: string; extension: string; name: string; exportable: boolean; sha256?:string }>();
const groups = new Map<string, number>();
let restored = false;
function restoreRenderState() {
  if (restored) return;
  for (const [id, a] of stateStore().entries<{ file: string; group: string; expires: number; type: string; extension: string; name: string; exportable: boolean; sha256?:string }>('renderAssets')) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9-]{36}$/.test(a.group) || a.expires <= Date.now() || path.dirname(path.resolve(a.file)) !== path.join(root, a.group)) continue;
    assets.set(id, a); groups.set(a.group, a.expires);
  }
  restored = true;
}
export function getRunBundles(runId: string, includeVideo = false): RenderBundle[] {
  return stateStore().entries<RenderBundle>('renderBundles').map(([, b]) => b).filter(b => b.runId === runId && (includeVideo || b.kind !== 'video') && Date.parse(b.expiresAt) > Date.now()
    && b.artifacts.every(a => { const saved = stateStore().get<{ file: string; expires: number }>('renderAssets', a.id); return !!saved && saved.expires > Date.now() && existsSync(saved.file); }));
}
// Timer sweeps and concurrent render completions share the same bounded asset store.
let maintenance: Promise<unknown> = Promise.resolve();
function maintain<T>(operation: () => Promise<T>): Promise<T> {
  const pending = maintenance.then(operation, operation);
  maintenance = pending.catch(() => {});
  return pending;
}
const renderSlots = new FairLimiter(2);
const posterCandidateSlots = new FairLimiter(1);
interface PrivateArtifact {
  file: string; name: string; role: RenderArtifact['role']; format: RenderArtifact['format'];
  sourceImageIds: string[]; factIds: string[]; width?: number; height?: number; mimeType?:string;
}
interface PrivateBundle {
  identity: string; runId: string; input: RenderRequest; expires: number; pending: boolean; files: PrivateArtifact[];
  copyText: string; sourcesMarkdown: string;
}
function renderIdentity(result: RunResult, input: RenderRequest, publication: string) {
  return createHash('sha256').update(JSON.stringify({ input, draft: result.drafts.find(d => d.platform === input.platform),
    evidence: result.evidence, review: result.review, publication, renderer: input.visualMode === 'html' ? 4 : 3 })).digest('hex');
}
const convertedImages = new Map<string, { expires: number; value: Promise<{ data: Buffer; info: OutputInfo }> }>();
async function convertedImage(original: Buffer) {
  const key = createHash('sha256').update(original).digest('hex');
  const existing = convertedImages.get(key);
  if (existing && existing.expires > Date.now()) return existing.value;
  for (const [id, entry] of convertedImages) if (entry.expires <= Date.now()) convertedImages.delete(id);
  while (convertedImages.size >= 48) convertedImages.delete(convertedImages.keys().next().value!);
  const value = sharp(original, { limitInputPixels: 60_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  convertedImages.set(key, { value, expires: Date.now() + TTL });
  value.catch(() => { if (convertedImages.get(key)?.value === value) convertedImages.delete(key); });
  return value;
}
const filenames: Record<string, string> = { wechat: '公众号', xiaohongshu: '小红书', moments: '朋友圈', poster: '门店海报' };
async function sourceNotices(files:Record<string,Uint8Array>,withFonts=false) {
  for(const name of ['premium-animations','ui-animation','gsap-skills','html-animation'])files[`source/licenses/${name}-LICENSE.txt`]=await readFile(new URL(`../design/vendor/${name}/LICENSE`,import.meta.url));
  files['source/licenses/Noto-OFL.txt']=await readFile(path.join(path.dirname(fontFile),'OFL.txt'));
  files['source/THIRD_PARTY_NOTICES.md']=strToU8('设计规则按仓库固定版本适配，原许可证见 licenses。GSAP 运行库使用其包内标准许可证，不因 Skill 的 MIT 许可而改变。源码仅供本地重新制作，不包含本机凭证或原始资料路径。');
  if(withFonts) {
    for(const name of ['NotoSansSC.ttf','NotoSansSC-Bold.ttf'])files[`source/fonts/${name}`]=await readFile(path.join(path.dirname(fontFile),name));
    const css='@font-face{font-family:"Noto Sans SC";font-weight:400;src:url(fonts/NotoSansSC.ttf)}@font-face{font-family:"Noto Sans SC";font-weight:700;src:url(fonts/NotoSansSC-Bold.ttf)}';
    for(const name of Object.keys(files).filter(name=>name.startsWith('source/')&&name.endsWith('.html')))files[name]=strToU8(Buffer.from(files[name]).toString('utf8').replace('</style>',()=>css+'</style>'));
  }
}
export async function getRenderAsset(handle: string, download = false) {
  restoreRenderState();
  if (!/^[a-f0-9-]{36}$/.test(handle)) throw new WorkflowError(400, '成品句柄无效。');
  const entry = assets.get(handle);
  const persisted = stateStore().get<{exportable:boolean}>('renderAssets', handle);
  if (!entry || Date.now() >= entry.expires) { await cleanup(); throw new WorkflowError(410, '成品已过期，请重新生成。'); }
  if(!persisted||typeof persisted.exportable!=='boolean')throw new WorkflowError(503,'成品资源索引损坏，已保留原记录。');
  entry.exportable=persisted.exportable;
  const bundle=stateStore().get<RenderBundle>('renderBundles',entry.group);
  if(!bundle)throw new WorkflowError(503,'成品组索引损坏，已保留原记录。');
  if(stateStore().entries<{delivery:{id:string;runId:string;platform:string;review:{status:string};expiresAt:string}}>('deliveries').some(([,s])=>s.delivery.review.status==='blocked'&&Date.parse(s.delivery.expiresAt)>Date.now()&&(s.delivery.id===bundle.deliveryId||s.delivery.runId===bundle.runId&&s.delivery.platform===bundle.platform)))entry.exportable=false;
  if ((download || entry.extension === 'zip' || entry.extension === 'mp4') && !entry.exportable) throw new WorkflowError(409, '本渠道审核尚未完成或已阻断，不能正式导出。');
  const data = await readFile(entry.file).catch(() => { assets.delete(handle); throw new WorkflowError(410, '成品文件已不可读取，请重新排版。'); });
  if(entry.sha256&&createHash('sha256').update(data).digest('hex')!==entry.sha256)throw new WorkflowError(503,'成品图片校验失败，已保留记录，未提供被更改的文件。');
  return { ...entry, data };
}

/** API whole-image posters are candidates until a person confirms all three checks. */
export async function publishPosterCandidate(result: RunResult, input: RenderRequest, media: {
  data: Buffer; width: number; height: number; sha256: string;
  creativeAsset: NonNullable<RenderBundle['creativeAssets']>[number];
  approval: Omit<PosterApproval, 'bundleId' | 'artifactId' | 'status' | 'createdAt' | 'expiresAt'>;
  design: unknown;
}, signal: AbortSignal): Promise<RenderBundle> {
  const releaseCandidate=await posterCandidateSlots.acquire(input.deliveryId||result.id,signal);
  try {
  restoreRenderState(); signal.throwIfAborted(); validateRender(result,input);
  if(input.platform!=='poster'||result.review.status==='blocked')throw new WorkflowError(409,'海报审核阻断或渠道不符，不能创建生图候选。');
  const expires=Date.parse(media.creativeAsset.expiresAt);
  if(expires<=Date.now()||!Number.isFinite(expires))throw new WorkflowError(410,'海报图片已过期，请明确重新生成。');
  if(createHash('sha256').update(media.data).digest('hex')!==media.sha256)throw new WorkflowError(503,'海报图片校验失败，已保留素材。');
  const cached=getRunBundles(result.id).find(bundle=>bundle.deliveryId===input.deliveryId&&bundle.creativeAssets?.[0]?.id===media.creativeAsset.id&&bundle.posterApproval?.sha256===media.sha256&&bundle.posterApproval.contentFingerprint===media.approval.contentFingerprint);
  if(cached)return cached;
  const group=randomUUID(),id=randomUUID(),file=path.join(root,group,`${id}.png`);
  try {
    await mkdir(path.join(root,group),{recursive:true});await writeFile(file,media.data);
    signal.throwIfAborted();validateRender(result,input);
    const approval:PosterApproval={...media.approval,status:'pending',bundleId:group,artifactId:id,createdAt:new Date().toISOString(),expiresAt:media.creativeAsset.expiresAt};
    const bundle:RenderBundle={id:group,kind:'static',runId:result.id,revision:result.revision,selectedTitleIndex:input.selectedTitleIndex,platform:'poster',templateId:input.templateId,deliveryId:input.deliveryId,
      artifacts:[{id,role:'poster',format:'png',name:'海报-待核对.png',previewUrl:`/api/render-assets/${id}`,width:media.width,height:media.height,sourceImageIds:approval.referenceImages.map(image=>image.id),factIds:approval.factChecks.map(fact=>fact.factId)}],
      reviewStatus:result.review.status,publication:'preview',rendererVersion:5,copyText:'',warnings:[approval.notice],expiresAt:approval.expiresAt,posterApproval:approval,creativeAssets:[media.creativeAsset]};
    const entry={file,group,expires,type:'image/png',extension:'png',name:'海报-待核对.png',exportable:false,sha256:media.sha256};
    await publishGroup(group,expires,signal);signal.throwIfAborted();validateRender(result,input);if(expires<=Date.now())throw new WorkflowError(410,'生成的海报已超过原有效期，请明确重新生成。');
    stateStore().update(b=>{(b.renderAssets||={})[id]=entry;(b.renderBundles||={})[group]=bundle;(b.posterPackages||={})[group]={design:media.design};});
    assets.set(id,entry);return bundle;
  }catch(error){await removeGroup(group);throw error;}
  }finally{releaseCandidate();}
}

/** Promotion never renews expiry or changes the bytes inspected by the user. */
export async function releasePosterCandidate(result:RunResult,input:RenderRequest,bundleId:string,checks:PosterChecks,assertCurrent:()=>void):Promise<RenderBundle>{
  return maintain(async()=>{
    if(checks.text!==true||checks.product!==true||checks.facts!==true)throw new WorkflowError(422,'请先逐项确认中文、产品型号外观和参数适用条件。');
    validateRender(result,input);assertCurrent();
    if(result.review.status==='blocked')throw new WorkflowError(409,'本渠道已阻断，不能确认海报。');
    const candidate=stateStore().get<RenderBundle>('renderBundles',bundleId),approval=candidate?.posterApproval;
    if(!candidate||!approval||candidate.deliveryId!==input.deliveryId)throw new WorkflowError(409,'海报候选与当前渠道不一致。');
    if(Date.parse(approval.expiresAt)<=Date.now())throw new WorkflowError(410,'海报已过期，请明确重新生成。');
    if(approval.status==='approved')return candidate;
    const originalIndex=stateStore().get<{file:string;group:string;expires:number}>('renderAssets',approval.artifactId);
    if(!originalIndex||originalIndex.group!==bundleId||originalIndex.expires<=Date.now()||path.dirname(path.resolve(originalIndex.file))!==path.join(root,bundleId))throw new WorkflowError(410,'待核对海报文件已过期或不可读取。');
    const original={data:await readFile(originalIndex.file).catch(()=>{throw new WorkflowError(410,'待核对海报文件已不可读取。');})};
    if(createHash('sha256').update(original.data).digest('hex')!==approval.sha256)throw new WorkflowError(503,'待核对海报文件已变化，未开放下载。');
    const id=randomUUID(),zipId=randomUUID(),imageFile=path.join(root,bundleId,`${id}.png`),zipFile=path.join(root,bundleId,`${zipId}.zip`);
    const approved:PosterApproval={...approval,status:'approved',approvedAt:new Date().toISOString(),checks};
    const files:Record<string,Uint8Array>={'海报.png':original.data};
    const packaged=stateStore().get<{design:Record<string,unknown>}>('posterPackages',bundleId);
    await sourceNotices(files);
    for(const [name,file]of [['canvas-design','canvas-design/LICENSE.txt'],['meitu-poster','meitu-poster/LICENSE'],['baoyu-skills','baoyu-skills/LICENSE']])files[`source/licenses/${name}-LICENSE.txt`]=await readFile(new URL(`../design/vendor/${file}`,import.meta.url));
    const exportReferences:{id:string;name:string;file:string}[]=[];
    for(const [index,image]of approval.referenceImages.entries()){const asset=await getAsset(image.url.split('/').pop()!);const ext=asset.contentType==='image/jpeg'?'jpg':asset.contentType==='image/webp'?'webp':'png',file=`核对原图/产品-${index+1}.${ext}`;files[file]=asset.data;exportReferences.push({id:image.id,name:image.name,file});}
    // Temporary local handles remain in the workbench only, never in a portable
    // customer artifact. The archive points to its own copied reference files.
    files['海报核对与来源.json']=strToU8(JSON.stringify({productName:result.product.name,approval:{...approved,referenceImages:exportReferences},creativeAssets:candidate.creativeAssets},null,2));
    if(packaged)files['source/design.json']=strToU8(JSON.stringify({...packaged.design,referenceImages:exportReferences},null,2));
    try{
      const zipBytes=Buffer.from(zipSync(files,{level:3}));await writeFile(imageFile,original.data);await writeFile(zipFile,zipBytes);
      validateRender(result,input);assertCurrent();if(Date.parse(approval.expiresAt)<=Date.now())throw new WorkflowError(410,'确认过程中海报已过期，未开放下载。');
      const expires=Date.parse(approval.expiresAt),entry={file:imageFile,group:bundleId,expires,type:'image/png',extension:'png',name:'海报.png',exportable:true,sha256:approval.sha256},zipEntry={file:zipFile,group:bundleId,expires,type:'application/zip',extension:'zip',name:'海报与核对来源.zip',exportable:true,sha256:createHash('sha256').update(zipBytes).digest('hex')};
      const url=`/api/render-assets/${id}`;
      const released:RenderBundle={...candidate,posterApproval:approved,publication:'released',copyText:'',zipUrl:`/api/render-assets/${zipId}?download=1`,artifacts:[{...candidate.artifacts[0],id,name:'海报.png',previewUrl:url,downloadUrl:`${url}?download=1`}]};
      stateStore().update(b=>{(b.renderAssets||={})[id]=entry;b.renderAssets[zipId]=zipEntry;(b.renderBundles||={})[bundleId]=released;});
      assets.set(id,entry);assets.set(zipId,zipEntry);return released;
    }catch(error){await Promise.all([rm(imageFile,{force:true}),rm(zipFile,{force:true})]);throw error;}
  });
}
async function removeGroup(group: string) {
  if (!/^[a-f0-9-]{36}$/.test(group)) return;
  for (const [id, asset] of assets) if (asset.group === group) assets.delete(id);
  groups.delete(group);
  stateStore().update(b => { for (const [id, value] of Object.entries(b.renderAssets || {})) if ((value as { group: string }).group === group) delete b.renderAssets[id]; delete b.renderBundles?.[group]; delete b.renderPrivate?.[group]; delete b.posterPackages?.[group]; });
  const target = path.resolve(root, group);
  if (path.dirname(target) !== root) throw new Error('Invalid render directory');
  await rm(target, { force: true, recursive: true });
}
async function cleanupNow() {
  for (const [id, expires] of groups) if (Date.now() >= expires) await removeGroup(id);
  // Also sweep expired files from earlier server processes; only our UUID directories qualify.
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name) || groups.has(entry.name)) continue;
    const info = await stat(path.join(root, entry.name)).catch(() => undefined);
    if (info && Date.now() - info.mtimeMs >= TTL) await removeGroup(entry.name);
  }
  while (groups.size > 20) await removeGroup(groups.keys().next().value!);
}
const cleanup = () => maintain(cleanupNow);
async function publishGroup(group: string, expires: number, signal: AbortSignal) {
  await maintain(async () => {
    signal.throwIfAborted();
    while (groups.size >= 20) await removeGroup(groups.keys().next().value!);
    signal.throwIfAborted(); groups.set(group, expires);
  });
}
const cleanupTimer = setInterval(() => { void cleanup().catch(() => {}); }, 60_000); cleanupTimer.unref();

export function readable(text: string, result: RunResult) {
  const refs = [...result.evidence.facts.map((f, i) => [f.id, `依据 ${i + 1}`]), ...result.evidence.images.map(i => [i.id, `图片「${i.name}」`]), ...result.evidence.sources.map(s => [s.id, `资料「${s.title}」`]), [result.product.id, result.product.name]].filter(([id]) => id.length).sort((a, b) => b[0].length - a[0].length);
  let output = text;
  for (const [id, label] of refs) output = output.split(id).join(label);
  for (const key of ['LLM_API_KEY', 'IMA_API_KEY', 'IMA_OPENAPI_APIKEY', 'IMA_CLIENT_ID', 'IMA_OPENAPI_CLIENTID']) if (process.env[key]) output = output.split(process.env[key]!).join('[已隐藏]');
  return output.replace(/https?:\/\/[^\s<>]+/g, '[链接已省略]')
    .replace(/\/api\/(?:assets|render-assets)\/[a-zA-Z0-9_-]+(?:\?[^\s<>]*)?/g, '[素材引用已省略]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n<>"']+|\\\\[^\\\s]+\\[^\r\n<>"']+|\/(?:home|Users|tmp|var|srv|mnt|opt|app|workspace|data)\/[^\r\n<>"']+/g, '[本地路径已省略]')
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, '[已隐藏]')
    .replace(/\b(?:img|image|fact|source|block|doc)[-_][a-zA-Z0-9_-]+\b/g, '对应资料');
}
export function copyDraft(draft: Draft, title: string) {
  return [title, draft.intro, ...draft.blocks.map(b => `${b.heading}\n${b.text}`), draft.cta, draft.tags.map(t => `#${t.replace(/^#/, '')}`).join(' ')].filter(Boolean).join('\n\n');
}
export function validateRender(result: RunResult, input: RenderRequest) {
  if(input.visualMode==='poster-image'&&input.platform!=='poster')throw new WorkflowError(422,'整图生图模式仅适用于海报。');
  if(input.visualMode==='html'&&!['wechat','xiaohongshu'].includes(input.platform))throw new WorkflowError(422,'HTML 制作模式当前仅适用于公众号和小红书。');
  const revoked=stateStore().entries<{delivery:{runId:string;platform:string;review:{status:string};expiresAt:string}}>('deliveries').some(([,s])=>s.delivery.runId===result.id&&s.delivery.platform===input.platform&&s.delivery.review.status==='blocked'&&Date.parse(s.delivery.expiresAt)>Date.now());
  if(revoked && result.review.status!=='blocked')throw new WorkflowError(409,'此渠道的交付资格已撤销，请重新核对与审稿后创建新版本。');
  assertEvidenceCurrent(result.evidence);
  if (!reusableEvidence(result.evidence)) throw new WorkflowError(410, '正文所用的 ima 资料已过期，请重新检索生成。');
  if (input.runId !== result.id || input.revision !== result.revision) throw new WorkflowError(409, '任务或正文版本不一致。');
  const template = renderTemplates.find(t => t.id === input.templateId && t.platform === input.platform);
  const draft = result.drafts.find(d => d.platform === input.platform);
  if (!template || !draft || !draft.titles[input.selectedTitleIndex]) throw new WorkflowError(400, '模板、平台或标题选择无效。');
  if (draft.platform === 'poster' && draft.blocks.length > 3) throw new WorkflowError(422, '门店海报最多三个卖点，请修改大纲后重新生成。');
  const images = draft.images.map(p => result.evidence.images.find(i => i.id === p.imageId && i.productId === result.product.id));
  if (images.some(i => !i) || new Set(images.map(i => i?.id)).size !== images.length) throw new WorkflowError(422, '配图失效、重复或与当前型号不一致，请重新检索后生成。');
  assertChannelImageCount(input.platform, images.length);
  return { template, draft, images: images as NonNullable<typeof images[number]>[], title: draft.titles[input.selectedTitleIndex] };
}
export async function renderRun(result: RunResult, input: RenderRequest, callerSignal?: AbortSignal, options: { publication?: 'preview'; expiresAt?: string; externalFiles?: {data:Buffer;name:string;mimeType:string;width?:number;height?:number;role?:RenderArtifact['role']}[]; externalDesigns?: RenderBundle['externalDesigns']; creativeAssets?:RenderBundle['creativeAssets']; background?:RenderImage; design?:unknown; warnings?:string[] } = {}): Promise<RenderBundle> {
  if(input.visualMode==='poster-image')throw new WorkflowError(409,'API 海报须通过后台生图并完成人工核对后开放下载。');
  restoreRenderState();
  const { template, draft, images: sourceImages, title } = validateRender(result, input);
  callerSignal?.throwIfAborted();
  const preview = options.publication === 'preview';
  const publicationIdentity=input.visualMode==='html'?JSON.stringify({publication:preview?'preview':'released',version:HTML_DESIGN_VERSION,skills:HTML_SKILL_HASHES,background:options.background?createHash('sha256').update(options.background.uri).digest('hex'):undefined,creative:options.creativeAssets?.map(a=>a.sha256),design:options.design}):options.externalDesigns?.length?`${preview?'preview':'released'}:${JSON.stringify(options.externalDesigns)}`:preview?'preview':'released';
  const identity = renderIdentity(result, input, publicationIdentity);
  const cached = stateStore().entries<PrivateBundle>('renderPrivate').find(([, item]) => item.identity === identity && item.expires > Date.now());
  if (cached) {
    const bundle = getRunBundles(result.id).find(bundle => bundle.id === cached[0]);
    if (bundle) return bundle;
  }
  let release: () => void;
  try { release = await renderSlots.acquire(result.id, callerSignal); }
  catch { throw new WorkflowError(499, '排版已取消。'); }
  const timeout = AbortSignal.timeout(90_000);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const group = randomUUID();
  try {
    await cleanup(); signal.throwIfAborted();
    // Source validity may have changed while this request waited for a render slot.
    validateRender(result, input);
    const images: RenderImage[] = [];
    for (const image of sourceImages) {
      signal.throwIfAborted();
      if (!/^\/api\/assets\/[a-zA-Z0-9_-]{1,100}$/.test(image.url)) throw new WorkflowError(422, '素材引用不可用，请重新检索产品图片。');
      const original = await getAsset(image.url.split('/').pop()!).catch(() => { throw new WorkflowError(410, '原始图片已过期或不可读取，请重新生成正文。'); });
      signal.throwIfAborted();
      const converted = await convertedImage(original.data);
      signal.throwIfAborted();
      images.push({ id: image.id, uri: `data:image/png;base64,${converted.data.toString('base64')}`, name: image.name, width: converted.info.width, height: converted.info.height });
    }
    const exportable = !preview && result.review.status !== 'blocked';
    const marker = '';
    const warnings = [...result.evidence.warnings,...(options.warnings||[]), ...(result.review.status !== 'passed' ? ['请逐项查看审核面板；排版不改变原有审核结论。'] : []), ...(result.brief.mode === 'demo' ? ['本地规则演示，未调用模型或验证 ima。'] : [])];
    const expires = options.expiresAt ? Date.parse(options.expiresAt) : Date.now() + TTL;
    if (!Number.isFinite(expires) || expires <= Date.now()) throw new WorkflowError(410, '原成品已过期，请主动重新排版。');
    await mkdir(path.join(root, group), { recursive: true });
    const files: Record<string, Uint8Array> = {};
    const privateFiles: PrivateArtifact[] = [];
    const artifacts: RenderArtifact[] = [];
    async function save(data: Buffer, name: string, role: RenderArtifact['role'], format: RenderArtifact['format'], sourceImageIds: string[], factIds: string[], width?: number, height?: number, mimeType?: string) {
      const id = randomUUID(); const extension = format === 'png' ? 'png' : format === 'original' ? mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png' : 'html';
      const file = path.join(root, group, `${id}.${extension}`);
      signal.throwIfAborted();
      if (preview) {
        const privateFile = path.join(root, group, `${id}.private.${extension}`);
        await writeFile(privateFile, data);
        privateFiles.push({ file: privateFile, name, role, format, sourceImageIds, factIds: [...new Set(factIds)], width, height, mimeType });
      }
      await writeFile(file, data); signal.throwIfAborted();
      assets.set(id, { file, group, expires, type: mimeType || (format === 'png' ? 'image/png' : 'text/html; charset=utf-8'), extension, name, exportable }); files[name] = data;
      const url = `/api/render-assets/${id}`;
      artifacts.push({ id, role, format, name, previewUrl: url, ...(exportable ? { downloadUrl: `${url}?download=1` } : {}), width, height, sourceImageIds, factIds: [...new Set(factIds)] });
    }
    if (input.platform === 'moments') {
      for (const image of sourceImages.slice(0, 3)) {
        const original = await getAsset(image.url.split('/').pop()!);
        const metadata = await sharp(original.data).metadata();
        const mime = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'webp' ? 'image/webp' : 'image/png';
        const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format === 'webp' ? 'webp' : 'png';
        await save(original.data, `朋友圈-${sourceImages.indexOf(image)+1}.${extension}`, 'card', 'original', [image.id], [], metadata.width, metadata.height, mime);
      }
    } else if (input.platform === 'wechat') {
      const allFacts = draft.blocks.flatMap(b => b.factIds);
      const professional=input.visualMode==='html'?await renderWechatArticleWithSource(draft,title,images,template,signal,{background:options.background,productName:result.product.name}):undefined;
      const html = professional?.html || await renderWechatArticle(draft, title, images, template, marker, signal);
      await save(Buffer.from(html), '公众号-排版文章.html', 'article', 'wechat-richtext', images.map(i => i.id), allFacts);
      if(professional){files['source/article.html']=strToU8(html);files['source/design.json']=strToU8(JSON.stringify({article:professional.design,brief:options.design},null,2));}
      const coverTemplate = { ...template, width: 1200, height: 510, platform: 'moments' as const };
      const htmlCover=professional?await renderHtmlWechatCover(title,result.product.name,images,template,signal,{background:options.background}):undefined;
      const cover = htmlCover?.data || options.externalFiles?.[0]?.data || await renderEditorialCover(title, images.slice(0, 1), coverTemplate, marker, result.product.name, signal);
      if(htmlCover)files['source/cover.html']=strToU8(htmlCover.html);
      if (process.env.RENDER_DEBUG === '1') console.log('render:wechat:cover:done');
      await save(cover, '公众号-封面.png', 'cover', 'png', images.slice(0, 1).map(i => i.id), [], 1200, 510);
      warnings.push('公众号文章中的图片为嵌入式预览，尚未上传微信素材库。粘贴到微信后请逐张上传或替换，并核对移动端显示。未自动发布。');
    } else if (options.externalFiles?.length) {
      for (const [index, file] of options.externalFiles.entries()) await save(file.data, file.name || `${filenames[input.platform]}-${index+1}.png`, file.role || (input.platform === 'poster' ? 'poster' : index === 0 ? 'cover' : 'card'), 'png', images.map(i=>i.id), draft.blocks.flatMap(b=>b.factIds), file.width || template.width, file.height || template.height);
    } else if (input.platform === 'xiaohongshu') {
      const pages = input.visualMode==='html'?planHtmlXhs(draft,title,images):planXhs(draft, title, images);
      const professional=input.visualMode==='html'?await renderXhsWithSource(pages,template,result.product.name,signal,{background:options.background}):undefined;
      const pngs = professional?.pages.map(page=>page.data) || await renderXhs(planXhs(draft,title,images), template, marker, result.product.name, signal);
      if(professional){professional.pages.forEach((page,index)=>{files[`source/page-${String(index+1).padStart(2,'0')}.html`]=strToU8(page.html);});files['source/design.json']=strToU8(JSON.stringify({composition:professional.design,brief:options.design},null,2));}
      for (let i = 0; i < pages.length; i++) await save(pngs[i], `小红书-${String(i + 1).padStart(2, '0')}.png`, pages[i].role, 'png', pages[i].images.map(image => image.id), pages[i].factIds, 1080, 1440);
    } else {
      const png = input.platform === 'poster'
        ? await renderStorePoster(draft, title, images, template, marker, result.product.name, signal)
        : await renderMomentsCard(draft, title, images, template, marker, result.product.name, signal);
      await save(png, `${filenames[input.platform]}-01.png`, input.platform === 'poster' ? 'poster' : 'card', 'png', images.map(image => image.id), draft.blocks.flatMap(block => block.factIds), template.width, template.height);
    }
    const copyText = readable(copyDraft(draft, title), result);
    if(input.visualMode==='html') {
      for(const [index,image]of sourceImages.entries()) {
        const original=await getAsset(image.url.split('/').pop()!);
        const ext=original.contentType==='image/jpeg'?'jpg':original.contentType==='image/webp'?'webp':'png';
        files[`配图/产品-${index+1}.${ext}`]=original.data;
      }
      if(options.background)files['source/background.png']=Buffer.from(options.background.uri.split(',')[1],'base64');
      files['制作与使用说明.txt']=strToU8('HTML 为制作源文件。公众号请复制富文本，并在微信后台上传配图和封面；小红书上传 PNG 和独立文案。未自动发布，未接入微信草稿箱。source 目录供重新制作，不含凭证。');
      await sourceNotices(files,true);
    }
    files['文案.txt'] = strToU8(copyText);
    const sourcesMarkdown = readable([`# ${result.product.name} · ${filenames[input.platform]}`, `审核结论：${result.review.status === 'blocked' ? '审核阻断' : result.review.status === 'needs_attention' ? '待确认' : '检查通过'}`, result.notice,
      ...result.evidence.facts.filter(f => draft.blocks.some(b => b.factIds.includes(f.id))).map(f => `- ${f.statement}\n  条件：${f.qualifiers.join('；') || '详见原文'}\n  来源：${f.sourceTitle}`),
      ...(options.creativeAssets||[]).map(a=>`- AI 场景背景（非产品证据）：${a.model}；规则 ${a.skillVersion}；Prompt SHA-256 ${a.promptHash}；素材 SHA-256 ${a.sha256}`), ...sourceImages.map(i => `- 图片「${i.name}」：${i.sourceTitle}`), ...result.review.issues.map(i => `- ${i.message} ${i.suggestion}`), ...warnings,
    ].join('\n\n'), result);
    files['来源与审核.md'] = strToU8(sourcesMarkdown);
    let zipUrl: string | undefined;
    if (exportable) {
      const id = randomUUID(); const file = path.join(root, group, `${id}.zip`); const name = `${filenames[input.platform]}-成品与来源.zip`;
      await writeFile(file, zipSync(files, { level: 3 })); assets.set(id, { file, group, expires, type: 'application/zip', extension: 'zip', name, exportable }); zipUrl = `/api/render-assets/${id}?download=1`;
    }
    signal.throwIfAborted(); validateRender(result, input); await publishGroup(group, expires, signal);
    const bundle: RenderBundle = { id: group, runId: result.id, revision: result.revision, selectedTitleIndex: input.selectedTitleIndex, platform: input.platform, templateId: template.id,
      artifacts,kind:'static', reviewStatus: result.review.status, publication: preview ? 'preview' : exportable ? 'released' : 'blocked', rendererVersion: input.visualMode==='html'?4:3, deliveryId: input.deliveryId, externalDesigns: options.externalDesigns, creativeAssets:options.creativeAssets, warnings, copyText: exportable ? copyText : '', zipUrl, expiresAt: new Date(expires).toISOString() };
    signal.throwIfAborted(); validateRender(result, input);
    stateStore().update(b => { b.renderAssets ||= {}; for (const [id, asset] of assets) if (asset.group === group) b.renderAssets[id] = asset; (b.renderBundles ||= {})[group] = bundle; (b.renderPrivate ||= {})[group] = { identity, runId: result.id, input, expires, pending: preview, files: privateFiles, copyText, sourcesMarkdown } satisfies PrivateBundle; });
    return bundle;
  } catch (error) {
    await removeGroup(group);
    if (process.env.RENDER_DEBUG === '1') console.error(error instanceof Error ? error.message.slice(0, 600) : 'render error');
    if (callerSignal?.aborted) throw new WorkflowError(499, '排版已取消。');
    if (timeout.aborted) throw new WorkflowError(504, '排版超过 90 秒，请稍后重试或减少文字。');
    if (error instanceof WorkflowError || error instanceof KnowledgeError) throw error;
    throw new WorkflowError(500, '排版失败，请检查图片、字体或渲染运行时；正文已保留。');
  } finally { release(); }
}

/** A video owns a separate group; it never replaces or renews a static bundle. */
export async function publishVideoBundle(result: RunResult, input: RenderRequest, media: {
  data: Buffer; cover: Buffer; html: string; storyboard: unknown;
  width: number; height: number; durationSeconds: number; fps: number; frameCount: number;
}, options: { expiresAt: string; fingerprint: string; creativeAssets?: RenderBundle['creativeAssets']; assertCurrent: () => void; videoScript?:VideoScript; videoScriptReview?:VideoScriptReview }, signal: AbortSignal): Promise<RenderBundle> {
  restoreRenderState(); signal.throwIfAborted();
  validateRender(result,input); options.assertCurrent();
  if(result.review.status==='blocked')throw new WorkflowError(409,'本渠道审核阻断，不能制作正式视频。');
  if(options.videoScript&&(options.videoScriptReview?.status!=='passed'||options.videoScriptReview.issues.some(issue=>issue.severity==='error')))throw new WorkflowError(409,'视频短稿尚未通过独立审稿，不能发布视频。');
  const expires=Date.parse(options.expiresAt);
  if(!Number.isFinite(expires)||expires<=Date.now())throw new WorkflowError(410,'视频所用素材或图文已过期，请重新准备后生成。');
  const group=randomUUID();
  try {
    await mkdir(path.join(root,group),{recursive:true});
    const artifacts:RenderArtifact[]=[], files:Record<string,Uint8Array>={};
    const sourceImageIds=result.drafts[0].images.map(i=>i.imageId),factIds=[...new Set(options.videoScript?options.videoScript.scenes.flatMap(scene=>scene.factIds):result.drafts[0].blocks.flatMap(b=>b.factIds))];
    for(const item of [{data:media.data,name:'产品动效-20秒.mp4',role:'video' as const,format:'mp4' as const,type:'video/mp4',extension:'mp4'},
      {data:media.cover,name:'视频封面.png',role:'cover' as const,format:'png' as const,type:'image/png',extension:'png'}]) {
      signal.throwIfAborted();const id=randomUUID(),file=path.join(root,group,`${id}.${item.extension}`);
      await writeFile(file,item.data);
      assets.set(id,{file,group,expires,type:item.type,extension:item.extension,name:item.name,exportable:true});files[item.name]=item.data;
      const url=`/api/render-assets/${id}`;
      artifacts.push({id,role:item.role,format:item.format,name:item.name,previewUrl:url,downloadUrl:`${url}?download=1`,width:media.width,height:media.height,sourceImageIds,factIds,
        ...(item.format==='mp4'?{durationSeconds:media.durationSeconds,fps:media.fps,frameCount:media.frameCount}:{})});
    }
    files['source/video.html']=strToU8(media.html);
    files['source/storyboard.json']=strToU8(JSON.stringify(media.storyboard,null,2));
    if(options.videoScript)files['source/video-script.json']=strToU8(JSON.stringify(options.videoScript,null,2));
    if(options.videoScriptReview)files['source/video-review.json']=strToU8(JSON.stringify(options.videoScriptReview,null,2));
    await sourceNotices(files);
    const videoCopy=options.videoScript?[options.videoScript.title,...options.videoScript.scenes.map(scene=>[scene.heading,scene.text,...scene.conditions.filter(condition=>condition.mode==='display').map(condition=>`适用条件：${condition.text}`)].filter(Boolean).join('\n')),options.videoScript.cta].filter(Boolean).join('\n\n'):copyDraft(result.drafts[0],result.drafts[0].titles[input.selectedTitleIndex]);
    files['文案.txt']=strToU8(readable(videoCopy,result));
    files['来源与审核.md']=strToU8(readable([`# ${result.product.name} · 视频来源`,`原图文审核结论：${result.review.status}`,
      ...(options.videoScriptReview?[`视频短稿独立审稿结论：${options.videoScriptReview.status}；审稿方式：${options.videoScriptReview.reviewedBy}；时间：${options.videoScriptReview.checkedAt}`, ...options.videoScriptReview.issues.map(issue=>`${issue.message} ${issue.suggestion}`)]:[]),
      ...result.evidence.facts.filter(f=>factIds.includes(f.id)).map(f=>`${f.statement}\n条件：${f.qualifiers.join('；')}\n来源：${f.sourceTitle}`),
      ...result.review.issues.map(i=>`${i.message} ${i.suggestion}`),
      ...(options.creativeAssets||[]).map(a=>`AI 背景（非产品证据）：${a.model}；Prompt SHA-256 ${a.promptHash}；素材 SHA-256 ${a.sha256}`)].join('\n\n'),result));
    const zipId=randomUUID(),zipFile=path.join(root,group,`${zipId}.zip`);
    await writeFile(zipFile,zipSync(files,{level:3}));
    assets.set(zipId,{file:zipFile,group,expires,type:'application/zip',extension:'zip',name:'产品视频与源码.zip',exportable:true});
    const bundle:RenderBundle={id:group,kind:'video',runId:result.id,revision:result.revision,platform:input.platform,templateId:input.templateId,selectedTitleIndex:input.selectedTitleIndex,
      deliveryId:input.deliveryId,artifacts,reviewStatus:options.videoScriptReview?.status||result.review.status,publication:'released',rendererVersion:4,sourceFingerprint:options.fingerprint,
      creativeAssets:options.creativeAssets,warnings:[...result.review.issues.filter(i=>i.severity!=='info').map(i=>i.message),...(options.videoScriptReview?.issues.map(issue=>issue.message)||[])],copyText:'',zipUrl:`/api/render-assets/${zipId}?download=1`,expiresAt:options.expiresAt};
    signal.throwIfAborted();validateRender(result,input);options.assertCurrent();await publishGroup(group,expires,signal);
    signal.throwIfAborted();options.assertCurrent();
    stateStore().update(b=>{b.renderAssets||={};for(const [id,asset]of assets)if(asset.group===group)b.renderAssets[id]=asset;(b.renderBundles||={})[group]=bundle;});
    return bundle;
  } catch(error) {await removeGroup(group);throw error;}
}

/** Promote only after the complete, selected-channel report exists; retain every original expiry. */
export async function publishRunBundles(result: RunResult, signal?: AbortSignal): Promise<RenderBundle[]> {
  restoreRenderState();
  const selected = new Set(result.brief.platforms);
  if (selected.size !== result.brief.platforms.length || result.drafts.length !== selected.size || result.drafts.some(d => !selected.has(d.platform)) || new Set(result.drafts.map(d => d.platform)).size !== selected.size) {
    throw new WorkflowError(409, '全部所选渠道终审完成后才可发布正式成品。');
  }
  const release = await renderSlots.acquire(result.id, signal);
  try {
    return await maintain(async () => {
      signal?.throwIfAborted();
      const published: RenderBundle[] = [];
      const pendingAssets = new Map<string, typeof assets extends Map<string, infer V> ? V : never>();
      const privateUpdates = new Map<string, PrivateBundle>();
      const exportable = result.review.status !== 'blocked';
      const marker = exportable ? result.review.status === 'passed' ? '内容检查通过 · 发布前复核' : '待确认 · 发布前复核' : '审核阻断 · 仅供预览';
      for (const [group, privateBundle] of stateStore().entries<PrivateBundle>('renderPrivate')) {
        if (privateBundle.runId !== result.id || privateBundle.expires <= Date.now() || !privateBundle.pending) continue;
        const previous = stateStore().get<RenderBundle>('renderBundles', group);
        if (!previous || Date.parse(previous.expiresAt) <= Date.now()) continue;
        const { draft, title } = validateRender(result, privateBundle.input);
        const artifacts: RenderArtifact[] = [];
        const files: Record<string, Uint8Array> = {};
        const newAsset = async (data: Buffer, name: string, format: string, mime?:string) => {
          const id = randomUUID(), extension = format === 'png' ? 'png' : format === 'original' ? mime === 'image/jpeg' ? 'jpg' : mime==='image/webp'?'webp':'png' : format === 'zip' ? 'zip' : 'html';
          const file = path.join(root, group, `${id}.${extension}`);
          signal?.throwIfAborted(); await writeFile(file, data); signal?.throwIfAborted();
          pendingAssets.set(id, { file, group, expires: privateBundle.expires, type: mime || (extension === 'png' ? 'image/png' : extension === 'zip' ? 'application/zip' : 'text/html; charset=utf-8'), extension, name, exportable });
          return id;
        };
        for (const item of privateBundle.files) {
          if (path.dirname(path.resolve(item.file)) !== path.join(root, group) || !/^[a-f0-9-]{36}\.private\.(?:png|html)$/.test(path.basename(item.file))) throw new WorkflowError(503, '成品私有索引损坏，已保留记录，请检查本地存储。');
          let data: Buffer = await readFile(item.file).catch(() => { throw new WorkflowError(410, '预览底稿已过期或不可读取，请重新排版；正文已保留。'); });
          const id = await newAsset(data, item.name, item.format, item.mimeType);
          const url = `/api/render-assets/${id}`;
          const { file: _privateFile, mimeType:_mimeType, ...artifact } = item;
          artifacts.push({ ...artifact, id, previewUrl: url, ...(exportable ? { downloadUrl: `${url}?download=1` } : {}) });
          files[item.name] = data;
        }
        const copyText = readable(copyDraft(draft, title), result);
        files['文案.txt'] = strToU8(copyText);
        files['来源与审核.md'] = strToU8(readable(`${privateBundle.sourcesMarkdown}\n\n## 整组终审\n${marker}\n${result.review.issues.map(issue => `- ${issue.message} ${issue.suggestion}`).join('\n')}`, result));
        let zipUrl: string | undefined;
        if (exportable) {
          const id = await newAsset(Buffer.from(zipSync(files, { level: 3 })), `${filenames[previous.platform]}-成品与来源.zip`, 'zip');
          zipUrl = `/api/render-assets/${id}?download=1`;
        }
        published.push({ ...previous, artifacts, copyText: exportable ? copyText : '', reviewStatus: result.review.status,
          warnings: [...new Set([...previous.warnings, ...result.review.issues.filter(issue => issue.severity !== 'info').map(issue => issue.message)])],
          publication: exportable ? 'released' : 'blocked', zipUrl });
        privateUpdates.set(group, { ...privateBundle, identity: renderIdentity(result, privateBundle.input, 'released'), pending: false });
      }
      signal?.throwIfAborted();
      assertEvidenceCurrent(result.evidence);
      if (!reusableEvidence(result.evidence)) throw new WorkflowError(410, '等待终审发布时资料已过期，请重新取证；历史正文仍可阅读。');
      // No clean handle is registered until every selected bundle is prepared and the atomic commit succeeds.
      if (published.length) {
        stateStore().update(b => {
          b.renderAssets ||= {}; b.renderBundles ||= {}; b.renderPrivate ||= {};
          for (const [id, asset] of pendingAssets) b.renderAssets[id] = asset;
          for (const bundle of published) b.renderBundles[bundle.id] = bundle;
          for (const [id, bundle] of privateUpdates) b.renderPrivate[id] = bundle;
        });
        for (const [id, asset] of pendingAssets) assets.set(id, asset);
      }
      return getRunBundles(result.id);
    });
  } finally { release(); }
}
