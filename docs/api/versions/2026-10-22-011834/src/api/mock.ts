import fixture from './fixtures/frontend.mock.json';
import previews from './fixtures/previews.json';
import { strToU8, zipSync } from 'fflate';
import { PLATFORMS, type AppStatus, type Brief, type HistoryItem, type HistoryMetadata, type OutlineResult, type Platform, type PlatformOutline, type RenderArtifact, type RenderBundle, type RenderRequest, type ReviewReport, type RunDetail, type RunResult, type TraceEntry } from '../../shared/types';
import type { MockScenario, Transport } from './mode';
export { mockScenario } from './mode';
export type { MockScenario, Transport } from './mode';

const clone = <T,>(value: T): T => structuredClone(value);
const baseOutline = fixture.fourChannelOutline as unknown as OutlineResult;
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
export function createMockTransport(scenario: MockScenario, options: { latencyMs?: number; now?: () => number; evidenceExpiresAt?: number } = {}): Transport {
  const latency = options.latencyMs ?? (scenario === 'slow' ? 1500 : 180);
  const now = options.now || Date.now;
  const outlines = new Map<string, { value: OutlineResult; touched: number }>();
  const runs = new Map<string, { value: RunResult; snapshot: OutlineResult; touched: number; expiresAt: string }>();
  const bundles = new Map<string, RenderBundle>();
  const resources = new Map<string, { bytes: Uint8Array; type: string; name: string; expires: number }>();
  // Only fixture assets and HTML composed below may be read as data URLs.
  const dataResources = new Map<string, { bytes: Uint8Array; type: string }>();
  for (const url of [...Object.values(previews), ...baseOutline.evidence.images.map(i => i.url), ...fixture.products.products.map(p => p.coverUrl)]) if (url?.startsWith('data:')) dataResources.set(url, dataBytes(url));
  let counter = 0; let injectedConflict = false; let injectedExpiry = false;
  const status = clone(fixture.status) as AppStatus;
  status.ima.message = '纯模拟：未连接 ima，保存和验证不会使用真实凭证。';
  status.local = { available: scenario !== 'empty', productCount: scenario === 'empty' ? 0 : fixture.products.products.length, imageCount: scenario === 'empty' ? 0 : scenario === 'insufficient-images' ? 1 : baseOutline.evidence.images.length };
  const id = (kind: string) => `mock-${kind}-${++counter}`;
  const progress = (fixture.progressEvents as unknown as { entry: TraceEntry }[]).map(e => e.entry);
  const metadata = (expiresAt: string): HistoryMetadata => ({ expiresAt, evidenceStatus: now() >= (options.evidenceExpiresAt ?? Infinity) ? 'refresh_required' : 'ready' });
  const imageCountsValid = (outline: OutlineResult, platforms = outline.platforms) => platforms.every(p => { const bounds = fixture.taskOptions.platforms.find(b => b.id === p.platform);
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
  function saveResource(bytes: Uint8Array, type: string, name: string) {
    const url = `/__mock/resources/${id('asset')}`;
    resources.set(url, { bytes, type, name, expires: now() + TTL }); return url;
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
          const result = clone(baseResult); result.id = id('run'); result.createdAt = new Date().toISOString();
          result.brief = snapshot.brief; result.product = snapshot.product; result.evidence = snapshot.evidence;
          result.outline = { id: snapshot.id, version: snapshot.version }; result.revision = 1;
          result.notice = '纯模拟数据：未调用模型或 ima，文案与几何素材不可作为产品事实或公开发布材料。';
          result.strategies = result.strategies.filter(s => snapshot.brief.platforms.includes(s.platform));
          result.drafts = snapshot.platforms.map(p => ({ id: id('draft'), platform: p.platform, titles: [p.title], intro: p.intro,
            blocks: p.sections.map(s => ({ id: s.id, heading: s.heading, text: s.points.join('\n'), factIds: s.factIds })),
            cta: p.cta, tags: [], images: p.imageIds.map((imageId, i) => ({ imageId, afterBlock: Math.min(i - 1, p.sections.length - 1), caption: '纯模拟占位图', reason: '仅用于验证配图交互' })) }));
          if (scenario === 'blocked') result.review = clone(fixture.variants.blockedReview) as ReviewReport;
          runs.set(result.id, { value: clone(result), snapshot: clone(snapshot), touched: now(), expiresAt: new Date(now() + HISTORY_TTL).toISOString() });
          controller.enqueue(strToU8(`data: ${JSON.stringify({ type: 'result', result })}\n\n`)); controller.close();
        } catch (error) { if (!cancel.signal.aborted) controller.error(error); }
      },
      cancel() { cancel.abort(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
  }
  function render(input: RenderRequest) {
    const result = getRun(input.runId);
    if (!result) return failure(410, '正文任务已过期，请重新生成。');
    if (metadata(runs.get(input.runId)!.expiresAt).evidenceStatus !== 'ready') return failure(410, '历史来源需要重新获取，请按原任务重新策划。');
    if (result.revision !== input.revision) return failure(409, '正文版本不一致。');
    const draft = result.drafts.find(d => d.platform === input.platform);
    const template = fixture.renderTemplates.templates.find(t => t.platform === input.platform && t.id === input.templateId);
    if (!draft || !template || !draft.titles[input.selectedTitleIndex]) return failure(400, '模板、渠道或标题无效。');
    const bounds = fixture.taskOptions.platforms.find(p => p.id === input.platform)!;
    if (draft.images.length < bounds.minImages || draft.images.length > bounds.maxImages) return failure(422, '同型号素材数量不足，请补足素材后重新生成。');
    const exportable = result.review.status !== 'blocked'; const artifacts: RenderArtifact[] = [];
    const files: Record<string, Uint8Array> = {};
    const copyText = `纯模拟文案，不可发布。\n${draft.titles[0]}\n${draft.blocks.map(b => b.text).join('\n\n')}\n${draft.cta}`;
    function addImage(name: string, role: RenderArtifact['role'], index = 0) {
      const previewUrl = input.templateId === 'moments-portrait' ? previews['moments-portrait'] : previews[input.platform]; const data = dataResources.get(previewUrl)!;
      const downloadUrl = exportable ? saveResource(data.bytes, data.type, name) : undefined;
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
      const downloadUrl = exportable ? saveResource(bytes, 'text/html;charset=utf-8', '纯模拟文章.html') : undefined;
      artifacts.push({ id: id('article'), role: 'article', format: 'wechat-richtext', name: '纯模拟文章.html', previewUrl, ...(downloadUrl ? { downloadUrl } : {}), sourceImageIds: draft.images.map(i => i.imageId), factIds: draft.blocks.flatMap(b => b.factIds) });
      addImage('纯模拟公众号封面.png', 'cover');
    } else if (input.platform === 'xiaohongshu') {
      for (let page = 0; page < 3; page++) addImage(`纯模拟小红书-${page + 1}.png`, page === 0 ? 'cover' : 'card', page);
    } else addImage(`纯模拟${input.platform === 'moments' ? '朋友圈拼图' : '海报'}.png`, input.platform === 'poster' ? 'poster' : 'card');
    files['纯模拟文案.txt'] = strToU8(copyText); files['来源与审核.txt'] = strToU8('纯模拟布局夹具；无真实产品事实；未调用模型或 ima；不可发布。');
    const zipUrl = exportable ? saveResource(zipSync(files), 'application/zip', '纯模拟成品.zip') : undefined;
    const bundle: RenderBundle = { id: id('render'), runId: result.id, revision: result.revision, selectedTitleIndex: input.selectedTitleIndex, platform: input.platform,
      templateId: template.id, artifacts, reviewStatus: result.review.status, warnings: ['纯模拟排版，图片不是实际生成效果；不可公开发布。'],
      copyText: exportable ? copyText : '', ...(zipUrl ? { zipUrl } : {}), expiresAt: new Date(now() + TTL).toISOString() };
    bundles.set(bundle.id, clone(bundle));
    return json(bundle);
  }
  return async (url, init = {}) => {
    init.signal?.throwIfAborted();
    if (dataResources.has(url)) { const resource = dataResources.get(url)!; return new Response(resource.bytes.slice(), { headers: { 'Content-Type': resource.type } }); }
    // Never fetch caller-supplied external URLs, even if they resemble a known API route.
    if (!url.startsWith('/') || url.startsWith('//')) return failure(403, '模拟模式不访问外部资源。');
    const parsed = new URL(url, 'http://mock.invalid'); const method = (init.method || 'GET').toUpperCase();
    await delay(latency, init.signal); init.signal?.throwIfAborted();
    if (parsed.pathname.startsWith('/__mock/resources/')) {
      const resource = resources.get(parsed.pathname);
      if (!resource || resource.expires <= now()) return failure(410, '模拟成品已过期。');
      return new Response(resource.bytes.slice(), { headers: { 'Content-Type': resource.type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(resource.name)}` } });
    }
    let body: Record<string, unknown> = {};
    try { if (init.body) body = JSON.parse(String(init.body)); }
    catch { return failure(400, '请求不是有效 JSON。'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failure(400, '请求对象无效。');
    const pathname = parsed.pathname;
    if (method === 'GET' && pathname === '/api/status') return json(status);
    if (method === 'GET' && pathname === '/api/products') return json({ products: scenario === 'empty' ? [] : clone(fixture.products.products) });
    if (method === 'GET' && pathname === '/api/task-options') return json(fixture.taskOptions);
    if (method === 'GET' && pathname === '/api/render-templates') return json(fixture.renderTemplates);
    if (method === 'GET' && pathname === '/api/history') {
      const items: HistoryItem[] = [];
      for (const [outlineId, entry] of outlines) { const value = getOutline(outlineId); if (value) items.push({ kind: 'outline', id: outlineId, productName: value.product.name, audience: value.brief.audience, scene: value.brief.scene, platforms: value.brief.platforms, createdAt: value.createdAt, updatedAt: new Date(entry.touched).toISOString(), version: value.version, ...value.history! }); }
      for (const [runId, entry] of runs) { const value = getRun(runId); if (value) items.push({ kind: 'run', id: runId, productName: value.product.name, audience: value.brief.audience, scene: value.brief.scene, platforms: value.brief.platforms, createdAt: value.createdAt, updatedAt: new Date(entry.touched).toISOString(), revision: value.revision, reviewStatus: value.review.status, ...metadata(entry.expiresAt) }); }
      return json({ items: items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
    }
    const runMatch = /^\/api\/runs\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && runMatch) { const runId = decodeURIComponent(runMatch[1]); const result = getRun(runId); if (!result) return failure(410, '历史正文已过期或不存在。'); const entry = runs.get(runId)!;
      const detail: RunDetail = { result, outlineSnapshot: entry.snapshot, history: metadata(entry.expiresAt), renderBundles: [...bundles.values()].filter(b => b.runId === result.id && b.revision === result.revision && Date.parse(b.expiresAt) > now()) }; return json(detail); }
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
        outline.evidence.images = outline.evidence.images.slice(0, 1);
        outline.platforms.forEach(p => { p.imageIds = p.imageIds.slice(0, 1); });
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
        outline.platforms.forEach(p => { p.sections.forEach(s => { s.points = s.points.map(point => `纯模拟修改：${point.split('\n')[0]}`); }); });
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
}
