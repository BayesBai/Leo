import { createHash } from 'node:crypto';
import type { RenderRequest, RunResult } from '../../shared/types.js';
import type { PosterApproval } from '../../shared/poster.js';
import { WorkflowError } from '../outlines.js';
import { DESIGN_SKILL_HASHES, DESIGN_RULES } from './rules.js';

export const POSTER_DESIGN_VERSION = 'virgo-poster-image-1.0.0';
export const POSTER_NATIVE_SIZE = '1024x1536' as const;
export const POSTER_NOTICE = '这张海报由生图 API 整图生成。本次仅发送文字 Prompt，没有上传产品原图或参考图；请对照同型号原图人工核对中文、产品型号外观及参数适用条件后，再确认正式下载。';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function posterContentFingerprint(result: RunResult, input: RenderRequest) {
  const draft = result.drafts.find(value => value.platform === 'poster');
  return digest({ version: POSTER_DESIGN_VERSION, skills: DESIGN_SKILL_HASHES, runId: result.id, revision: result.revision, deliveryId: input.deliveryId,
    selectedTitleIndex: input.selectedTitleIndex, templateId:input.templateId, product: result.product, draft, review: result.review, evidence: result.evidence });
}

export function buildPosterPrompt(result: RunResult, input: RenderRequest) {
  const draft = result.drafts.find(value => value.platform === 'poster');
  if (!draft || !draft.titles[input.selectedTitleIndex]) throw new WorkflowError(400, '海报标题或渠道不存在。');
  const requiredCopy = [result.product.name, draft.titles[input.selectedTitleIndex], draft.intro, ...draft.blocks.flatMap(block => [block.heading, block.text]), draft.cta].filter(value => value.trim());
  const ids = new Set(draft.blocks.flatMap(block => block.factIds));
  const factChecks: PosterApproval['factChecks'] = result.evidence.facts.filter(fact => ids.has(fact.id)).map(fact => ({ factId: fact.id, statement: fact.statement, qualifiers: [...fact.qualifiers], sourceTitle: fact.sourceTitle }));
  const originalIds = new Set(draft.images.map(image => image.imageId));
  const referenceImages = result.evidence.images.filter(image => originalIds.has(image.id) && image.productId === result.product.id).map(image => ({ id: image.id, name: image.name, url: image.url }));
  if (!referenceImages.length) throw new WorkflowError(422, '海报人工核对至少需要一张有效同型号原图。');
  const prompt = [
    `制作一张完整的中文门店商业海报，单幅竖版；不是背景素材，不是多页文章、图文卡片或拼图。设计版本：${POSTER_DESIGN_VERSION}。`,
    `API 请求尺寸 ${POSTER_NATIVE_SIZE}，按原生画幅设计。只输出一张最终图片；四边至少保留画面宽度6%的安全边距，文字和产品不得越界或被裁切。`,
    `受众：${result.brief.audience}。真实使用场景：${result.brief.scene}。目标：${result.brief.goal}。补充要求：${result.brief.instructions || '无'}。`,
    `产品精确型号：${result.product.name}。本次请求没有附带参考图片，也没有产品图片输入；不要声称复用了原图。准确表现该型号外观，无法确定的细节保持克制，禁止编造接口、认证徽章、系统界面或品牌标志。`,
    `信息层级与构图：一个核心主标题形成唯一视觉重心；产品主体占中部主要区域；必要说明与条件形成清晰次级信息；底部以一个行动引导收束。不制作额外营销文案、话题标签、来源表、审稿结果或审核水印。`,
    `必须逐字准确出现在画面中的中文和产品文字（JSON 数组仅用于界定每项原文，画面不要显示数组、序号或字段名）：\n${JSON.stringify(requiredCopy, null, 2)}`,
    `事实及其完整适用条件（仅可使用以下已核对事实，不可添加新性能、价格、折扣或承诺；条件必须与相关事实同时清晰出现，不得被小字藏起）：\n${JSON.stringify(factChecks, null, 2)}`,
    '文字规则：不翻译、不改写、不省略或新增型号、数字、单位与限定条件；使用清晰中文字体。主标题、型号、核心说明和条件形成稳定字号层级。若空间紧张应减少装饰并调整构图，不要截断文字或把必要条件缩成难读小字。',
    `视觉规则：${DESIGN_RULES.composition} ${DESIGN_RULES.concept} ${DESIGN_RULES.refinement}`,
    '色彩与材质：主色一到两种，强调色一项，留白充足；光线、真实材质和产品比例一致。不得使用无关炫光、密集装饰、假二维码、联系方式、店址或未经提供的价格。',
    `色板方向：${input.templateId.includes('ink')?'深墨蓝背景，米白文字，低饱和暖金强调，清晰但不刺眼。':'温暖纸白背景，墨绿文字，低饱和陶土色强调，细腻纸面与自然光。'}`,
    '交付前自查：单张完整海报；文字逐字正确；型号与外观一致；事实及条件完整；视觉主次明确；没有审核、预览、检查通过、水印等标签。',
  ].join('\n\n');
  if (prompt.length > 60_000) throw new WorkflowError(422, '当前海报文字及事实过长，请精简已确认大纲后再生成；未调用生图。');
  return { prompt, promptHash: createHash('sha256').update(prompt).digest('hex'), skillVersion: POSTER_DESIGN_VERSION, skillHashes: { ...DESIGN_SKILL_HASHES }, requiredCopy, factChecks, referenceImages,
    contentFingerprint: posterContentFingerprint(result, input), notice: POSTER_NOTICE, nativeSize: POSTER_NATIVE_SIZE };
}
