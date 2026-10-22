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
import { planXhs, renderXhs, type RenderImage } from './layouts.js';
import { renderWechatArticle } from './wechat.js';
import { FairLimiter } from '../fair-limiter.js';
import { markPreview } from './preview-watermark.js';
import { renderDirectory } from './path.js';
import { renderEditorialCover, renderMomentsCard, renderStorePoster } from './compositions.js';

export const renderTemplates: RenderTemplate[] = [
  { id: 'wechat-editorial', platform: 'wechat', name: '公众号 · 清晰阅读', width: 1200, height: 900 },
  { id: 'wechat-warm', platform: 'wechat', name: '公众号 · 暖色手记', width: 1200, height: 900 },
  { id: 'xhs-cream', platform: 'xiaohongshu', name: '小红书 · 奶油笔记', width: 1080, height: 1440 },
  { id: 'xhs-sage', platform: 'xiaohongshu', name: '小红书 · 青绿手记', width: 1080, height: 1440 },
  { id: 'moments-square', platform: 'moments', name: '朋友圈 · 方形产品卡', width: 1080, height: 1080 },
  { id: 'moments-portrait', platform: 'moments', name: '朋友圈 · 竖形场景卡', width: 1080, height: 1440 },
  { id: 'poster-paper', platform: 'poster', name: '海报 · 原色纸感', width: 1080, height: 1920 },
  { id: 'poster-ink', platform: 'poster', name: '海报 · 深色展陈', width: 1080, height: 1920 },
];
const root = renderDirectory();
const TTL = 30 * 60_000;
const assets = new Map<string, { file: string; group: string; expires: number; type: string; extension: string; name: string; exportable: boolean }>();
const groups = new Map<string, number>();
let restored = false;
function restoreRenderState() {
  if (restored) return;
  for (const [id, a] of stateStore().entries<{ file: string; group: string; expires: number; type: string; extension: string; name: string; exportable: boolean }>('renderAssets')) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9-]{36}$/.test(a.group) || a.expires <= Date.now() || path.dirname(path.resolve(a.file)) !== path.join(root, a.group)) continue;
    assets.set(id, a); groups.set(a.group, a.expires);
  }
  restored = true;
}
export function getRunBundles(runId: string): RenderBundle[] {
  return stateStore().entries<RenderBundle>('renderBundles').map(([, b]) => b).filter(b => b.runId === runId && Date.parse(b.expiresAt) > Date.now()
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
interface PrivateArtifact {
  file: string; name: string; role: RenderArtifact['role']; format: RenderArtifact['format'];
  sourceImageIds: string[]; factIds: string[]; width?: number; height?: number;
}
interface PrivateBundle {
  identity: string; runId: string; input: RenderRequest; expires: number; pending: boolean; files: PrivateArtifact[];
  copyText: string; sourcesMarkdown: string;
}
function renderIdentity(result: RunResult, input: RenderRequest, publication: string) {
  return createHash('sha256').update(JSON.stringify({ input, draft: result.drafts.find(d => d.platform === input.platform),
    evidence: result.evidence, review: result.review, publication, renderer: 2 })).digest('hex');
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
export async function getRenderAsset(handle: string, download = false) {
  restoreRenderState();
  if (!/^[a-f0-9-]{36}$/.test(handle)) throw new WorkflowError(400, '成品句柄无效。');
  const entry = assets.get(handle);
  if (!entry || Date.now() >= entry.expires) { await cleanup(); throw new WorkflowError(410, '成品已过期，请重新生成。'); }
  if ((download || entry.extension === 'zip') && !entry.exportable) throw new WorkflowError(409, '终审尚未完成或审核阻断，只允许带标记预览，不能正式导出。');
  const data = await readFile(entry.file).catch(() => { assets.delete(handle); throw new WorkflowError(410, '成品文件已不可读取，请重新排版。'); });
  return { ...entry, data };
}
async function removeGroup(group: string) {
  if (!/^[a-f0-9-]{36}$/.test(group)) return;
  for (const [id, asset] of assets) if (asset.group === group) assets.delete(id);
  groups.delete(group);
  stateStore().update(b => { for (const [id, value] of Object.entries(b.renderAssets || {})) if ((value as { group: string }).group === group) delete b.renderAssets[id]; delete b.renderBundles?.[group]; delete b.renderPrivate?.[group]; });
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
export async function renderRun(result: RunResult, input: RenderRequest, callerSignal?: AbortSignal, options: { publication?: 'preview' } = {}): Promise<RenderBundle> {
  restoreRenderState();
  const { template, draft, images: sourceImages, title } = validateRender(result, input);
  callerSignal?.throwIfAborted();
  const preview = options.publication === 'preview';
  const identity = renderIdentity(result, input, preview ? 'preview' : 'released');
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
    const finalMarker = `${result.review.status === 'blocked' ? '审核阻断 · 仅供预览' : result.review.status === 'needs_attention' ? '待确认 · 发布前复核' : '内容检查通过 · 发布前复核'}${result.brief.mode === 'demo' ? ' / 本地演示' : result.evidence.sourceMode === 'local' ? ' / 本地资料' : ''}`;
    const marker = preview ? '发布前复核' : finalMarker;
    const warnings = [...result.evidence.warnings, ...(result.review.status !== 'passed' ? ['请逐项查看审核面板；排版不改变原有审核结论。'] : []), ...(result.brief.mode === 'demo' ? ['本地规则演示，未调用模型或验证 ima。'] : [])];
    const expires = Date.now() + TTL;
    await mkdir(path.join(root, group), { recursive: true });
    const files: Record<string, Uint8Array> = {};
    const privateFiles: PrivateArtifact[] = [];
    const artifacts: RenderArtifact[] = [];
    async function save(data: Buffer, name: string, role: RenderArtifact['role'], format: RenderArtifact['format'], sourceImageIds: string[], factIds: string[], width?: number, height?: number) {
      const id = randomUUID(); const extension = format === 'png' ? 'png' : 'html';
      const file = path.join(root, group, `${id}.${extension}`);
      signal.throwIfAborted();
      if (preview) {
        const privateFile = path.join(root, group, `${id}.private.${extension}`);
        await writeFile(privateFile, data);
        privateFiles.push({ file: privateFile, name, role, format, sourceImageIds, factIds: [...new Set(factIds)], width, height });
        data = await markPreview(data, format, '审核中，仅供预览');
      }
      await writeFile(file, data); signal.throwIfAborted();
      assets.set(id, { file, group, expires, type: format === 'png' ? 'image/png' : 'text/html; charset=utf-8', extension, name, exportable }); files[name] = data;
      const url = `/api/render-assets/${id}`;
      artifacts.push({ id, role, format, name, previewUrl: url, ...(exportable ? { downloadUrl: `${url}?download=1` } : {}), width, height, sourceImageIds, factIds: [...new Set(factIds)] });
    }
    if (input.platform === 'wechat') {
      const allFacts = draft.blocks.flatMap(b => b.factIds);
      const html = await renderWechatArticle(draft, title, images, template, marker, signal);
      await save(Buffer.from(html), '公众号-排版文章.html', 'article', 'wechat-richtext', images.map(i => i.id), allFacts);
      const coverTemplate = { ...template, width: 1200, height: 900, platform: 'moments' as const };
      const cover = await renderEditorialCover(title, images.slice(0, 1), coverTemplate, marker, result.product.name, signal);
      if (process.env.RENDER_DEBUG === '1') console.log('render:wechat:cover:done');
      await save(cover, '公众号-封面.png', 'cover', 'png', images.slice(0, 1).map(i => i.id), [], 1200, 900);
      warnings.push('公众号文章中的图片为嵌入式预览，尚未上传微信素材库。粘贴到微信后请逐张上传或替换，并核对移动端显示。未自动发布。');
    } else if (input.platform === 'xiaohongshu') {
      const pages = planXhs(draft, title, images);
      const pngs = await renderXhs(pages, template, marker, result.product.name, signal);
      for (let i = 0; i < pages.length; i++) await save(pngs[i], `小红书-${String(i + 1).padStart(2, '0')}.png`, pages[i].role, 'png', pages[i].images.map(image => image.id), pages[i].factIds, 1080, 1440);
    } else {
      const png = input.platform === 'poster'
        ? await renderStorePoster(draft, title, images, template, marker, result.product.name, signal)
        : await renderMomentsCard(draft, title, images, template, marker, result.product.name, signal);
      await save(png, `${filenames[input.platform]}-01.png`, input.platform === 'poster' ? 'poster' : 'card', 'png', images.map(image => image.id), draft.blocks.flatMap(block => block.factIds), template.width, template.height);
    }
    const copyText = readable(copyDraft(draft, title), result);
    files['文案.txt'] = strToU8(copyText);
    const sourcesMarkdown = readable([`# ${result.product.name} · ${filenames[input.platform]}`, marker, result.notice,
      ...result.evidence.facts.filter(f => draft.blocks.some(b => b.factIds.includes(f.id))).map(f => `- ${f.statement}\n  条件：${f.qualifiers.join('；') || '详见原文'}\n  来源：${f.sourceTitle}`),
      ...sourceImages.map(i => `- 图片「${i.name}」：${i.sourceTitle}`), ...result.review.issues.map(i => `- ${i.message} ${i.suggestion}`), ...warnings,
    ].join('\n\n'), result);
    files['来源与审核.md'] = strToU8(sourcesMarkdown);
    let zipUrl: string | undefined;
    if (exportable) {
      const id = randomUUID(); const file = path.join(root, group, `${id}.zip`); const name = `${filenames[input.platform]}-成品与来源.zip`;
      await writeFile(file, zipSync(files, { level: 3 })); assets.set(id, { file, group, expires, type: 'application/zip', extension: 'zip', name, exportable }); zipUrl = `/api/render-assets/${id}?download=1`;
    }
    signal.throwIfAborted(); validateRender(result, input); await publishGroup(group, expires, signal);
    const bundle: RenderBundle = { id: group, runId: result.id, revision: result.revision, selectedTitleIndex: input.selectedTitleIndex, platform: input.platform, templateId: template.id,
      artifacts, reviewStatus: result.review.status, publication: preview ? 'preview' : exportable ? 'released' : 'blocked', warnings, copyText: exportable ? copyText : '', zipUrl, expiresAt: new Date(expires).toISOString() };
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
        const newAsset = async (data: Buffer, name: string, format: string) => {
          const id = randomUUID(), extension = format === 'png' ? 'png' : format === 'zip' ? 'zip' : 'html';
          const file = path.join(root, group, `${id}.${extension}`);
          signal?.throwIfAborted(); await writeFile(file, data); signal?.throwIfAborted();
          pendingAssets.set(id, { file, group, expires: privateBundle.expires, type: extension === 'png' ? 'image/png' : extension === 'zip' ? 'application/zip' : 'text/html; charset=utf-8', extension, name, exportable });
          return id;
        };
        for (const item of privateBundle.files) {
          if (path.dirname(path.resolve(item.file)) !== path.join(root, group) || !/^[a-f0-9-]{36}\.private\.(?:png|html)$/.test(path.basename(item.file))) throw new WorkflowError(503, '成品私有索引损坏，已保留记录，请检查本地存储。');
          let data: Buffer = await readFile(item.file).catch(() => { throw new WorkflowError(410, '预览底稿已过期或不可读取，请重新排版；正文已保留。'); });
          if (!exportable) data = await markPreview(data, item.format, '审核阻断，仅供预览');
          const id = await newAsset(data, item.name, item.format);
          const url = `/api/render-assets/${id}`;
          const { file: _privateFile, ...artifact } = item;
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
