import type { Draft, EvidenceBundle, Platform } from '../shared/types.js';

export const CHANNEL_GUIDES: Record<Platform, { label: string; plan: string; write: string; visual: string }> = {
  wechat: { label: '公众号 · 决策解读',
    plan: '组织3至5段：一个具体选购问题→两段不同维度的事实与场景解释→选择建议。标题用问题或判断议题，不能照搬其他渠道标题。不要把文章写成逐项参数清单。配2至4张不同原图。',
    write: '你是门店公众号的专栏编辑。正文350至600中文字；段落之间有论证承接，说明为什么关注、适合如何核对。开头从客户的选择困惑出发，结尾给决策步骤。使用完整句子，避免小红书式打卡口吻、朋友圈寒暄和海报口号。必要规格条件紧随相关断言。示例节奏：先明确常用任务，再解释这一项规格的意义，最后提出实际选择时要问的问题。不要每段都重复“资料里可以确认”“以实际配置为准”。',
    visual: '杂志式文章、分节解读、文中穿插产品图；独立横向编辑封面。' },
  xiaohongshu: { label: '小红书 · 选机清单',
    plan: '组织2至4个可逐页阅读的清单点，每点是用户能执行的动作或观察问题，分别选择相关事实。标题是收藏型场景选题，不能复用公众号的问题标题。开头短，不写长篇背景论证。配3至6张不同原图。',
    write: '你是品牌门店的小红书内容编辑。正文220至380中文字；用短句、换行和“先看/再问/带上”等动作组织可收藏清单。每段解决一个小问题，不虚构亲测或用户口碑。结尾用一个真实场景问题邀请评论，3至5个相关话题。不要使用公众号的长篇论证，或把“到店核对”复制到每一段。必要条件只保留在对应事实旁，不额外堆一遍完整参数表。',
    visual: '大字封面、编号清单内页、不同构图的互动收尾；明亮手帐色。' },
  moments: { label: '朋友圈 · 私域沟通',
    plan: '只组织一个有引用的核心看点段落，突出销售员与熟悉客户沟通的一次具体话题。标题简短像聊天开场，不写攻略标题。配1至3张原图，文案不能拆成多份文章。',
    write: '你是正在给客户发朋友圈的门店销售员。正文80至150中文字，必要事实条件可以适当超出。用自然聊天语气，如“最近有朋友问…”“准备开学的朋友，可以先想想…”；只聊一个事实与客户任务的关系，结尾轻量邀请私信。不写专栏小论文、不列选购清单、不堆标签（tags返回空数组）。不要虚构到店人数、亲身使用、价格或限时活动。',
    visual: '直接交付自然文案与1至3张同型号原图，保持照片原比例；不制作文字拼图卡。' },
  poster: { label: '门店海报 · 主视觉',
    plan: '为一张门店海报策划画内文字，围绕一个核心信息，只选1至2个最相关且条件能完整放下的看点。主标题是简洁场景主张（建议不超过14字），导语是短副标题，段落标题是短卖点标签，CTA是短邀请。这里不是单独发布的文章文案，不要把公众号正文搬入。只选1张同型号原图供人工核对。',
    write: '你是门店主视觉海报文案设计师。主标题由确认大纲固定；导语不超过30字，正文每段只表达一个明确看点，建议合计50至120中文字，必要条件不省略。使用短句与短标签，CTA不超过35字，tags返回空数组。不写“欢迎阅读”“先整理清单”等文章句子，不虚构优惠或地址。不要为了短而改动事实或删掉不同键盘/版本的适用条件；放不下就减少所选事实。',
    visual: 'API生成单张完整竖版海报；画内标题、产品、必要事实条件及行动引导主次清楚。来源与人工核对记录放在站内，不画审核、水印或来源标签。' },
};

export function channelInstruction(platform: Platform) {
  const guide = CHANNEL_GUIDES[platform];
  return `【本次渠道专属任务：${guide.label}】\n${guide.plan}\n${guide.write}\n视觉交付：${guide.visual}\n渠道间可以共享同一产品事实，但不能共享同一套标题、开场、段落叙事和结尾。`;
}

/** Compare editorial framing, not product facts: factual consistency is intentional. */
export function channelSimilarity(a: Draft, b: Draft, evidence: EvidenceBundle): number {
  const framing = (draft: Draft) => [draft.titles[0], draft.intro, ...draft.blocks.map(block => block.heading), draft.cta].join('');
  const tokens = (draft: Draft) => {
    let text = framing(draft).replaceAll(evidence.product.name, '');
    for (const fact of evidence.facts) for (const literal of [fact.statement, ...fact.qualifiers]) if (literal) text = text.replaceAll(literal, '');
    text = text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
    const chars = Array.from(text);
    return new Set(chars.slice(1).map((char, i) => chars[i] + char));
  };
  const x = tokens(a), y = tokens(b);
  if (Math.min(x.size, y.size) < 20) return 0;
  const intersection = [...x].filter(token => y.has(token)).length;
  return Math.round(2 * intersection / (x.size + y.size) * 1000) / 1000;
}
