import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Brief, EvidenceBundle, OutlineResult, PlatformOutline, HistoryItem } from '../shared/types.js';
import { getEvidence, captureEvidenceBinding, rememberEvidenceBinding, restoreEvidenceBinding, assertEvidenceCurrent, evidenceStatus, type EvidenceBinding } from './knowledge.js';
import { buildDemoDrafts, buildStrategies, PLATFORM_POLICIES } from './policies.js';
import { completeJson } from './model.js';
import { SYSTEM_BOUNDARIES } from './prompts.js';
import { outlinePlatformSchema } from './schemas.js';
import { evidenceForInstructions, reusableEvidence } from './pipeline.js';
import { channelInstruction } from './channels.js';
import { assertChannelImageCount, assertEvidenceImageAvailability } from './asset-policy.js';
import { stateStore, HISTORY_TTL, markOperation, finishOperation, wasInterrupted } from './state-store.js';

export class WorkflowError extends Error { constructor(public status: number, message: string) { super(message); } }
type SavedOutline = { outline: OutlineResult; updatedAt: number; expiresAt: number; binding?: EvidenceBinding };
const store = new Map<string, SavedOutline & { busy: boolean }>();
function cacheOutline(id: string, entry: SavedOutline & { busy: boolean }) {
  while (!store.has(id) && store.size >= 40) { const idle = [...store].find(([, e]) => !e.busy); if (!idle) break; store.delete(idle[0]); }
  store.set(id, entry);
}
function persistOutline(outline: OutlineResult) {
  const clean = publicOutline(outline); delete clean.history;
  const entry = { outline: clean, updatedAt: Date.now(), expiresAt: Date.now() + HISTORY_TTL, binding: captureEvidenceBinding(outline.evidence) };
  stateStore().set('outlines', outline.id, entry);
  cacheOutline(outline.id, { ...entry, outline, busy: false });
  return getOutline(outline.id);
}
export function getOutline(id: string, version?: number) {
  let entry = store.get(id);
  if (!entry) { const saved = stateStore().get<SavedOutline>('outlines', id); if (saved) { restoreEvidenceBinding(saved.outline.evidence, saved.binding); entry = { ...saved, busy: false }; cacheOutline(id, entry); } }
  if (!entry || Date.now() >= entry.expiresAt) { store.delete(id); throw new WorkflowError(410, '大纲已超过七天留存期，请重新策划。'); }
  rememberEvidenceBinding(entry.outline.evidence, entry.binding);
  if (version !== undefined && version !== entry.outline.version) throw new WorkflowError(409, '大纲版本已改变，请载入最新版本后再操作。');
  if (entry.busy) throw new WorkflowError(409, '这个大纲正在修改，请等待完成。');
  return { ...entry.outline, history: { expiresAt: new Date(entry.expiresAt).toISOString(), evidenceStatus: evidenceStatus(entry.outline.evidence), ...(wasInterrupted(id) ? { interrupted: true } : {}) } };
}
export function outlineHistory(): HistoryItem[] {
  return stateStore().entries<SavedOutline>('outlines').filter(([, e]) => e.expiresAt > Date.now()).map(([id, e]) => {
    restoreEvidenceBinding(e.outline.evidence, e.binding);
    return { kind: 'outline', id, productName: e.outline.product.name, audience: e.outline.brief.audience, scene: e.outline.brief.scene, platforms: e.outline.brief.platforms,
      version: e.outline.version, createdAt: e.outline.createdAt, updatedAt: new Date(e.updatedAt).toISOString(), expiresAt: new Date(e.expiresAt).toISOString(), evidenceStatus: evidenceStatus(e.outline.evidence), ...(wasInterrupted(id) ? { interrupted: true } : {}) };
  });
}
export function publicOutline(outline: OutlineResult): OutlineResult {
  return { ...outline, evidence: { ...outline.evidence, sources: outline.evidence.sources.map(({ text: _text, ...source }) => source) } };
}
export function validateOutline(platforms: PlatformOutline[], brief: Brief, evidence: EvidenceBundle) {
  if (platforms.length !== brief.platforms.length || new Set(platforms.map(p => p.platform)).size !== platforms.length || platforms.some(p => !brief.platforms.includes(p.platform))) throw new WorkflowError(400, '大纲平台必须与任务一一对应。');
  for (const p of platforms) {
    if (p.platform === 'poster' && p.sections.length > 3) throw new WorkflowError(400, '海报最多三个卖点。');
    if (new Set(p.sections.map(s => s.id)).size !== p.sections.length) throw new WorkflowError(400, '段落 ID 不能重复。');
    if (p.sections.some(s => s.factIds.some(id => !evidence.facts.some(f => f.id === id && f.status === 'supported')))) throw new WorkflowError(400, '存在无效或未经原文支持的事实引用。');
    if (new Set(p.imageIds).size !== p.imageIds.length || p.imageIds.some(id => !evidence.images.some(i => i.id === id && i.productId === brief.productId && i.sourceMode === evidence.sourceMode && !!i.url))) throw new WorkflowError(400, '配图重复、失效或与产品型号不匹配。');
    assertChannelImageCount(p.platform, p.imageIds.length);
  }
}
const PROMPT = `${SYSTEM_BOUNDARIES}\n你现在只策划可编辑大纲，不写成品正文。严格返回 {"platforms":[{"platform":"...","title":"标题","angle":"与客户任务相关的切入点","intro":"导语意图","sections":[{"id":"b1","heading":"段落标题","points":["写作要点，包含事实必要限制"],"factIds":["..."]}],"imageIds":["..."],"cta":"行动引导"}]}。海报最多三个段落；不同平台分别组织。人群是销售员面向的客户。不要增加产品能力。标题、导语意图和CTA只写选题或邀请，不写产品参数、数字或能力断言（完整产品名称除外）；所有具体规格仅安排在引用了对应factIds的段落。结尾的建议段若要重提某参数，也必须引用支持该参数的factId；否则只写不含参数的选择步骤。段落标题要是给读者看的自然短句，不得出现“有引用的核心看点”“事实段落”等内部工作术语。`;
async function plan(brief: Brief, evidence: EvidenceBundle, signal?: AbortSignal, prior?: PlatformOutline[], instructions?: string) {
  signal?.throwIfAborted();
  let platforms: PlatformOutline[];
  if (brief.mode === 'live') {
    const { sources: _sources, images, ...facts } = evidence;
    const planSchema = z.object({ platforms: z.array(outlinePlatformSchema).min(1).max(4) }).superRefine((value, ctx) => {
      try { validateOutline(value.platforms, brief, evidence); }
      catch (error) { ctx.addIssue({ code: 'custom', path: ['platforms'], message: error instanceof Error ? error.message : '大纲中的平台、事实或配图选择无效。' }); }
      if (new Set(value.platforms.map(p => p.title.trim())).size !== value.platforms.length) ctx.addIssue({ code: 'custom', message: '不同渠道必须分别策划不同标题。' });
      for (const p of value.platforms) if (p.platform === 'moments' && p.sections.length !== 1 || p.platform === 'wechat' && p.sections.length < 3 || p.platform === 'xiaohongshu' && p.sections.length < 2) ctx.addIssue({ code: 'custom', message: '公众号至少3段、小红书至少2个清单点、朋友圈只留1个核心看点。' });
    });
    platforms = (await completeJson(PROMPT, JSON.stringify({ task: brief, policies: Object.fromEntries(brief.platforms.map(p => [p, PLATFORM_POLICIES[p]])), channelBriefs: brief.platforms.map(channelInstruction), evidence: { ...facts, images: images.map(({ url: _url, sourceUrl: _source, ...image }) => image) }, prior, modification: instructions }), planSchema, signal, 6500)).platforms;
  } else {
    const strategies = buildStrategies(brief, evidence);
    platforms = buildDemoDrafts(brief, evidence, strategies).map(draft => ({ platform: draft.platform,
      title: draft.titles[0], angle: strategies.find(s => s.platform === draft.platform)!.angle, intro: draft.intro,
      sections: draft.blocks.map(b => ({ id: b.id, heading: b.heading, points: [b.text], factIds: b.factIds })),
      imageIds: draft.images.map(i => i.imageId), cta: draft.cta }));
    if (prior) {
      if (!/精简|缩短|压缩|更短/.test(instructions || '')) throw new WorkflowError(422, '本地演示的大纲 AI 修改支持“精简”；其他修改可直接手动编辑，或切换模型创作。');
      platforms = prior.map(p => ({ ...p, sections: p.sections.slice(0, p.platform === 'poster' || p.platform === 'moments' ? 1 : 2) }));
    }
  }
  if (!prior && brief.mode === 'demo' && /精简|缩短|压缩|更短/.test(brief.instructions)) platforms = platforms.map(p => ({ ...p, sections: p.sections.slice(0, p.platform === 'poster' || p.platform === 'moments' ? 1 : 2) }));
  validateOutline(platforms, brief, evidence); return platforms;
}
export async function createOutline(brief: Brief, signal?: AbortSignal, options: { evidence?: EvidenceBundle } = {}) {
  const evidence = evidenceForInstructions(options.evidence || await getEvidence(brief.productId, brief.knowledgeSource, signal), brief.instructions);
  if (evidence.product.id !== brief.productId || evidence.sourceMode !== brief.knowledgeSource) throw new WorkflowError(422, '产品或证据来源与任务不一致。');
  if (!evidence.facts.some(f => f.status === 'supported')) throw new WorkflowError(422, '没有可支持写作的产品事实。');
  assertEvidenceImageAvailability(brief.platforms, evidence);
  const platforms = await plan(brief, evidence, signal);
  signal?.throwIfAborted();
  const outline: OutlineResult = { id: randomUUID(), version: 1, status: 'editing', createdAt: new Date().toISOString(), brief, product: evidence.product, evidence, platforms,
    warnings: [...evidence.warnings, ...(brief.mode === 'demo' ? ['本地规则大纲，未调用大模型；可直接编辑后确认。'] : []), '大纲确认仅确认写作结构，正文仍需事实与合规审稿。'] };
  return persistOutline(outline);
}
export function saveOutline(id: string, version: number, platforms: PlatformOutline[]) {
  const old = getOutline(id, version); assertEvidenceCurrent(old.evidence); validateOutline(platforms, old.brief, old.evidence);
  const next: OutlineResult = { ...old, platforms: structuredClone(platforms), version: old.version + 1, status: 'editing', confirmedAt: undefined };
  return persistOutline(next);
}
export async function reviseOutline(id: string, version: number, instructions: string, signal?: AbortSignal) {
  const old = getOutline(id, version); assertEvidenceCurrent(old.evidence); const entry = store.get(id)!; const token = markOperation(id, 'revise'); entry.busy = true;
  try {
    const platforms = await plan(old.brief, old.evidence, signal, old.platforms, instructions);
    signal?.throwIfAborted(); entry.busy = false; return saveOutline(id, version, platforms);
  } finally { entry.busy = false; try { finishOperation(token); } catch { /* an uncleared marker is safe to report as interrupted after restart */ } }
}
export function confirmOutline(id: string, version: number) {
  const outline = getOutline(id, version); validateOutline(outline.platforms, outline.brief, outline.evidence);
  assertEvidenceCurrent(outline.evidence);
  if (!reusableEvidence(outline.evidence)) throw new WorkflowError(410, '大纲的资料已过期，请重新检索并确认。');
  const next: OutlineResult = { ...outline, status: 'confirmed', confirmedAt: new Date().toISOString() };
  return persistOutline(next);
}
export function confirmedOutline(id: string, version: number) {
  const outline = getOutline(id, version);
  assertEvidenceCurrent(outline.evidence);
  if (outline.status !== 'confirmed') throw new WorkflowError(409, '请先保存并确认本版大纲，再生成正文。');
  if (!reusableEvidence(outline.evidence)) throw new WorkflowError(410, '资料已过期，请重新生成大纲。');
  return structuredClone(outline);
}
