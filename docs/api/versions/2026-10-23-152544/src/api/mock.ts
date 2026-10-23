import fixture from './fixtures/frontend.mock.json';
import previews from './fixtures/previews.json';
import sourcePreviews from './fixtures/source-previews.json';
import videoFixture from './fixtures/video.mock.json';
import { strToU8, zipSync } from 'fflate';
import { PLATFORMS, type ChannelDelivery, type BackgroundJob, type JobInput, type JobSubmit, type JobStage, type AppStatus, type Brief, type HistoryItem, type HistoryMetadata, type OutlineResult, type Platform, type PlatformOutline, type RenderArtifact, type RenderBundle, type RenderRequest, type ReviewReport, type RunDetail, type RunResult, type TraceEntry, type PosterApproval, type VideoScript } from '../../shared/types';
import type { MockScenario, Transport } from './mode';
export { mockScenario } from './mode';
export type { MockScenario, Transport } from './mode';

const clone = <T,>(value: T): T => structuredClone(value);
const baseOutline = clone(fixture.fourChannelOutline) as unknown as OutlineResult;
baseOutline.evidence.images.forEach(image => { image.url = sourcePreviews[image.id as keyof typeof sourcePreviews] || image.url; });
const baseResult = fixture.fourChannelResult as unknown as RunResult;
const TTL = 30 * 60_000;
const HISTORY_TTL = 7 * 24 * 60 * 60_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const failure = (status: number, message: string) => json({ message: `纯模拟：${message}` }, status);
const escaped = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
function delay(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
function dataBytes(url: string) {
  const split = url.indexOf(','); const header = url.slice(5, split);
  const bytes = header.endsWith(';base64') ? Uint8Array.from(atob(url.slice(split + 1)), c => c.charCodeAt(0)) : strToU8(decodeURIComponent(url.slice(split + 1)));
  return { bytes, type: header.replace(/;base64$/, '') };
}

/** Stateful, browser-local simulation. Unknown routes and URLs fail closed; there is no real fetch fallback. */
export function createMockTransport(scenario: MockScenario, options: { latencyMs?: number; now?: () => number; evidenceExpiresAt?: number; canvaConnected?: boolean; imageConfigured?: boolean; canvaContentChanged?: boolean; videoFailureStage?: JobStage; videoReviewBlocked?: boolean; onStage?: (jobId: string, platform: Platform, stage: JobStage) => void } = {}): Transport {
  const latency = options.latencyMs ?? (scenario === 'slow' ? 1500 : 180);
  const now = options.now || Date.now;
  const outlines = new Map<string, { value: OutlineResult; touched: number }>();
  const runs = new Map<string, { value: RunResult; snapshot: OutlineResult; touched: number; expiresAt: string }>();
  const deliveries = new Map<string,ChannelDelivery>();
  const deliverySources = new Map<string,RunResult>();
  const generatedVisuals = new Map<string,number>();
  const bundles = new Map<string, RenderBundle>();
  const jobs = new Map<string, BackgroundJob>();
  const jobAliases = new Map<string, string>();
  const videoSources = new Map<string, string>();
  const videoTextSources = new Map<string, string>();
  const videoTextKey = (d:ChannelDelivery) => { const {images:_,...draft}=d.draft;return JSON.stringify({brief:d.brief,product:d.product,draft,review:d.review,facts:deliverySources.get(d.id)?.evidence.facts}); };
  const jobControllers = new Map<string, AbortController>();
  const jobResults = new Map<string, RunResult>();
  const injectedJobFailures = new Set<string>();
  const jobCheckpoints = new Map<string, Set<string>>();
  const watchers = new Set<(jobs: BackgroundJob[]) => void>();
  const compactJob = (job: BackgroundJob): BackgroundJob => {
    if (job.status === 'running') return clone(job);
    const value = clone(job); value.detailOmitted = true;
    value.summary = { productName: job.outline?.product.name || job.result?.product.name || '纯模拟任务', scene: job.outline?.brief.scene || (job.input.kind === 'outline' ? job.input.brief.scene : ''), audience: job.outline?.brief.audience || (job.input.kind === 'outline' ? job.input.brief.audience : '') };
    delete value.outline; delete value.result; delete value.videoBundle; value.calls = []; value.renderBundles = []; value.channels.forEach(channel => { delete channel.preview; delete channel.delivery; });
    return value;
  };
  const notify = () => { const snapshot = [...jobs.values()].map(compactJob); for (const watcher of watchers) watcher(snapshot); };
  const touch = (job: BackgroundJob) => { job.updatedAt = new Date(now()).toISOString(); notify(); };
  const resources = new Map<string, { bytes: Uint8Array; type: string; name: string; expires: number; deliveryId?: string; exportable?: boolean }>();
  // Only fixture assets and HTML composed below may be read as data URLs.
  const dataResources = new Map<string, { bytes: Uint8Array; type: string }>();
  for (const url of [videoFixture.url, ...Object.values(previews), ...baseOutline.evidence.images.map(i => i.url), ...fixture.products.products.map(p => p.coverUrl)]) if (url?.startsWith('data:')) dataResources.set(url, dataBytes(url));
  let counter = 0; let injectedConflict = false; let injectedExpiry = false;
  const status = clone(fixture.status) as AppStatus;
  status.image={configured:!!options.imageConfigured,name:'gpt-image-2.5',baseUrl:'https://relay.styxgate.top/v1'};delete status.canva;
  const taskOptions = clone(fixture.taskOptions); taskOptions.platforms.forEach(platform => { platform.minImages = 1; });
  const renderTemplates = clone(fixture.renderTemplates); renderTemplates.templates.forEach(template => {
    if (template.platform === 'wechat') { template.height = 510; template.name = template.id === 'wechat-editorial' ? '公众号 · 杂志阅读' : '公众号 · 清单手记'; }
    if (template.platform === 'moments') template.name = template.id === 'moments-square' ? '朋友圈 · 精选原图' : '朋友圈 · 场景原图';
  });
  status.ima.message = '纯模拟：未连接 ima，保存和验证不会使用真实凭证。';
  status.local = { available: scenario !== 'empty', productCount: scenario === 'empty' ? 0 : fixture.products.products.length, imageCount: scenario === 'empty' ? 0 : scenario === 'insufficient-images' ? 0 : baseOutline.evidence.images.length };
  const id = (kind: string) => `mock-${kind}-${++counter}`;
  const progress = (fixture.progressEvents as unknown as { entry: TraceEntry }[]).map(e => e.entry);
  const metadata = (expiresAt: string): HistoryMetadata => ({ expiresAt, evidenceStatus: now() >= (options.evidenceExpiresAt ?? Infinity) ? 'refresh_required' : 'ready' });
  const imageCountsValid = (outline: OutlineResult, platforms = outline.platforms) => platforms.every(p => { const bounds = taskOptions.platforms.find(b => b.id === p.platform);
    return !!bounds && p.imageIds.length >= bounds.minImages && p.imageIds.length <= bounds.maxImages && new Set(p.imageIds).size === p.imageIds.length && p.imageIds.every(id => outline.evidence.images.some(image => image.id === id && image.productId === outline.product.id)); });
  const getOutline = (outlineId: string): OutlineResult | undefined => {
    const entry = outlines.get(outlineId);
    if (!entry || Date.parse(entry.value.history!.expiresAt) <= now()) { outlines.delete(outlineId); return; }
    entry.value.history = metadata(entry.value.history!.expiresAt); return entry.value;
  };
  const getRun = (runId: string): RunResult | undefined => {
    const entry = runs.get(runId);
    if (!entry || Date.parse(entry.expiresAt) <= now()) { runs.delete(runId); return; }
    return entry.value;
  };
  function saveResource(bytes: Uint8Array, type: string, name: string, expires = now() + TTL, deliveryId?: string, exportable = true) {
    const url = `/__mock/resources/${id('asset')}`;
    resources.set(url, { bytes, type, name, expires, deliveryId, exportable }); return url;
  }
  function makeResult(snapshot: OutlineResult) {
    const result = clone(baseResult); result.id = id('run'); result.createdAt = new Date().toISOString();
    result.brief = snapshot.brief; result.product = snapshot.product; result.evidence = snapshot.evidence;
    result.outline = { id: snapshot.id, version: snapshot.version }; result.revision = 1;
    result.notice = '纯模拟数据：未调用模型或 ima，文案与几何素材不可作为产品事实或公开发布材料。';
    result.strategies = result.strategies.filter(s => snapshot.brief.platforms.includes(s.platform));
    result.drafts = snapshot.platforms.map(p => ({ id: id('draft'), platform: p.platform, titles: [p.title], intro: p.intro,
      blocks: p.sections.map(s => ({ id: s.id, heading: s.heading, text: s.points.join('\n'), factIds: s.factIds })),
      cta: p.cta, tags: [], images: p.imageIds.map((imageId, i) => ({ imageId, afterBlock: Math.min(i - 1, p.sections.length - 1), caption: '纯模拟占位图', reason: '仅用于验证配图交互' })) }));
    if (scenario === 'blocked') result.review = clone(fixture.variants.blockedReview) as ReviewReport;
    return result;
  }
  function generation(outline: OutlineResult, signal?: AbortSignal | null) {
    const snapshot = clone(outline); const cancel = new AbortController();
    const combined = signal ? AbortSignal.any([signal, cancel.signal]) : cancel.signal;
    let step = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          await delay(latency, combined); combined.throwIfAborted();
          if (step < progress.length) {
            const entry = { ...progress[step++], detail: '纯模拟进度，没有调用模型或知识库。', at: new Date().toISOString() };
            controller.enqueue(strToU8(`: mock heartbeat\r\n\r\ndata: ${JSON.stringify({ type: 'progress', entry })}\r\n\r\n`)); return;
          }
          if (scenario === 'disconnected') { controller.close(); return; }
          if (scenario === 'error') {
            controller.enqueue(strToU8(`data: ${JSON.stringify({ type: 'error', message: '纯模拟：生成服务发生错误，请重试。' })}\n\n`)); controller.close(); return;
          }
          const result = makeResult(snapshot);
          runs.set(result.id, { value: clone(result), snapshot: clone(snapshot), touched: now(), expiresAt: new Date(now() + HISTORY_TTL).toISOString() });
          controller.enqueue(strToU8(`data: ${JSON.stringify({ type: 'result', result })}\n\n`)); controller.close();
        } catch (error) { if (!cancel.signal.aborted) controller.error(error); }
      },
      cancel() { cancel.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  }
  function render(input: RenderRequest, previewResult?: RunResult) {
    const delivery=input.deliveryId?deliveries.get(input.deliveryId):undefined;
    const result = delivery ? {...clone(deliverySources.get(delivery.id) || baseResult),id:delivery.runId,revision:delivery.revision,brief:delivery.brief,product:delivery.product,drafts:[delivery.draft],review:delivery.review} : previewResult || getRun(input.runId);
    if (!result) return failure(410, '正文任务已过期，请重新生成。');
    if (!previewResult && !delivery && metadata(runs.get(input.runId)!.expiresAt).evidenceStatus !== 'ready') return failure(410, '历史来源需要重新获取，请按原任务重新策划。');
    if (result.revision !== input.revision) return failure(409, '正文版本不一致。');
    const draft = result.drafts.find(d => d.platform === input.platform);
    const template = renderTemplates.templates.find(t => t.platform === input.platform && t.id === input.templateId);
    if (!draft || !template || !draft.titles[input.selectedTitleIndex]) return failure(400, '模板、渠道或标题无效。');
    const bounds = taskOptions.platforms.find(p => p.id === input.platform)!;
    if (draft.images.length < bounds.minImages || draft.images.length > bounds.maxImages) return failure(422, '同型号素材数量不足，请补足素材后重新生成。');
    const exportable = (Boolean(delivery)||!previewResult) && result.review.status !== 'blocked'; const artifacts: RenderArtifact[] = [];
    const expires = delivery?.bundle && Date.parse(delivery.bundle.expiresAt) > now() ? Date.parse(delivery.bundle.expiresAt) : now() + TTL;
    const files: Record<string, Uint8Array> = {};
    const copyText = `纯模拟文案，不可发布。\n${draft.titles[0]}\n${draft.blocks.map(b => b.text).join('\n\n')}\n${draft.cta}`;
    function addImage(name: string, role: RenderArtifact['role'], index = 0) {
      const previewUrl = input.templateId === 'moments-portrait' ? previews['moments-portrait'] : previews[input.platform]; const data = dataResources.get(previewUrl)!;
      const downloadUrl = exportable ? saveResource(data.bytes, data.type, name, expires, delivery?.id) : undefined;
      files[name] = data.bytes;
      artifacts.push({ id: id('artifact'), role, format: 'png', name, previewUrl, ...(downloadUrl ? { downloadUrl } : {}),
        width: template!.width, height: template!.height,
        sourceImageIds: input.platform === 'moments' ? draft!.images.map(i => i.imageId) : draft!.images.slice(index, index + 1).map(i => i.imageId),
        factIds: draft!.blocks.flatMap(b => b.factIds) });
    }
    if (input.platform === 'wechat') {
      const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><body style="font-family:sans-serif;line-height:1.8;padding:24px;color:#26352c"><p>纯模拟排版 · 未调用模型或 ima · 不可发布</p><h1>${escaped(draft.titles[0])}</h1>${draft.blocks.map(block => `<h2>${escaped(block.heading)}</h2><p>${escaped(block.text).replace(/\n/g, '<br>')}</p>`).join('')}<p>${escaped(draft.cta)}</p></body></html>`;
      const previewUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      const bytes = strToU8(html); dataResources.set(previewUrl, { bytes, type: 'text/html;charset=utf-8' }); files['纯模拟文章.html'] = bytes;
      const downloadUrl = exportable ? saveResource(bytes, 'text/html;charset=utf-8', '纯模拟文章.html', expires, delivery?.id) : undefined;
      artifacts.push({ id: id('article'), role: 'article', format: 'wechat-richtext', name: '纯模拟文章.html', previewUrl, ...(downloadUrl ? { downloadUrl } : {}), sourceImageIds: draft.images.map(i => i.imageId), factIds: draft.blocks.flatMap(b => b.factIds) });
      addImage('纯模拟公众号封面.png', 'cover');
    } else if (input.platform === 'xiaohongshu') {
      for (let page = 0; page < 3; page++) addImage(`纯模拟小红书-${page + 1}.png`, page === 0 ? 'cover' : 'card', page);
    } else if(input.platform==='moments'){for(const [i,placement]of draft.images.slice(0,3).entries()){const image=result.evidence.images.find(i=>i.id===placement.imageId);const data=image && dataResources.get(image.url);if(!image||!data)continue;const downloadUrl=exportable?saveResource(data.bytes,data.type,`纯模拟朋友圈-${i+1}.png`,expires,delivery?.id):undefined;const dimensions=new DataView(data.bytes.buffer,data.bytes.byteOffset,data.bytes.byteLength);artifacts.push({id:id('original'),role:'card',format:'original',name:`纯模拟朋友圈-${i+1}.png`,previewUrl:image.url,downloadUrl,width:dimensions.getUint32(16),height:dimensions.getUint32(20),sourceImageIds:[image.id],factIds:[]});files[`纯模拟朋友圈-${i+1}.png`]=data.bytes;}}else addImage('纯模拟海报.png','poster');
    files['纯模拟文案.txt'] = strToU8(copyText); files['来源与审核.txt'] = strToU8('纯模拟布局夹具；无真实产品事实；未调用模型或 ima；不可发布。');
    if (input.visualMode === 'html') {
      files['制作源/design.json'] = strToU8(JSON.stringify({ mode: 'html', version: 'pure-mock-html-v1', platform: input.platform, title: draft.titles[input.selectedTitleIndex], notice: '纯模拟设计配置，不代表生产布局效果。' }));
      files['制作源/index.html'] = strToU8(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>纯模拟制作源</title><body><h1>${escaped(draft.titles[input.selectedTitleIndex])}</h1>${draft.blocks.map(b => `<section><h2>${escaped(b.heading)}</h2><p>${escaped(b.text)}</p></section>`).join('')}</body></html>`);
    }
    const zipUrl = exportable ? saveResource(zipSync(files), 'application/zip', '纯模拟成品.zip', expires, delivery?.id) : undefined;
    const bundle: RenderBundle = { id: id('render'), runId: result.id, revision: result.revision, selectedTitleIndex: input.selectedTitleIndex, platform: input.platform,
      templateId: template.id, artifacts, kind: 'static', reviewStatus: result.review.status, publication: !delivery && previewResult ? 'preview' : exportable ? 'released' : 'blocked',rendererVersion:input.visualMode==='html'?4:3,deliveryId:input.deliveryId, warnings: ['纯模拟排版，图片不是实际生成效果；不可公开发布。'],
      copyText: exportable ? copyText : '', ...(zipUrl ? { zipUrl } : {}), expiresAt: new Date(expires).toISOString() };
    bundles.set(bundle.id, clone(bundle));
    if(delivery){delivery.bundle=bundle;delivery.status=exportable?'ready':'blocked';delivery.updatedAt=new Date(now()).toISOString();}
    return json(bundle);
  }
  function channelDelivery(result:RunResult,platform:Platform,jobId?:string){
    const prior=[...deliveries.values()].find(d=>d.runId===result.id&&d.platform===platform);if(prior)return prior;
    const draft=result.drafts.find(d=>d.platform===platform)!;const issues=result.review.issues.filter(i=>!i.platform||i.platform===platform);
    const review={...result.review,issues,status:issues.some(i=>i.severity==='error')?'blocked' as const:issues.some(i=>i.severity==='warning')?'needs_attention' as const:'passed' as const};
    const d:ChannelDelivery={id:crypto.randomUUID(),runId:result.id,jobId,platform,revision:result.revision,createdAt:result.createdAt,updatedAt:new Date(now()).toISOString(),expiresAt:new Date(now()+HISTORY_TTL).toISOString(),product:result.product,brief:{...result.brief,platforms:[platform]},draft,review,outline:result.outline||{id:'mock-outline',version:1},status:review.status==='blocked'?'blocked':'visual_pending',copyText:review.status==='blocked'?'':[draft.titles[0],draft.intro,...draft.blocks.map(b=>b.text),draft.cta].join('\n\n'),evidenceStatus:'ready'};deliveries.set(d.id,d);deliverySources.set(d.id,clone(result));return d;
  }
  function deliveryDetail(value: ChannelDelivery) {
    const detail = clone(value); detail.evidenceStatus = metadata(detail.expiresAt).evidenceStatus;
    if (detail.bundle && Date.parse(detail.bundle.expiresAt) <= now()) { delete detail.bundle; if(detail.status==='ready')detail.status='visual_pending'; }
    if (detail.videoBundle && Date.parse(detail.videoBundle.expiresAt) <= now()) delete detail.videoBundle;
    return detail;
  }
  async function makePoster(job: BackgroundJob, delivery: ChannelDelivery, request: RenderRequest) {
    if (delivery.review.status === 'blocked') throw Object.assign(new Error('纯模拟：此渠道存在阻断问题。'), { code: 'REVIEW_BLOCKED', retryable: false });
    if (!request.regenerateVisual && delivery.bundle?.posterApproval && Date.parse(delivery.bundle.expiresAt) > now()) return delivery.bundle;
    const signal = jobControllers.get(job.id)!.signal;
    for (const stage of ['design', 'image'] as JobStage[]) { job.channels.find(c => c.platform === delivery.platform)!.stage = stage; options.onStage?.(job.id, delivery.platform, stage); touch(job); await delay(Math.max(2, latency), signal); }
    const data = dataResources.get(previews['poster-image'])!; const imageId = crypto.randomUUID(), bundleId = crypto.randomUUID();
    const expires = now() + TTL, sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data.bytes)))).map(n => n.toString(16).padStart(2,'0')).join('');
    const source = deliverySources.get(delivery.id)!;
    const approval: PosterApproval = { status: 'pending', bundleId, artifactId: imageId, sha256, contentFingerprint: 'pure-mock-poster-v2', createdAt: new Date(now()).toISOString(), expiresAt: new Date(expires).toISOString(),
      requiredCopy: [delivery.draft.titles[0], ...delivery.draft.blocks.map(block => block.heading), delivery.draft.cta], factChecks: source.evidence.facts.filter(fact => delivery.draft.blocks.some(block => block.factIds.includes(fact.id))).map(fact => ({factId:fact.id,statement:fact.statement,qualifiers:fact.qualifiers,sourceTitle:fact.sourceTitle})),
      referenceImages: source.evidence.images.filter(image => delivery.draft.images.some(p => p.imageId === image.id)).map(image => ({id:image.id,name:image.name,url:image.url})), notice: '纯模拟整图海报。生产生图不将产品原图作为参考输入，请核对中文、产品外观及事实条件；本例几何图片不可发布。' };
    resources.set(`/__mock/resources/${imageId}`, { bytes:data.bytes,type:'image/png',name:'纯模拟海报.png',expires,deliveryId:delivery.id,exportable:false });
    const bundle: RenderBundle = { id:bundleId,runId:delivery.runId,revision:delivery.revision,selectedTitleIndex:0,platform:'poster',templateId:request.templateId,kind:'static',rendererVersion:5,deliveryId:delivery.id,artifacts:[{id:imageId,role:'poster',format:'png',name:'纯模拟海报.png',previewUrl:previews['poster-image'],width:1024,height:1536,sourceImageIds:delivery.draft.images.map(i=>i.imageId),factIds:delivery.draft.blocks.flatMap(b=>b.factIds)}],reviewStatus:delivery.review.status,publication:'preview',warnings:['纯模拟海报，请核对三项后下载。'],copyText:'',expiresAt:new Date(expires).toISOString(),posterApproval:approval };
    delivery.bundle=bundle;delivery.posterApproval=approval;delivery.copyText='';delivery.status='visual_pending';delivery.updatedAt=new Date(now()).toISOString();bundles.set(bundle.id,clone(bundle));return bundle;
  }
  async function executeJob(job: BackgroundJob) {
    if (job.status === 'cancelled') return;
    const cancel = new AbortController(); jobControllers.set(job.id, cancel); const input = job.input;
    const signal = cancel.signal;
    job.status = 'running'; touch(job);
    try {
      if (input.kind === 'outline' || input.kind === 'outline-revise') {
        const response = input.kind === 'outline'
          ? await transport('/api/outlines', { method: 'POST', body: JSON.stringify(input.brief), signal })
          : await transport(`/api/outlines/${encodeURIComponent(input.outlineId)}/revise`, { method: 'POST', body: JSON.stringify({ version: input.version, instructions: input.instructions, platforms: input.platforms }), signal });
        const data = await response.json(); if (!response.ok) throw new Error(data.message);
        signal.throwIfAborted(); job.outline = data as OutlineResult;
        job.channels = job.outline.platforms.map(p => ({ platform: p.platform, status: 'completed', stage: 'outline' }));
      } else if (input.kind === 'generate') {
        const snapshot = job.outline!; const result = jobResults.get(job.id) || makeResult(snapshot); jobResults.set(job.id, result);
        await Promise.all(job.channels.map(async (channel, index) => {
          if (channel.status === 'completed') return;
          const checkpoints = jobCheckpoints.get(job.id) || new Set<string>(); jobCheckpoints.set(job.id, checkpoints);
          for (const stage of ['write', 'review', 'render'] as JobStage[]) {
            if (checkpoints.has(`${channel.platform}:${stage}`)) continue;
            options.onStage?.(job.id, channel.platform, stage);
            channel.status = 'running'; channel.stage = stage; touch(job);
            await delay(Math.max(5, latency) * (index + 1), signal);
            if ((scenario === 'error' || scenario === 'disconnected') && !injectedJobFailures.has(job.id) && index === job.channels.length - 1 && stage === 'review') {
              injectedJobFailures.add(job.id);
              channel.status = 'failed'; channel.error = { message: scenario === 'disconnected' ? '纯模拟：上游断流，结果不确定。' : '纯模拟：模型返回 HTTP 524，结果不确定。', code: 'MODEL_UPSTREAM', stage, platform: channel.platform, upstreamStatus: 524, retryable: true, outcomeUnknown: true }; touch(job); return;
            }
            checkpoints.add(`${channel.platform}:${stage}`);
            if (stage === 'review') channel.preview = { draft: clone(result.drafts.find(d => d.platform === channel.platform)!), review: clone(result.review) };
          }
          const requested = input.renders?.find(r => r.platform === channel.platform);
          const templateId = requested?.templateId || fixture.renderTemplates.templates.find(t => t.platform === channel.platform)!.id;
          const delivery=channelDelivery(result,channel.platform,job.id);channel.deliveryId=delivery.id;channel.delivery=delivery;
          const request:RenderRequest={ deliveryId:delivery.id,runId: result.id, revision: result.revision, platform: channel.platform, selectedTitleIndex: requested?.selectedTitleIndex || 0, templateId, ...(['wechat','xiaohongshu'].includes(channel.platform)?{visualMode:'html' as const}:{}) };
          const bundle = channel.platform === 'poster' && delivery.review.status !== 'blocked' ? await makePoster(job, delivery, {...request,visualMode:'poster-image'}) : await render(request, result).json() as RenderBundle;
          channel.preview!.bundle = bundle; job.renderBundles.push(bundle); channel.status = 'completed'; touch(job);
        }));
        signal.throwIfAborted();
        const failed = job.channels.find(c => c.error); if (failed) { job.error = failed.error; job.status = 'failed'; touch(job); return; }
        runs.set(result.id, { value: clone(result), snapshot: clone(snapshot), touched: now(), expiresAt: new Date(now() + HISTORY_TTL).toISOString() });
        job.result = result;
      } else if (input.kind === 'video') {
        const d = deliveries.get(input.deliveryId)!;
        const sourceId = videoSources.get(job.id); const source = d.bundle;
        if (!source || Date.parse(source.expiresAt) <= now()) throw Object.assign(new Error('纯模拟：图文成品已过期，请重新排版后生成视频。'), { code: 'VIDEO_SOURCE_EXPIRED', retryable: false });
        if (source.id !== sourceId) throw Object.assign(new Error('纯模拟：图文版本已更新，请基于当前版本重新生成视频。'), { code: 'VIDEO_SOURCE_CHANGED', retryable: false });
        if (d.review.status === 'blocked') throw Object.assign(new Error('纯模拟：本渠道审核阻断，不能生成视频。'), { code: 'REVIEW_BLOCKED', retryable: false });
        if (metadata(d.expiresAt).evidenceStatus !== 'ready') throw Object.assign(new Error('纯模拟：来源需要重新获取。'), { code: 'EVIDENCE_EXPIRED', retryable: false });
        const channel = job.channels[0]; const checkpoints = jobCheckpoints.get(job.id) || new Set<string>(); jobCheckpoints.set(job.id, checkpoints);
        for (const stage of ['video_script', 'video_review', ...(options.videoReviewBlocked ? ['video_repair', 'video_recheck'] : []), 'storyboard', 'video_render', 'video_encode'] as JobStage[]) {
          if (checkpoints.has(stage)) continue;
          channel.status = 'running'; channel.stage = stage; options.onStage?.(job.id, d.platform, stage); touch(job);
          for (let frame = 0; frame <= (stage === 'video_render' ? 600 : 0); frame += 200) {
            if (stage === 'video_render') channel.progress = { completedFrames: frame, totalFrames: 600 };
            touch(job); await delay(Math.max(2, latency), signal);
          }
          if (stage === 'video_script') {
            const script: VideoScript = { version:'video-script-v2',title:'纯模拟选机看点',cta:'带着问题到店核对。',sourceFingerprint:sourceId!,scenes:[{id:'mock-video-scene',heading:'核对使用需求',text:'先列出你的常用任务，再现场核对。',kind:'action',factIds:[],conditions:[]}] };
            job.videoScript=script;channel.videoScript=script;
          }
          if (stage === 'video_review' || stage === 'video_recheck') {
            const review={status:options.videoReviewBlocked?'blocked' as const:'passed' as const,issues:options.videoReviewBlocked?[{id:'mock-video-review',severity:'error' as const,message:'纯模拟短稿仍有待修正的事实范围。',suggestion:'请核对原文与适用条件。'}]:[],reviewedBy:'rules+model' as const,checkedAt:new Date(now()).toISOString()};job.videoScriptReview=review;channel.videoScriptReview=review;
            if(stage==='video_recheck'&&options.videoReviewBlocked)throw Object.assign(new Error('纯模拟：视频短稿未通过独立审核，原图文仍保留。'),{code:'VIDEO_REVIEW_BLOCKED',retryable:false});
          }
          if (['video_script','video_review','video_repair','video_recheck'].includes(stage)) job.calls.push({id:id('video-call'),stage,platform:d.platform,attempt:1,queuedAt:new Date(now()).toISOString(),startedAt:new Date(now()).toISOString(),endedAt:new Date(now()).toISOString(),outcome:'succeeded'});
          if (options.videoFailureStage === stage && !injectedJobFailures.has(job.id)) { injectedJobFailures.add(job.id); throw new Error('纯模拟：视频步骤失败，成功图文仍保留。'); }
          signal.throwIfAborted(); checkpoints.add(stage);
        }
        if (d.bundle?.id !== sourceId) throw Object.assign(new Error('纯模拟：制作期间图文版本已更新，视频未发布。'), { code: 'VIDEO_SOURCE_CHANGED', retryable: false });
        const expires = Date.parse(source.expiresAt); const data = dataResources.get(videoFixture.url)!;
        const name = '纯模拟渠道视频.mp4'; const videoUrl = saveResource(data.bytes, 'video/mp4', name, expires, d.id);
        const cover = source.artifacts.find(a => a.role === 'cover');
        const videoBundle: RenderBundle = { ...clone(source), id: id('video'), kind: 'video', templateId: 'html-video-v1', creativeAssets: source.creativeAssets,
          artifacts: [{ id: id('mp4'), role: 'video', format: 'mp4', name, previewUrl: videoFixture.url, downloadUrl: videoUrl, width: videoFixture.width, height: videoFixture.height, durationSeconds: 20, fps: 30, frameCount: 600, sourceImageIds: d.draft.images.map(i => i.imageId), factIds: d.draft.blocks.flatMap(b => b.factIds) }, ...(cover ? [clone(cover)] : [])],
          zipUrl: saveResource(zipSync({ [name]: data.bytes, '纯模拟说明.txt': strToU8('纯几何模拟视频；非生产效果；未调用模型或外部服务。') }), 'application/zip', '纯模拟短视频.zip', expires, d.id), warnings: ['纯模拟视频为 240×426 几何占位，生产成品使用 1080×1920。'] };
        d.videoBundle = videoBundle; d.updatedAt = new Date(now()).toISOString(); job.videoBundle = clone(videoBundle);
        channel.status = 'completed'; channel.deliveryId = d.id; channel.delivery = deliveryDetail(d);
      } else {
        const request=input.request;const d=request.deliveryId?deliveries.get(request.deliveryId):undefined;
        if(request.visualMode==='poster-image') {
          if(!d)throw new Error('纯模拟：海报需要独立渠道交付。');
          const bundle=await makePoster(job,d,request);job.renderBundles=[bundle];job.channels[0].deliveryId=d.id;job.channels[0].delivery=deliveryDetail(d);job.channels[0].status='completed';job.status='completed';touch(job);return;
        }
        const visualStage=async(stage:JobStage)=>{job.channels[0].stage=stage;options.onStage?.(job.id,request.platform,stage);touch(job);await delay(Math.max(1,latency),signal);};
        if(request.visualMode==='html'&&['wechat','xiaohongshu'].includes(request.platform)){
          const visualKey=`${request.runId}:main`;const priorVisual=generatedVisuals.get(visualKey);
          if(priorVisual!==undefined&&priorVisual<=now()&&!request.regenerateVisual)throw Object.assign(new Error('纯模拟：已生成背景已过期，请主动重新生成背景并排版；未自动调用生图服务。'),{code:'IMAGE_ASSET_EXPIRED'});
          if(request.regenerateVisual){
            await visualStage('design');
            if(!status.image?.configured)throw Object.assign(new Error('纯模拟：尚未配置生图密钥。'),{code:'IMAGE_NOT_CONFIGURED'});
            await visualStage('image');generatedVisuals.set(visualKey,now()+TTL);await visualStage('compose');
          }
        }
        await visualStage('render');
        const response = render(input.request); const data = await response.json(); if (!response.ok) throw new Error(data.message);
        job.renderBundles = [data as RenderBundle]; job.channels.forEach(c => { c.status = 'completed'; });
        if(d){job.channels[0].deliveryId=d.id;job.channels[0].delivery=deliveryDetail(d);}
      }
      job.status = 'completed'; touch(job);
    } catch (error) {
      job.status = signal.aborted ? 'cancelled' : 'failed';
      job.error = signal.aborted ? undefined : { message: error instanceof Error ? error.message : '纯模拟任务失败。', code: error && typeof error==='object'&&'code'in error?String(error.code):'MOCK_JOB', stage: job.channels.find(c=>c.status!=='completed')?.stage || (input.kind === 'render' ? 'render' : input.kind === 'generate' ? 'write' : 'outline'), retryable: !(error && typeof error==='object'&&'retryable'in error&&error.retryable===false), outcomeUnknown: false };
      job.channels.forEach(c => { if (c.status !== 'completed') c.status = job.status; }); touch(job);
    } finally { jobControllers.delete(job.id); }
  }
  const transport: Transport = async (url, init = {}) => {
    init.signal?.throwIfAborted();
    if (dataResources.has(url)) { const resource = dataResources.get(url)!; return new Response(resource.bytes.slice(), { headers: { 'Content-Type': resource.type } }); }
    // Never fetch caller-supplied external URLs, even if they resemble a known API route.
    if (!url.startsWith('/') || url.startsWith('//')) return failure(403, '模拟模式不访问外部资源。');
    const parsed = new URL(url, 'http://mock.invalid'); const method = (init.method || 'GET').toUpperCase();
    await delay(latency, init.signal); init.signal?.throwIfAborted();
    if (parsed.pathname.startsWith('/__mock/resources/')) {
      const resource = resources.get(parsed.pathname);
      if (!resource || resource.expires <= now()) return failure(410, '模拟成品已过期。');
      if(resource.deliveryId&&deliveries.get(resource.deliveryId)?.review.status==='blocked')return failure(409,'本渠道存在阻断问题，正式下载已关闭。');
      if(resource.exportable===false&&parsed.searchParams.get('download')==='1')return failure(409,'此图片仅供核对，正式下载尚未开放。');
      const headers = new Headers({ 'Content-Type': resource.type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(resource.name)}`, 'Accept-Ranges': 'bytes' });
      const range = new Headers(init.headers).get('Range');
      if (range && resource.type === 'video/mp4') {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range); const length = resource.bytes.length;
        if (!match || !match[1] && !match[2]) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${length}` } });
        const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
        const end = match[1] && match[2] ? Math.min(Number(match[2]), length - 1) : length - 1;
        if (start >= length || end < start) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${length}` } });
        headers.set('Content-Range', `bytes ${start}-${end}/${length}`); headers.set('Content-Length', String(end - start + 1));
        return new Response(resource.bytes.slice(start, end + 1), { status: 206, headers });
      }
      return new Response(resource.bytes.slice(), { headers });
    }
    let body: Record<string, unknown> = {};
    try { if (init.body) body = JSON.parse(String(init.body)); }
    catch { return failure(400, '请求不是有效 JSON。'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failure(400, '请求对象无效。');
    const pathname = parsed.pathname;
    if(pathname.startsWith('/api/integrations/canva'))return json({message:'旧外部设计流程已搁置，请使用当前制作流程重新生成。',code:'EXTERNAL_DESIGN_PAUSED',retryable:false,outcomeUnknown:false},410);
    if (method === 'GET' && pathname === '/api/jobs/events') {
      let unsubscribe = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (snapshot: BackgroundJob[]) => controller.enqueue(strToU8(`data: ${JSON.stringify({ type: 'snapshot', jobs: snapshot })}\n\n`));
          watchers.add(send); send([...jobs.values()].map(compactJob));
          unsubscribe = () => { watchers.delete(send); init.signal?.removeEventListener('abort', abort); };
          const abort = () => { unsubscribe(); controller.close(); };
          init.signal?.addEventListener('abort', abort, { once: true });
        }, cancel() { unsubscribe(); },
      }); return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (method === 'GET' && pathname === '/api/jobs') {
      const key = parsed.searchParams.get('idempotencyKey'); return json({ jobs: [...jobs.values()].filter(j => !key || j.idempotencyKey === key || jobAliases.get(key) === j.id).map(job => key ? clone(job) : compactJob(job)) });
    }
    if (method === 'POST' && pathname === '/api/jobs') {
      const input = body as unknown as JobSubmit;
      if (!/^[A-Za-z0-9._:-]{8,120}$/.test(input.idempotencyKey || '') || !['outline', 'outline-revise', 'generate', 'render', 'video'].includes(input.kind)) return failure(400, '任务输入无效。');
      if(input.kind==='render'&&(input.request.visualMode==='canva'||input.request.canvaSync))return json({message:'旧外部设计流程已搁置，请使用当前制作流程重新生成。',code:'EXTERNAL_DESIGN_PAUSED',retryable:false,outcomeUnknown:false},410);
      const duplicate = [...jobs.values()].find(j => j.idempotencyKey === input.idempotencyKey || jobAliases.get(input.idempotencyKey) === j.id);
      if (duplicate) { const { idempotencyKey: _, ...value } = input; if (JSON.stringify(value) !== JSON.stringify(duplicate.input)) return failure(409, '幂等键已用于其他输入。'); return json({ job: duplicate }, 202); }
      let snapshot: OutlineResult | undefined;
      if (input.kind === 'generate' || input.kind === 'outline-revise') {
        snapshot = getOutline(input.outlineId); if (!snapshot) return failure(410, '大纲已过期。');
        if (snapshot.version !== input.version || input.kind === 'generate' && snapshot.status !== 'confirmed') return failure(409, '请先确认当前大纲版本。');
      }
      if(input.kind==='render'&&input.request.deliveryId){const d=deliveries.get(input.request.deliveryId);if(!d||Date.parse(d.expiresAt)<=now())return failure(410,'渠道交付已过期。');if(d.runId!==input.request.runId||d.revision!==input.request.revision||d.platform!==input.request.platform)return failure(409,'渠道交付版本不一致。');if(metadata(d.expiresAt).evidenceStatus!=='ready')return failure(410,'历史来源需要重新获取。');}
      const videoDelivery = input.kind === 'video' ? deliveries.get(input.deliveryId) : undefined;
      if (input.kind === 'video') {
        if (!videoDelivery || Date.parse(videoDelivery.expiresAt) <= now()) return failure(410, '渠道交付已过期。');
        if (!['wechat', 'xiaohongshu'].includes(videoDelivery.platform)) return failure(400, '此渠道不支持视频制作。');
        if (videoDelivery.review.status === 'blocked') return failure(409, '本渠道审核阻断，不能生成视频。');
        if (metadata(videoDelivery.expiresAt).evidenceStatus !== 'ready') return failure(410, '历史来源需要重新获取。');
        if (!videoDelivery.bundle || Date.parse(videoDelivery.bundle.expiresAt) <= now()) return failure(410, '图文成品已过期，请重新排版后生成视频。');
        if (videoDelivery.bundle.publication !== 'released') return failure(409, '当前图文未通过渠道交付检查。');
        const active = [...jobs.values()].find(j => j.input.kind === 'video' && j.input.deliveryId === input.deliveryId && (['queued', 'running'].includes(j.status) || ['failed', 'interrupted', 'cancelled'].includes(j.status) && videoTextSources.get(j.id) === videoTextKey(videoDelivery)));
        if (active) { jobAliases.set(input.idempotencyKey, active.id); return json({ job: active }, 202); }
      }
      const { idempotencyKey, ...storedInput } = input;
      const platforms = input.kind === 'outline' ? input.brief.platforms : input.kind === 'render' ? [input.request.platform] : input.kind === 'video' ? [videoDelivery!.platform] : snapshot!.brief.platforms;
      const job: BackgroundJob = { id: id('job'), idempotencyKey, kind: input.kind, status: 'queued', createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + HISTORY_TTL).toISOString(), input: clone(storedInput) as JobInput, model: { name: 'pure-mock', baseUrl: 'mock://local' }, channels: platforms.map(platform => ({ platform, status: 'queued', stage: input.kind === 'render' ? 'render' : input.kind === 'video' ? 'video_script' : input.kind === 'generate' ? 'write' : 'outline', ...(videoDelivery ? { deliveryId: videoDelivery.id, delivery: deliveryDetail(videoDelivery) } : {}) })), calls: [], renderBundles: [], ...(snapshot ? { outline: clone(snapshot) } : {}) };
      if (videoDelivery) { videoSources.set(job.id, videoDelivery.bundle!.id);videoTextSources.set(job.id,videoTextKey(videoDelivery)); }
      jobs.set(job.id, job); notify(); setTimeout(() => { void executeJob(job); }, 0); return json({ job }, 202);
    }
    const jobMatch = /^\/api\/jobs\/([^/]+)(?:\/(cancel|retry))?$/.exec(pathname);
    if (jobMatch) {
      const job = jobs.get(decodeURIComponent(jobMatch[1])); if (!job) return failure(404, '任务不存在。');
      if (method === 'GET' && !jobMatch[2]) return json({ job });
      if (method === 'POST' && jobMatch[2] === 'cancel') { if (job.status === 'queued' || job.status === 'running') { jobControllers.get(job.id)?.abort(); job.status = 'cancelled'; touch(job); } return json({ job }); }
      if (method === 'POST' && jobMatch[2] === 'retry') { if(job.input.kind==='render'&&(job.input.request.visualMode==='canva'||job.input.request.canvaSync))return json({message:'旧外部设计流程已搁置，请使用当前制作流程重新生成。',code:'EXTERNAL_DESIGN_PAUSED',retryable:false,outcomeUnknown:false},410); if ((!['failed', 'interrupted'].includes(job.status) && !(job.status==='cancelled'&&job.input.kind==='video'&&videoTextSources.has(job.id))) || job.error?.retryable === false) return failure(409, '此任务没有可重试的失败步骤。'); if(job.input.kind==='video'){const d=deliveries.get(job.input.deliveryId);if(!d||!d.bundle||Date.parse(d.bundle.expiresAt)<=now())return failure(410,'图文已过期，请先重新排版。');if(videoTextSources.get(job.id)!==videoTextKey(d))return failure(409,'视频文本来源已变化，请为当前版本创建新任务。');if(videoSources.get(job.id)!==d.bundle.id){videoSources.set(job.id,d.bundle.id);for(const stage of ['storyboard','video_render','video_encode'])jobCheckpoints.get(job.id)?.delete(stage);}} job.status = 'queued'; delete job.error; job.channels.forEach(c => { if (c.status !== 'completed') { c.status = 'queued'; delete c.error; } }); touch(job); setTimeout(() => { void executeJob(job); }, 0); return json({ job }); }
    }
    if (method === 'GET' && pathname === '/api/status') return json(status);
    if (method === 'GET' && pathname === '/api/products') return json({ products: scenario === 'empty' ? [] : clone(fixture.products.products) });
    if (method === 'GET' && pathname === '/api/task-options') return json(taskOptions);
    if (method === 'GET' && pathname === '/api/render-templates') return json(renderTemplates);
    const deliveryRun=/^\/api\/runs\/([^/]+)\/deliveries\/(xiaohongshu|wechat|moments|poster)$/.exec(pathname);
    if(method==='GET'&&deliveryRun){const result=getRun(deliveryRun[1]);return result?json({delivery:deliveryDetail(channelDelivery(result,deliveryRun[2] as Platform))}):failure(410,'成稿不存在。');}
    const dm=/^\/api\/deliveries\/([^/]+)(?:\/(rerender|canva\/sync|video|poster\/approve))?$/.exec(pathname);
    if(dm){const d=deliveries.get(dm[1]);if(!d||Date.parse(d.expiresAt)<=now())return failure(410,'渠道交付已过期。');
      if(method==='GET'&&!dm[2])return json({delivery:deliveryDetail(d)});
      if(method==='POST'&&dm[2]==='poster/approve'){
        if(Object.keys(body).some(key=>!['bundleId','artifactId','sha256','checks'].includes(key)))return failure(400,'海报核对输入包含未知字段。');
        const a=d.posterApproval,b=d.bundle;
        if(!a||!b||Date.parse(a.expiresAt)<=now())return failure(410,'海报预览已过期，请重新生成。');
        if(metadata(d.expiresAt).evidenceStatus!=='ready')return failure(410,'历史来源需要重新获取。');
        if(d.review.status==='blocked')return failure(409,'本渠道存在审核阻断，不能开放下载。');
        if(body.bundleId!==a.bundleId||body.artifactId!==a.artifactId||body.sha256!==a.sha256||b.id!==a.bundleId)return failure(409,'海报版本或图片校验值已变化，请重新核对当前图片。');
        const checks=body.checks as Record<string,unknown>|undefined;
        if(!checks||!['text','product','facts'].every(key=>checks[key]===true)||Object.keys(checks).length!==3)return failure(422,'请逐项核对文字、产品外观和事实。');
        if(a.status==='approved')return json({delivery:deliveryDetail(d)});
        const source=resources.get(`/__mock/resources/${a.artifactId}`)!;
        if(!source||source.expires<=now())return failure(410,'原海报图片已过期。');
        a.status='approved';a.approvedAt=new Date(now()).toISOString();a.checks={text:true,product:true,facts:true};b.posterApproval=clone(a);
        b.artifacts=b.artifacts.map(item=>({...item,id:crypto.randomUUID(),downloadUrl:saveResource(source.bytes,source.type,source.name,source.expires,d.id)}));b.publication='released';
        b.zipUrl=saveResource(zipSync({'纯模拟海报.png':source.bytes,'设计与审核.txt':strToU8('纯模拟海报已完成三项核对，不包含发布文案。')}),'application/zip','纯模拟海报与来源.zip',source.expires,d.id);
        d.status='ready';d.updatedAt=new Date(now()).toISOString();bundles.set(b.id,clone(b));return json({delivery:deliveryDetail(d)});
      }
      if(method==='POST'&&dm[2]){
        if(typeof body.idempotencyKey!=='string'||body.idempotencyKey.length<8||body.idempotencyKey.length>120)return failure(400,'任务幂等键无效。');
        if(dm[2]==='video')return transport('/api/jobs',{method:'POST',body:JSON.stringify({kind:'video',deliveryId:d.id,idempotencyKey:body.idempotencyKey})});
        if(dm[2]==='canva/sync'||body.visualMode==='canva')return json({message:'旧外部设计流程已搁置，请使用当前制作流程重新生成。',code:'EXTERNAL_DESIGN_PAUSED',retryable:false,outcomeUnknown:false},410);
        if(body.visualMode!==undefined&&!['local','html','poster-image'].includes(String(body.visualMode)))return failure(400,'视觉模式无效。');
        return transport('/api/jobs',{method:'POST',body:JSON.stringify({kind:'render',idempotencyKey:body.idempotencyKey,request:{runId:d.runId,revision:d.revision,platform:d.platform,selectedTitleIndex:d.bundle?.selectedTitleIndex||0,templateId:body.templateId||d.bundle?.templateId||renderTemplates.templates.find(t=>t.platform===d.platform)!.id,deliveryId:d.id,...(dm[2]==='canva/sync'?{canvaSync:true}:{visualMode:body.visualMode||(['wechat','xiaohongshu'].includes(d.platform)?'html':'local'),...(body.regenerateVisual?{regenerateVisual:true}:{})})}})});}}
    if (method === 'GET' && pathname === '/api/history') {
      const items: HistoryItem[] = [];
      for (const [outlineId, entry] of outlines) { const value = getOutline(outlineId); if (value) items.push({ kind: 'outline', id: outlineId, productName: value.product.name, audience: value.brief.audience, scene: value.brief.scene, platforms: value.brief.platforms, createdAt: value.createdAt, updatedAt: new Date(entry.touched).toISOString(), version: value.version, ...value.history! }); }
      for (const [runId, entry] of runs) { const value = getRun(runId); if (value) items.push({ kind: 'run', id: runId, productName: value.product.name, audience: value.brief.audience, scene: value.brief.scene, platforms: value.brief.platforms, createdAt: value.createdAt, updatedAt: new Date(entry.touched).toISOString(), revision: value.revision, reviewStatus: value.review.status, ...metadata(entry.expiresAt) }); }
      return json({ items: items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),...(parsed.searchParams.get('includeDeliveries')==='1'?{deliveries:[...deliveries.values()].filter(d=>Date.parse(d.expiresAt)>now()).map(deliveryDetail)}:{}) });
    }
    const runMatch = /^\/api\/runs\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && runMatch) { const runId = decodeURIComponent(runMatch[1]); const result = getRun(runId); if (!result) return failure(410, '历史正文已过期或不存在。'); const entry = runs.get(runId)!;
      const detail: RunDetail = { result, outlineSnapshot: entry.snapshot, history: metadata(entry.expiresAt), renderBundles: [...bundles.values()].filter(b => b.runId === result.id && b.revision === result.revision && Date.parse(b.expiresAt) > now()),...(parsed.searchParams.get('includeDeliveries')==='1'?{deliveries:[...deliveries.values()].filter(d=>d.runId===result.id&&Date.parse(d.expiresAt)>now()).map(deliveryDetail)}:{}) }; return json(detail); }
    if (method === 'POST' && pathname === '/api/connections/settings') return json(status);
    if (method === 'POST' && pathname === '/api/connections/verify') return json(status);
    if (method === 'POST' && pathname === '/api/connections/model/verify') return json({ verified: false, message: '纯模拟：未执行真实模型验证，也未保存凭证。' });
    if (method === 'POST' && pathname === '/api/outlines') {
      if (scenario === 'empty') return failure(422, '没有可用模拟产品。');
      const fields = ['productId', 'audience', 'scene'].filter(key => typeof body[key] !== 'string' || !String(body[key]).trim()).map(field => ({ field, question: `请补充${field === 'productId' ? '产品' : field === 'audience' ? '目标客户' : '业务场景'}。` }));
      if (scenario === 'needs_input' || fields.length) return json({ type: 'needs_input', message: '纯模拟：请补充任务信息。', fields: fields.length ? fields : fixture.terminalEvents.needs_input.fields }, 422);
      if (body.productId !== baseOutline.product.id) return failure(400, '产品 ID 不属于模拟目录。');
      const platforms = body.platforms;
      if (!Array.isArray(platforms) || platforms.length < 1 || platforms.length > 4 || new Set(platforms).size !== platforms.length || platforms.some(p => !PLATFORMS.includes(p))) return failure(400, '请选择 1–4 个不同渠道。');
      const outline = clone(baseOutline); outline.id = id('outline'); outline.version = 1; outline.status = 'editing'; delete outline.confirmedAt;
      outline.brief = { ...clone(baseOutline.brief), ...body, mode: 'demo', knowledgeSource: 'local' } as Brief;
      outline.createdAt = new Date(now()).toISOString(); outline.history = metadata(new Date(now() + HISTORY_TTL).toISOString()); outline.platforms = outline.platforms.filter(p => platforms.includes(p.platform));
      outline.warnings = ['纯模拟大纲，未检索真实资料，也未调用模型或 ima。'];
      if (scenario === 'insufficient-images') {
        outline.evidence.images = outline.evidence.images.slice(0, 0);
        outline.platforms.forEach(p => { p.imageIds = p.imageIds.slice(0, 0); });
      }
      if (!imageCountsValid(outline)) return failure(422, '同型号图片数量不足，请减少渠道或检查资料，未开始策划。');
      outlines.set(outline.id, { value: clone(outline), touched: now() }); return json(outline);
    }
    const match = /^\/api\/outlines\/([^/]+)(?:\/(revise|confirm))?$/.exec(pathname);
    if (match) {
      const outline = getOutline(decodeURIComponent(match[1]));
      if (!outline) return failure(410, '大纲已过期，请重新生成。');
      if (scenario === 'expired' && !injectedExpiry) { injectedExpiry = true; outlines.delete(outline.id); return failure(410, '大纲已过期，请重新生成。'); }
      if (method === 'GET' && !match[2]) return json(outline);
      if (outline.history?.evidenceStatus !== 'ready') return failure(410, '历史来源需要重新获取，请按原任务重新策划。');
      if (scenario === 'conflict' && !injectedConflict) { injectedConflict = true; outline.version++; outline.status = 'editing'; delete outline.confirmedAt; return failure(409, '大纲已经被其他编辑更新，请载入最新版本。'); }
      if (body.version !== outline.version) return failure(409, '大纲版本不一致，请载入最新版本。');
      if (method === 'POST' && match[2] === 'confirm') { if (!imageCountsValid(outline)) return failure(422, '配图数量不符合渠道要求。'); outline.status = 'confirmed'; outline.confirmedAt = new Date(now()).toISOString(); outlines.get(outline.id)!.touched = now(); return json(outline); }
      if (method === 'PUT' && !match[2]) {
        const platforms = body.platforms as PlatformOutline[] | undefined;
        if (!Array.isArray(platforms) || platforms.length !== outline.platforms.length || new Set(platforms.map(p => p.platform)).size !== platforms.length || platforms.some(p => !outline.brief.platforms.includes(p.platform)
          || !p.title?.trim() || !p.cta?.trim() || !Array.isArray(p.sections) || !p.sections.length || p.sections.length > (p.platform === 'poster' ? 3 : 8)
          || new Set(p.sections.map(s => s.id)).size !== p.sections.length || p.sections.some(s => !s.id || !Array.isArray(s.points) || !s.points.length || s.points.some(point => typeof point !== 'string' || !point.trim())
            || !Array.isArray(s.factIds) || s.factIds.some(factId => !outline.evidence.facts.some(f => f.id === factId && f.status === 'supported')))
          || !Array.isArray(p.imageIds) || new Set(p.imageIds).size !== p.imageIds.length || p.imageIds.some(imageId => !outline.evidence.images.some(i => i.id === imageId)))) return failure(400, '大纲结构、引用或配图无效。');
        if (!imageCountsValid(outline, platforms)) return failure(422, '配图数量不符合渠道要求。');
        outline.platforms = clone(platforms);
      } else if (method === 'POST' && match[2] === 'revise') {
        if (typeof body.instructions !== 'string' || !body.instructions.trim()) return failure(400, '请填写修改要求。');
        outline.platforms.forEach(p => { if (Array.isArray(body.platforms) && !body.platforms.includes(p.platform)) return; p.sections.forEach(s => { s.points = s.points.map(point => `纯模拟修改：${point.split('\n')[0]}`); }); });
        outline.warnings = ['纯模拟修改结果，没有调用 AI；用于验证版本与重新确认流程。'];
      } else return failure(404, '未找到此模拟接口。');
      outline.version++; outline.status = 'editing'; delete outline.confirmedAt; outlines.get(outline.id)!.touched = now(); return json(outline);
    }
    if (method === 'POST' && pathname === '/api/generate-from-outline') {
      const outline = getOutline(String(body.outlineId));
      if (!outline) return failure(410, '大纲已过期，请重新生成。');
      if (outline.history?.evidenceStatus !== 'ready') return failure(410, '历史来源需要重新获取，请按原任务重新策划。');
      if (outline.version !== body.version || outline.status !== 'confirmed') return failure(409, '请先确认当前大纲版本。');
      if (!imageCountsValid(outline)) return failure(422, '配图数量不符合渠道要求。');
      return generation(outline, init.signal);
    }
    if (method === 'POST' && pathname === '/api/render') return render(body as unknown as RenderRequest);
    return failure(404, '未找到此模拟接口；不会转发真实请求。');
  };
  return transport;
}
