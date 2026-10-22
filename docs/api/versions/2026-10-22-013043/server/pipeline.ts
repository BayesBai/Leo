import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Brief, Draft, EvidenceBundle, OutlineResult, Platform, ReviewReport, RunResult, Strategy, TraceEntry } from '../shared/types.js';
import { getEvidence } from './knowledge.js';
import { PLATFORM_POLICIES, buildDemoDrafts, buildStrategies, reviewDrafts } from './policies.js';
import { completeJson, modelConfig } from './model.js';
import { briefSchema, draftSchema, modelReviewSchema, strategySchema } from './schemas.js';
import { OUTLINE_WRITER_PROMPT, REVIEW_PROMPT, STRATEGY_PROMPT, WRITER_PROMPT } from './prompts.js';
import { channelInstruction } from './channels.js';
import { assertChannelImageCount, assertEvidenceImageAvailability } from './asset-policy.js';

export class InputRequiredError extends Error {
  constructor(public fields: { field: string; question: string }[]) { super('请补充必要信息后再生成。'); }
}

export function revisionPlatforms(instructions: string): Platform[] | undefined {
  const change = instructions.match(/(?:改成|改为|换成|换为|切换到|切到)\s*([\s\S]*)/);
  if (!change) return undefined;
  const mappings: [RegExp, Platform][] = [[/小红书/, 'xiaohongshu'], [/公众号/, 'wechat'], [/朋友圈/, 'moments'], [/海报/, 'poster']];
  const selected = mappings.filter(([pattern]) => pattern.test(change[1])).map(([, platform]) => platform);
  return selected.length ? selected.slice(0, 4) : undefined;
}

export function reusableEvidence(evidence: EvidenceBundle, now = Date.now()): boolean {
  const age = now - Date.parse(evidence.retrievedAt);
  return evidence.sourceMode === 'local' || Number.isFinite(age) && age >= 0 && age < 30 * 60_000;
}

export function parseBrief(input: unknown): Brief {
  const parsed = briefSchema.parse(input);
  const fields = [
    { field: 'productId', question: '请选择具体产品及系统版本。' },
    { field: 'audience', question: '这篇内容面向谁？例如大学新生、经常出差的职场人士。' },
    { field: 'scene', question: '需要解决哪个场景中的问题？例如开学购机或差旅办公。' },
  ].filter(item => !parsed[item.field as 'productId' | 'audience' | 'scene'].trim());
  if (fields.length) throw new InputRequiredError(fields);
  return {
    ...parsed, audience: parsed.audience.trim(), scene: parsed.scene.trim(),
    goal: parsed.goal.trim() || '到店体验', buyingStage: parsed.buyingStage.trim() || '对比选择',
    instructions: parsed.instructions.trim(),
  };
}

function context(brief: Brief, evidence: EvidenceBundle) {
  return JSON.stringify({
    task: brief,
    product: evidence.product,
    policies: Object.fromEntries(brief.platforms.map(platform => [platform, PLATFORM_POLICIES[platform]])),
    evidence: {
      sourceMode: evidence.sourceMode,
      facts: evidence.facts,
      images: evidence.images.map(({ url: _url, sourceUrl: _sourceUrl, ...image }) => image),
      warnings: evidence.warnings,
    },
  });
}

function platformSetSchema<T extends { platform: Platform }>(schema: z.ZodType<T>, requested: Platform[]) {
  return z.array(schema).length(requested.length).superRefine((items, ctx) => {
    if (new Set(items.map(item => item.platform)).size !== requested.length || items.some(item => !requested.includes(item.platform))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '输出平台必须与请求一一对应，不得遗漏、重复或添加平台。' });
    }
  });
}

export function mergeSemanticReview(base: ReviewReport, semantic: z.infer<typeof modelReviewSchema>): ReviewReport {
  // Literal qualifier matching is only a hint. An independent semantic pass decides whether a
  // paraphrase actually drops a condition; hard rule errors can never be cleared by the model.
  const ruleIssues = base.issues.filter(issue => {
    if (!(issue.category === 'fact' && issue.severity === 'warning' && issue.message.startsWith('改写后的段落可能缺少'))) return true;
    return semantic.issues.some(other => other.category === 'fact'
      && (!other.platform || other.platform === issue.platform)
      && (!other.blockId || other.blockId === issue.blockId)
      && (!other.factId || other.factId === issue.factId));
  });
  const issues = [...ruleIssues, ...semantic.issues.map((issue, index) => ({ ...issue, id: `semantic-${index + 1}` }))];
  const errors = issues.filter(issue => issue.severity === 'error');
  const blocked = errors.length > 0;
  return {
    ...base, issues, reviewedBy: 'rules+model',
    status: blocked ? 'blocked' : issues.some(issue => issue.severity !== 'info') ? 'needs_attention' : 'passed',
    checks: [...base.checks.map(check => check.label === '事实与引用' && !ruleIssues.some(issue => issue.category === 'fact')
      ? { ...check, status: 'pass' as const, detail: '引用编号与数值检查通过；限定条件改写已结合原文进行独立语义复核。' }
      : check), {
      label: '独立模型审稿', status: errors.length ? 'fail' : semantic.issues.some(issue => issue.severity === 'warning') ? 'warning' : 'pass',
      detail: semantic.summary,
    }],
  };
}

/** Actions depend on server-owned writer capabilities, never on a model's requested action. */
function resolveReviewActions(review: ReviewReport, fixedOutline: boolean): ReviewReport {
  return { ...review, issues: review.issues.map(issue => {
    let resolution: NonNullable<typeof issue.resolution>;
    if (issue.resolution === 'refresh_evidence') resolution = 'refresh_evidence';
    else if (issue.target === 'source' || issue.category === 'source') resolution = issue.severity === 'error' ? 'refresh_evidence' : 'manual_review';
    else if (!issue.target) resolution = 'manual_review';
    else if (fixedOutline && ['title', 'heading', 'images', 'references', 'structure'].includes(issue.target)) resolution = 'edit_outline';
    else resolution = issue.severity === 'info' ? 'manual_review' : 'auto_text';
    return { ...issue, resolution };
  }) };
}

function needsTextRepair(issue: ReviewReport['issues'][number]) {
  return issue.resolution === 'auto_text' && (issue.severity === 'error' || issue.severity === 'warning' && ['fact', 'image', 'platform'].includes(issue.category));
}

function shortenDemoDrafts(drafts: Draft[], instructions: string): Draft[] {
  if (!/精简|缩短|压缩|简短|更短/.test(instructions)) return drafts;
  return drafts.map(draft => ({
    ...draft,
    intro: draft.platform === 'moments' || draft.platform === 'poster' ? '' : '从日常任务出发，先看与你有关的配置，再到店确认。',
    blocks: draft.blocks.slice(0, draft.platform === 'poster' || draft.platform === 'moments' ? 1 : 2),
    images: draft.images.map(image => ({ ...image, afterBlock: Math.min(image.afterBlock, (draft.platform === 'poster' || draft.platform === 'moments' ? 1 : 2) - 1) })),
  }));
}

export function evidenceForInstructions(evidence: EvidenceBundle, instructions: string): EvidenceBundle {
  const removeGroups: [RegExp, RegExp][] = [
    [/(?:去掉|删掉|删除|不写|不要).{0,8}(?:续航|电池)/, /续航|电池|供电/],
    [/(?:去掉|删掉|删除|不写|不要).{0,8}(?:屏幕|显示)/, /屏幕|显示|分辨率|OLED/],
    [/(?:去掉|删掉|删除|不写|不要).{0,8}(?:重量|轻薄)/, /重量|机身尺寸|厚度|kg|千克/],
  ];
  const filters = removeGroups.filter(([request]) => request.test(instructions)).map(([, fact]) => fact);
  if (!filters.length) return evidence;
  const facts = evidence.facts.filter(fact => !filters.some(pattern => pattern.test(fact.statement)));
  if (!facts.length) throw new Error('删除指定卖点后没有可用事实，请选择其他卖点或放宽要求。');
  return { ...evidence, facts, warnings: [...evidence.warnings, '已按修改要求排除指定卖点；未额外补写产品事实。'] };
}

export function publicResult(result: RunResult): RunResult {
  return { ...result, evidence: { ...result.evidence, sources: result.evidence.sources.map(({ text: _text, ...source }) => source) } };
}

export async function runPipeline(
  brief: Brief,
  onProgress: (entry: TraceEntry) => void = () => {},
  options: { signal?: AbortSignal; evidence?: EvidenceBundle; revision?: number; previous?: RunResult; onEvidence?: (evidence: EvidenceBundle) => void; outline?: OutlineResult } = {},
): Promise<RunResult> {
  const trace: TraceEntry[] = [];
  const totalStart = Date.now();
  const stage = (step: string, label: string, detail: string, status: TraceEntry['status'] = 'done') => {
    options.signal?.throwIfAborted();
    const entry: TraceEntry = { step, label, status, detail, at: new Date().toISOString(), elapsedMs: Date.now() - totalStart };
    if (status === 'running' && trace.at(-1)?.step === step && trace.at(-1)?.status === 'running') trace[trace.length - 1] = entry;
    else trace.push(entry);
    onProgress(entry);
  };
  stage('understand', '理解营销任务', `${brief.audience} · ${brief.scene} · ${brief.platforms.length} 个发布平台`);
  if (brief.mode === 'live' && !modelConfig().configured) throw new Error('未配置模型密钥。请在 .env.local 填写 LLM_API_KEY 并重启，或主动选择本地演示。');
  const cachedEvidence = options.evidence && reusableEvidence(options.evidence) ? options.evidence : undefined;
  stage('retrieve', '读取资料与图片', cachedEvidence ? '复用本次会话已读取的同型号证据' : brief.knowledgeSource === 'ima' ? '正在读取指定 ima 共享库' : '读取本地产品事实与图片索引', 'running');
  let evidence = cachedEvidence || await getEvidence(brief.productId, brief.knowledgeSource, options.signal);
  options.onEvidence?.(evidence);
  evidence = evidenceForInstructions(evidence, brief.instructions);
  if (evidence.sourceMode !== brief.knowledgeSource) throw new Error('证据来源与请求不一致，已停止生成。');
  if (evidence.product.id !== brief.productId) throw new Error('产品身份与检索结果不一致，已停止生成。');
  if (!evidence.facts.length || evidence.facts.every(fact => fact.status !== 'supported')) throw new Error('没有取得可由原文支持的产品事实，不能生成产品软文。');
  assertEvidenceImageAvailability(brief.platforms, evidence);
  if (options.outline) for (const platform of options.outline.platforms) assertChannelImageCount(platform.platform, platform.imageIds.length);
  stage('retrieve', '读取资料与图片', `取得 ${evidence.facts.length} 条事实和 ${evidence.images.length} 张同型号图片；来源：${evidence.sourceMode === 'ima' ? 'ima' : '本地资料'}`);
  stage('strategy', '制定平台策略', brief.mode === 'live' ? '模型根据人群与场景制定内容策略' : '演示规则根据人群与场景选择内容切入点', 'running');
  let strategies: Strategy[];
  const ctx = context(brief, evidence);
  if (options.outline) {
    strategies = options.outline.platforms.map(p => ({ platform: p.platform, angle: p.angle, painPoint: `${brief.audience}在${brief.scene}的选购需求`,
      sellingPoints: p.sections.flatMap(s => s.factIds.map(factId => ({ factId, benefit: s.heading }))),
      tone: '按确认大纲组织', structure: p.sections.map(s => s.heading), imageCount: p.imageIds.length, cta: p.cta, buyingStage: brief.buyingStage }));
  } else if (brief.mode === 'live') {
    const output = await completeJson(STRATEGY_PROMPT, ctx, z.object({ strategies: platformSetSchema(strategySchema, brief.platforms) }), options.signal, 2400,
      characters => stage('strategy', '制定平台策略', `模型正在输出结构化策略，已接收 ${characters} 个字符`, 'running'));
    strategies = output.strategies;
    for (const strategy of strategies) {
      if (strategy.sellingPoints.some(point => !evidence.facts.some(fact => fact.id === point.factId && fact.status === 'supported'))) throw new Error('策划引用了无依据的事实，已停止生成。');
    }
  } else strategies = buildStrategies(brief, evidence);
  stage('strategy', '制定平台策略', strategies.map(strategy => `${PLATFORM_POLICIES[strategy.platform].name}：${strategy.angle}`).join('；'));
  stage('write', '编排与创作图文', brief.mode === 'live' ? '模型按平台结构组织原创内容' : '规则引擎生成演示文案，不代表模型调用结果', 'running');
  let drafts: Draft[];
  const write = async (feedback?: { drafts: Draft[]; issues: ReviewReport['issues'] }) => {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try {
      return await Promise.all(brief.platforms.map(async platform => {
        const previous = options.previous ? `\n上次稿件（按本次 instructions 定向修改，其余合适内容保留；更换平台时重新编排）：${JSON.stringify(options.previous.drafts.filter(draft => draft.platform === platform))}` : '';
        const scopedFeedback = feedback ? { drafts: feedback.drafts.filter(draft => draft.platform === platform), issues: feedback.issues.filter(issue => !issue.platform || issue.platform === platform) } : undefined;
        if (scopedFeedback && !scopedFeedback.issues.some(needsTextRepair)) {
          const existing = scopedFeedback.drafts[0];
          if (existing) return existing;
        }
        const scopedContext = context({ ...brief, platforms: [platform] }, evidence);
        const approved = options.outline?.platforms.find(p => p.platform === platform);
        if (approved) {
          const approvedSchema = z.object({ intro: z.string().max(1000),
            blocks: z.array(z.object({ id: z.string().max(40), text: z.string().min(1).max(2200) })).length(approved.sections.length)
              .refine(blocks => new Set(blocks.map(b => b.id)).size === approved.sections.length && blocks.every(b => approved.sections.some(s => s.id === b.id)), '必须逐一填写已确认段落，保留原段落ID'),
            cta: z.string().min(1).max(500), tags: z.array(z.string().max(40)).max(8) });
          const output = await completeJson(`${OUTLINE_WRITER_PROMPT}\n${channelInstruction(platform)}`, `${scopedContext}\n确认的大纲：${JSON.stringify(approved)}${scopedFeedback ? `\n仅修复这些审核问题：${JSON.stringify(scopedFeedback)}` : ''}`, approvedSchema, signal, 3500,
            characters => stage(feedback ? 'repair' : 'write', feedback ? '定向修订一次' : '按确认大纲写作', `${PLATFORM_POLICIES[platform].name}：已接收 ${characters} 个字符`, 'running'));
          return { id: `${platform}-${randomUUID().slice(0, 8)}`, platform, titles: [approved.title], intro: output.intro,
            blocks: approved.sections.map(section => ({ id: section.id, heading: section.heading, text: output.blocks.find(b => b.id === section.id)!.text, factIds: [...section.factIds] })),
            cta: output.cta, tags: output.tags, images: approved.imageIds.map((imageId, i) => ({ imageId, afterBlock: i === 0 ? -1 : Math.min(i - 1, approved.sections.length - 1), caption: evidence.images.find(image => image.id === imageId)?.description || '', reason: '确认大纲中的同型号素材' })) };
        }
        const writerSchema = z.object({ drafts: platformSetSchema(draftSchema, [platform]) });
        const output = await completeJson(`${WRITER_PROMPT}\n${channelInstruction(platform)}`, `${scopedContext}\n策略：${JSON.stringify(strategies.filter(strategy => strategy.platform === platform))}${previous}${scopedFeedback ? `\n需要修订的稿件与审核问题：${JSON.stringify(scopedFeedback)}` : ''}`, writerSchema, signal, 3500,
          characters => stage(feedback ? 'repair' : 'write', feedback ? '定向修订一次' : '编排与创作图文', `${PLATFORM_POLICIES[platform].name}：已接收 ${characters} 个字符，完成后统一核验`, 'running'));
        const draft = output.drafts[0];
        return { ...draft, id: `${platform}-${randomUUID().slice(0, 8)}` };
      }));
    } catch (error) { controller.abort(); throw error; }
  };
  if (brief.mode === 'live') drafts = await write();
  else {
    if (options.previous && brief.instructions && !/精简|缩短|压缩|简短|更短|去掉|删掉|删除|不写|不要|恢复|换平台|改成|换成|突出|强调|优先|价格|补贴|亲测|实测|第一|最好|最强|元/.test(brief.instructions)) {
      throw new Error('本地规则演示支持精简文案、移除卖点和切换平台。指定段落的自由改写请配置模型并使用模型创作。');
    }
    drafts = options.outline ? options.outline.platforms.map(p => ({ id: `${p.platform}-${randomUUID().slice(0, 8)}`, platform: p.platform,
      titles: [p.title], intro: p.intro, blocks: p.sections.map(s => ({ id: s.id, heading: s.heading, text: s.points.join('\n'), factIds: s.factIds })),
      cta: p.cta, tags: [], images: p.imageIds.map((id, i) => ({ imageId: id, afterBlock: i === 0 ? -1 : Math.min(i - 1, p.sections.length - 1), caption: evidence.images.find(image => image.id === id)?.description || '', reason: '确认大纲的同型号配图' })) })) : shortenDemoDrafts(buildDemoDrafts(brief, evidence, strategies), brief.instructions);
  }
  stage('write', '编排与创作图文', `完成 ${drafts.length} 份稿件，图片均引用本次证据包`);
  stage('review', '核验事实、图片与表达', brief.mode === 'live' ? '执行规则检查与独立模型审稿' : '执行来源、引用、图片和表达的规则初检', 'running');
  let review = resolveReviewActions(reviewDrafts(brief, evidence, drafts), !!options.outline);
  if (brief.mode === 'live') {
    const inspect = async () => {
      const semantic = await completeJson(`${REVIEW_PROMPT}\n每个问题须用target定位具体字段：title、intro、heading、body、cta、tags、images、references、structure或source；不确定位置时省略target，不要猜测。不要返回resolution，修复动作由服务端确定。`, `${ctx}\n稿件：${JSON.stringify(drafts)}`, modelReviewSchema, options.signal, 3000,
        characters => stage('review', '核验事实、图片与表达', `独立审稿正在输出检查结果，已接收 ${characters} 个字符`, 'running'));
      return resolveReviewActions(mergeSemanticReview(reviewDrafts(brief, evidence, drafts), semantic), !!options.outline);
    };
    review = await inspect();
    if (review.issues.some(needsTextRepair)) {
      stage('repair', '定向修订一次', '按明确审核问题修订，并重新进行规则与模型审稿', 'running');
      drafts = await write({ drafts, issues: review.issues.filter(needsTextRepair) });
      review = await inspect();
      stage('repair', '定向修订一次', review.issues.some(issue => issue.severity === 'error') ? '仍有问题，已保留待确认状态' : '修订后的错误项已消除');
    } else if (review.issues.some(issue => issue.resolution === 'edit_outline' || issue.resolution === 'refresh_evidence')) {
      stage('repair', '需要调整大纲或资料', '问题位于已确认结构或原始资料中，请按审核动作重新编辑或取证；未重复调用正文模型。');
    }
  }
  stage('review', '核验事实、图片与表达', `${review.citedFactCount} 条事实被引用，${review.imageCount} 张图片被编排；${review.status === 'passed' ? '检查通过' : '请查看审核与待确认项'}`);
  stage('done', '结果已就绪', '可对比平台策略、查看依据、继续修改或导出');
  return {
    id: randomUUID(), createdAt: new Date().toISOString(), brief, product: evidence.product,
    evidence, strategies, drafts, review, trace, revision: options.revision || 1,
    ...(options.outline ? { outline: { id: options.outline.id, version: options.outline.version } } : {}),
    notice: brief.mode === 'demo'
      ? '本地演示：文案由规则引擎生成，资料来自本地知识库。未调用大模型、未验证 ima 接入，也未复核当前官网事实。'
      : evidence.sourceMode === 'local'
        ? '模型创作已完成；产品依据来自本地资料，尚未从指定 ima 共享库取得。正式参赛请切换 ima 接入。'
        : `${evidence.images.length ? '资料与已展示图片通过 ima 接口取得' : '产品资料通过 ima 接口取得，尚未取得可用的同型号图片'}；模型已完成创作与审稿。发布前请复核待确认项和动态信息。`,
  };
}
