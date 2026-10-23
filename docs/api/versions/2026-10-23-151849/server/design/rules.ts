import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Brief, Draft, Platform, RenderTemplate } from '../../shared/types.js';
import { WorkflowError } from '../outlines.js';

/** These are audited project adaptations, not an executable installation of a desktop skill. */
export const DESIGN_SKILL_VERSION = 'virgo-visual-1.0.0';
const manifest = JSON.parse(readFileSync(new URL('./vendor/manifest.json', import.meta.url), 'utf8')) as { path: string; sha256: string; commit: string; repository: string }[];
export const DESIGN_SKILL_HASHES: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(manifest.map(item => {
  const bytes = readFileSync(new URL(`./vendor/${item.path}`, import.meta.url));
  if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`设计规则文件校验失败：${item.path}`);
  return [item.path, item.sha256];
})));
export const DESIGN_RULES = Object.freeze({
  composition: '用一个明确的视觉重心、尺度对比、网格对齐和充分留白形成阅读次序；元素必须服务受众的真实任务。',
  concept: '从使用场景提炼一个核心视觉隐喻；避开通用科技光效、无关装饰和堆砌卖点。',
  series: '先确立封面视觉，再让内页沿用同一色板、字体、边距和节奏；每页承担明确的信息职责。',
  wechat: '正文保留可复制的真实文字与内联样式，段落有呼吸，标题有层级；图片原比例、移动端自适应。',
  truth: '真实产品素材单独叠加，中文标题和正文为可编辑文字层；AI 仅负责不含产品、文字与标识的场景背景。',
  refinement: '交付前检查对齐、对比、文字完整性、四边安全区、产品比例、每页密度与系列一致性。',
});
const required = z.string().trim().min(1).max(5000);
const rect = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).refine(r => r.x + r.width <= 1.001 && r.y + r.height <= 1.001, '区域超出画幅');
export const designBriefSchema = z.object({
  version: z.literal(DESIGN_SKILL_VERSION), platform: z.enum(['xiaohongshu', 'wechat', 'poster']),
  audience: required, scene: required, goal: required, productName: required,
  canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  pageRole: required, visualConcept: required, focalVisual: required,
  productZone: rect, titleZone: rect, bodyZone: rect,
  safeMargins: z.object({ top: z.number().min(32), right: z.number().min(32), bottom: z.number().min(32), left: z.number().min(32) }),
  readingOrder: z.array(required).min(3), palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).min(3).max(5),
  typography: z.object({ family: required, titlePx: z.number().min(32), bodyPx: z.number().min(20), hierarchy: required }),
  lightAndMaterial: required, seriesConsistency: required, forbidden: z.array(required).min(5),
  exactCopy: z.object({ title: required, intro: z.string(), headings: z.array(z.string()), body: z.array(z.string()), cta: z.string() }),
  rules: z.object({ composition: required, concept: required, series: required, wechat: required, truth: required, refinement: required }),
});
export type DesignBrief = z.infer<typeof designBriefSchema>;
export interface BuildDesignBriefInput { draft: Draft; brief: Pick<Brief, 'audience' | 'scene' | 'goal' | 'instructions'>; title: string; productName: string; template?: RenderTemplate }
export function buildDesignBrief(input: BuildDesignBriefInput): DesignBrief {
  const { draft, brief, title, productName, template } = input;
  if (draft.platform === 'moments') throw new WorkflowError(422, '朋友圈直接交付文案与产品原图，不创建生图设计简报。');
  const platform = draft.platform;
  const warm = /cream|paper|warm/.test(template?.id || '');
  const size = platform === 'wechat' ? { width: 1200, height: 510 } : platform === 'poster' ? { width: 1080, height: 1920 } : { width: 1080, height: 1440 };
  const landscape = platform === 'wechat';
  const value = {
    version: DESIGN_SKILL_VERSION, platform, audience: brief.audience, scene: brief.scene, goal: brief.goal, productName,
    canvas: size,
    pageRole: platform === 'xiaohongshu' ? '系列封面：吸引目标受众并明确这组内容解决的一个问题；正文内页分组承载已经审核的事实与适用条件。' : platform === 'wechat' ? '文章横向封面：在信息流中识别主题，给标题和真实产品图清晰空间，正文保持微信兼容 HTML。' : '门店竖版主海报：一个核心信息、真实产品主体和一个明确到店行动。',
    visualConcept: `围绕「${brief.scene}」构建安静、有真实空间关系的环境，以光线和材质暗示「${brief.goal}」；不通过生成产品或参数表达卖点。`,
    focalVisual: '无品牌、无文字、无电脑和电子设备的环境背景；主体区域保持空净，后续叠加同型号产品原图。',
    productZone: landscape ? { x: .53, y: .17, width: .41, height: .70 } : { x: .10, y: .32, width: .80, height: .33 },
    titleZone: landscape ? { x: .055, y: .16, width: .44, height: .56 } : { x: .065, y: .075, width: .87, height: .21 },
    bodyZone: landscape ? { x: .055, y: .76, width: .44, height: .14 } : { x: .065, y: .69, width: .87, height: .23 },
    safeMargins: { top: landscape ? 48 : 72, right: 64, bottom: landscape ? 48 : 64, left: 64 },
    readingOrder: ['先识别唯一主标题', '再看真实产品主体与空间关系', '最后阅读必要信息及行动引导'],
    palette: warm ? ['#F4EBDD', '#233F38', '#C66C45'] : ['#EAF0ED', '#173C39', '#BE643E'],
    typography: { family: 'Noto Sans SC', titlePx: landscape ? 54 : 76, bodyPx: landscape ? 25 : 32, hierarchy: '标题为唯一最大字号，产品名次级，正文稳定行距；中文禁止由生图模型绘制，全部使用独立可编辑文字。' },
    lightAndMaterial: '柔和侧光、低对比的自然阴影、哑光纸面与石材或木材质感；保留细腻真实纹理，避免廉价塑料光泽。',
    seriesConsistency: '封面与内页共用三色体系、相同安全边距和中文字体；正文按信息职责自然分组，3–6页，不附加泛化结束页。',
    forbidden: ['不生成电脑、平板、手机、产品机身、接口或商标', '不生成任何中文、英文、数字、二维码、Logo、水印或审核标记', '不虚构价格、优惠、性能、认证、绝对化承诺', '不改写已审核文案，不裁掉任何必要适用条件', '不把 AI 背景标记为产品来源证据', '不使用未经授权的人物、IP、品牌装饰', '不让高频纹理、强高光或装饰侵入文字与产品预留区'],
    exactCopy: { title, intro: draft.intro, headings: draft.blocks.map(block => block.heading), body: draft.blocks.map(block => block.text), cta: draft.cta },
    rules: DESIGN_RULES,
  };
  const parsed = designBriefSchema.safeParse(value);
  if (!parsed.success) throw new WorkflowError(422, '设计简报缺少受众、场景、目标或必要构图字段，请先补齐需求。');
  return parsed.data;
}
/** Only audited structural fields go to image generation. Approved commercial text stays as separate layers. */
export function compileImagePrompt(input: DesignBrief) {
  const brief = designBriefSchema.parse(input);
  const describeZone = (name: string, zone: DesignBrief['titleZone']) => `${name}：左上角(${Math.round(zone.x * 100)}%, ${Math.round(zone.y * 100)}%)，宽${Math.round(zone.width * 100)}%，高${Math.round(zone.height * 100)}%；此区域为后续合成预留，请保持平静与足够对比。`;
  const prompt = [
    `任务：只生成商业视觉的场景与背景素材，不生成最终成品。设计规则版本 ${brief.version}。`,
    `画幅：${brief.canvas.width}×${brief.canvas.height}，纵横比 ${brief.canvas.width}:${brief.canvas.height}，高质量全画幅，不加边框。`,
    `目标受众：${brief.audience}。真实场景：${brief.scene}。沟通目标：${brief.goal}。`,
    `渠道与职责：${brief.platform}；${brief.pageRole}`, `视觉概念：${brief.visualConcept}`, `主视觉：${brief.focalVisual}`,
    describeZone('真实产品原图预留位置', brief.productZone), describeZone('独立中文标题层预留区域', brief.titleZone), describeZone('正文及行动区预留区域', brief.bodyZone),
    `安全边距：上${brief.safeMargins.top}px／右${brief.safeMargins.right}px／下${brief.safeMargins.bottom}px／左${brief.safeMargins.left}px。重要环境元素不得贴边。`,
    `阅读路径：${brief.readingOrder.join(' → ')}。`, `色彩：${brief.palette.join('、')}；主色大面积使用，强调色低于画面面积10%，不引入第四种高饱和颜色。`,
    `字体层级规划（仅留空，禁止在图中画字）：${brief.typography.family}；标题${brief.typography.titlePx}px、正文${brief.typography.bodyPx}px。${brief.typography.hierarchy}`,
    `光线与材质：${brief.lightAndMaterial}`, `系列一致性：${brief.seriesConsistency}`,
    `构图规则：${brief.rules.composition}`, `概念深化：${brief.rules.concept}`, `真实性规则：${brief.rules.truth}`, `精修检查：${brief.rules.refinement}`,
    `禁止事项：\n${brief.forbidden.map((rule, index) => `${index + 1}. ${rule}`).join('\n')}`,
    '最终只输出干净背景图。真实产品照片和全部精确中文将在后续 HTML/CSS 或 Canva 分层排版中加入。',
  ].join('\n\n');
  return { prompt, promptHash: createHash('sha256').update(prompt).digest('hex'), skillVersion: DESIGN_SKILL_VERSION, skillHashes: { ...DESIGN_SKILL_HASHES } };
}
