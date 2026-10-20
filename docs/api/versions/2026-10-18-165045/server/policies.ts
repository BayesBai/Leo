import type { Brief, ContentBlock, Draft, EvidenceBundle, Fact, Platform, ReviewIssue, ReviewReport, Strategy } from '../shared/types.js';

export interface PlatformPolicy {
  name: string; minImages: number; maxImages: number; defaultImages: number;
  tone: string; structure: string[]; minWords: number; maxWords: number; cta: string;
}

export const PLATFORM_POLICIES: Record<Platform, PlatformPolicy> = {
  xiaohongshu: { name: '小红书', minImages: 3, maxImages: 6, defaultImages: 4, tone: '具体、轻快的场景清单；不冒充用户体验', structure: ['场景切入', '选机清单', '版本提醒', '互动讨论'], minWords: 160, maxWords: 1100, cta: '把你常用的软件和使用场景留在评论区，一起补全选机清单。' },
  wechat: { name: '公众号', minImages: 2, maxImages: 4, defaultImages: 3, tone: '有条理、有依据的决策说明', structure: ['需求背景', '关键事实', '场景分析', '选购建议'], minWords: 260, maxWords: 2200, cta: '欢迎带着常用软件清单到店体验，并核对所选配置与销售版本。' },
  moments: { name: '朋友圈', minImages: 1, maxImages: 3, defaultImages: 2, tone: '简洁、自然、有明确咨询入口', structure: ['一句场景', '一个核心看点', '咨询引导'], minWords: 45, maxWords: 420, cta: '有相同使用需求，欢迎私信交流，也可以预约到店核对。' },
  poster: { name: '门店海报', minImages: 1, maxImages: 1, defaultImages: 1, tone: '短句、清晰层级，最多三个卖点', structure: ['场景主标题', '产品副标题', '最多三个卖点', '到店引导'], minWords: 15, maxWords: 500, cta: '到店体验 · 核对配置与常用软件' },
};

type AudienceKind = 'student' | 'business' | 'creator' | 'home' | 'general';
interface AudienceProfile { kind: AudienceKind; role: string; task: string; pain: string; angle: string; keywords: string[] }

function profileFor(brief: Brief): AudienceProfile {
  const value = `${brief.audience} ${brief.scene}`;
  if (/学生|大学|校园|课程|学习|宿舍|论文|考研/.test(value)) return { kind: 'student', role: '学习者', task: '在课堂、图书馆与宿舍之间安排学习任务', pain: '资料阅读、课程任务和日常携带要放在一起考虑，选购前还需要核对课程软件。', angle: '沿着一天的学习动线整理选机清单', keywords: ['重量', '轻', 'kg', ' g', '屏幕', '英寸', '电池', 'Wh', '操作系统', 'HarmonyOS', 'Windows'] };
  if (/创作|设计|剪辑|摄影|画图|视频|修图|创作者/.test(value)) return { kind: 'creator', role: '内容创作者', task: '安排素材阅读、画面检查与创作工具的使用', pain: '屏幕规格与创作软件是否匹配，需要分开核对；不能用单一参数代替真实工作流验证。', angle: '从素材到成稿，逐项核对创作设备', keywords: ['屏幕', 'OLED', '分辨率', '色域', 'P3', 'sRGB', '内存', '存储', '处理器', '操作系统'] };
  if (/商务|办公|出差|职场|通勤|会议|企业|工作|白领/.test(value)) return { kind: 'business', role: '办公使用者', task: '在工位、会议室与出行途中安排办公', pain: '移动携带、会议展示和企业软件的要求不同，需要先排出优先级再决定配置。', angle: '围绕移动办公的任务顺序安排卖点', keywords: ['重量', '轻', 'kg', ' g', '接口', 'USB', '电池', 'Wh', '操作系统', 'HarmonyOS', 'Windows', '协同', '互联'] };
  if (/家庭|家用|父母|亲子|共享|居家/.test(value)) return { kind: 'home', role: '家庭使用者', task: '为家人各自的日常任务安排一台电脑', pain: '家庭成员的使用习惯和软件需求不完全相同，共用前要分别确认。', angle: '按家庭成员列出共同需求与各自需求', keywords: ['屏幕', '英寸', '操作系统', 'HarmonyOS', 'Windows', '接口', '存储', '内存'] };
  return { kind: 'general', role: brief.audience || '电脑使用者', task: '把日常任务整理成明确的设备要求', pain: '产品参数需要与实际任务逐项对照，配置和软件适配也需要单独确认。', angle: '把真实使用任务变成可核对的选购依据', keywords: ['操作系统', '重量', '屏幕', '内存', '接口'] };
}

function stageFor(stage: string): { angle: string; cta: string } {
  if (/决策|购买|成交|下单|临门|准备买/.test(stage)) return { angle: '下单前确认配置、软件和版本边界', cta: '带上软件清单到店确认所选版本，再决定配置。' };
  if (/比较|对比|考虑|评估|选购/.test(stage)) return { angle: '用相同任务逐项比较候选机型', cta: '把这些核对项加入候选清单，比较时统一配置与版本。' };
  return { angle: '先建立与使用场景有关的产品认识', cta: '从一个常用场景开始了解，再补充你的软件与配置需求。' };
}

function factRelevance(fact: Fact, profile: AudienceProfile): number {
  const text = `${fact.statement} ${fact.quote}`;
  return profile.keywords.reduce((score, keyword, index) => score + (text.toLowerCase().includes(keyword.toLowerCase()) ? 30 - index : 0), 0);
}

function factTopic(fact: Fact): string {
  const text = fact.statement;
  if (/重量|\bkg\b|\d\s*g\b|轻薄/.test(text)) return '携带相关规格';
  if (/屏幕|OLED|英寸|分辨率|色域|sRGB|P3/i.test(text)) return '屏幕相关规格';
  if (/系统|HarmonyOS|Windows/i.test(text)) return '系统与软件核对';
  if (/接口|USB|HDMI/i.test(text)) return '外设连接条件';
  if (/电池|Wh|续航/.test(text)) return '电池相关规格';
  if (/内存|存储|SSD|GB|TB/.test(text)) return '配置选项';
  return '产品资料看点';
}

const EMPHASIS_TOPICS: { request: RegExp; evidence: RegExp }[] = [
  { request: /重量|便携|轻薄|轻盈/, evidence: /重量|\bkg\b|\d\s*g\b|轻薄/i },
  { request: /屏幕|显示|柔光|OLED/i, evidence: /屏幕|显示|分辨率|OLED|英寸|色域/i },
  { request: /系统|软件适配|兼容性/, evidence: /操作系统|HarmonyOS|Windows/i },
  { request: /接口|外设|连接/, evidence: /接口|USB|HDMI|雷电/i },
  { request: /内存/, evidence: /内存/i },
  { request: /存储|硬盘/, evidence: /存储|硬盘|SSD/i },
  { request: /电池|续航/, evidence: /电池|Wh/i },
];

function emphasisOrder(instructions: string): typeof EMPHASIS_TOPICS {
  const instructionsToUse = instructions.replace(/(?:不要|不必|无需|别|去掉|删除|弱化|不再)[^，。；\n]*/g, '');
  const clauses = [...instructionsToUse.matchAll(/(?:突出|强调|优先|主打|重点(?:介绍|展示|说明)?)[^，。；\n]{0,25}/g)];
  const matched = clauses.flatMap(clause => EMPHASIS_TOPICS.filter(topic => topic.request.test(clause[0])));
  return [...new Set(matched)];
}

function selectedFacts(evidence: EvidenceBundle, profile: AudienceProfile, instructions = ''): Fact[] {
  const requested = emphasisOrder(instructions);
  const ranked = evidence.facts.filter(f => f.status === 'supported')
    .map((fact, index) => {
      const requestedIndex = requested.findIndex(topic => topic.evidence.test(fact.statement));
      return { fact, score: factRelevance(fact, profile) + (requestedIndex >= 0 ? 1000 - requestedIndex * 100 : 0), index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const picked: Fact[] = [];
  const topics = new Set<string>();
  for (const { fact } of ranked) {
    const topic = factTopic(fact);
    if (!topics.has(topic)) { picked.push(fact); topics.add(topic); }
    if (picked.length === 3) break;
  }
  for (const { fact } of ranked) {
    if (picked.length >= 3) break;
    if (!picked.some(f => f.id === fact.id)) picked.push(fact);
  }
  return picked;
}

export function buildStrategies(brief: Brief, evidence: EvidenceBundle): Strategy[] {
  const profile = profileFor(brief);
  const stage = stageFor(brief.buyingStage);
  const facts = selectedFacts(evidence, profile, brief.instructions);
  const imageCount = new Set(evidence.images.filter(i => i.productId === evidence.product.id && !!i.url).map(i => i.id)).size;
  return [...new Set(brief.platforms)].map(platform => {
    const policy = PLATFORM_POLICIES[platform];
    const format = platform === 'xiaohongshu' ? '用可收藏清单讨论' : platform === 'wechat' ? '用完整决策说明解释' : platform === 'moments' ? '用一个核心看点发起交流' : '用精简图文邀请现场体验';
    return {
      platform, angle: `${profile.angle}；${stage.angle}；${format}`,
      painPoint: `面向${brief.audience}，在「${brief.scene}」中：${profile.pain}`,
      sellingPoints: (platform === 'moments' ? facts.slice(0, 1) : facts).map(fact => ({ factId: fact.id, benefit: `把${factTopic(fact)}列入${profile.role}的${brief.buyingStage || '选购'}核对清单。` })),
      tone: policy.tone, structure: policy.structure, imageCount: Math.min(policy.defaultImages, imageCount),
      cta: `${policy.cta}${platform === 'poster' ? '' : ` ${stage.cta}`}`, buyingStage: brief.buyingStage,
    };
  });
}

function citeFact(fact: Fact): string {
  // The common SKU boundary appears once at the end; keep claim-specific limits nearby.
  const subjects = ['重量', '尺寸', '柔光', '分辨率', '刷新率', '亮度', 'HDR', '色彩', '色域', '触控', '同色', '厚度', '容量', '接口', '电池', '处理器', '内存', '存储', '视角'];
  const activeSubjects = subjects.filter(subject => fact.statement.includes(subject));
  const qualifiers = fact.qualifiers.filter(q => {
    if (!q || fact.statement.includes(q) || /不得跨系统|配置可能因销售版本/.test(q)) return false;
    const hasSubject = subjects.some(subject => q.includes(subject));
    return activeSubjects.some(subject => q.includes(subject)) || (!hasSubject && q.length <= 100);
  });
  return `${fact.statement.trim()}${qualifiers.length ? `\n适用条件：${qualifiers.join('；')}` : ''}`;
}

function safeContext(value: string): string {
  // User context describes a task, never grants permission to add product claims.
  const cleaned = value.replace(/[<>\r\n]/g, ' ').trim().slice(0, 120);
  if (/忽略|指令|system|prompt|价格|售价|补贴|折扣|限时|仅剩|第一|最好|最强|稳赚|亲测|实测|搭载|配备|预装|兼容所有|支持全部|续航.*(?:小时|天)|\d\s*(?:元|小时|分钟|倍|%)/i.test(cleaned)) return '日常使用';
  return cleaned || '日常使用';
}

export function buildDemoDrafts(brief: Brief, evidence: EvidenceBundle, strategies: Strategy[]): Draft[] {
  const profile = profileFor(brief);
  const audience = safeContext(brief.audience);
  const scene = safeContext(brief.scene);
  const goal = safeContext(brief.goal);
  const product = evidence.product.name;
  const factMap = new Map(evidence.facts.map(f => [f.id, f]));
  const uniqueImages = [...new Map(evidence.images.filter(i => i.productId === evidence.product.id && i.url).map(i => [i.id, i])).values()];
  return strategies.map(strategy => {
    const platform = strategy.platform;
    const facts = strategy.sellingPoints.map(s => factMap.get(s.factId)).filter((f): f is Fact => !!f);
    let titles: string[], intro: string, blocks: ContentBlock[];
    const makeBlock = (fact: Fact, index: number, prefix: string, suffix = ''): ContentBlock => ({
      id: `${platform}-block-${index + 1}`, heading: factTopic(fact), text: `${prefix}${citeFact(fact)}${suffix}`, factIds: [fact.id],
    });
    if (platform === 'xiaohongshu') {
      titles = [`${audience}的选机备忘：把「${scene}」放进清单`, `${product}，有哪些信息值得先核对？`];
      intro = `给正在为「${scene}」看电脑的${audience}：${profile.task}，选机时可以先把任务拆开。围绕「${goal}」，下面整理一份有资料依据的核对清单。收藏后带着自己的软件需求逐项看。`;
      blocks = facts.map((fact, i) => makeBlock(fact, i, '资料里可以确认的是：\n', `\n怎么用这条信息：${strategy.sellingPoints[i].benefit}具体体验可结合自己的使用方式现场确认。`));
      if (!blocks.length) blocks = [{ id: `${platform}-empty`, heading: '先补齐产品依据', text: '当前没有可引用的产品事实，先补充资料，再整理具体卖点。', factIds: [] }];
      blocks.push({ id: `${platform}-checklist`, heading: '带着自己的任务核对', text: `准备一份「${scene}」会用到的软件和外设清单。涉及软件支持范围、销售配置与使用条件的内容，分别向官方资料或门店确认。${stageFor(brief.buyingStage).cta}`, factIds: [] });
    } else if (platform === 'wechat') {
      titles = [`从${scene}出发，如何了解${product}`, `面向${audience}的电脑选购观察：任务、规格与适用条件`];
      intro = `${audience}在「${scene}」中选购电脑，首先要明确希望完成什么任务。本次以「${goal}」为目标，把能够从资料确认的信息与需要现场确认的事项分开说明，便于读者带着具体问题继续比较。`;
      blocks = facts.map((fact, i) => makeBlock(fact, i, `围绕${profile.role}的需求，先看资料中的具体表述：\n`, `\n选购时的意义：${strategy.sellingPoints[i].benefit}这是一项比较维度，实际选型仍应结合任务、版本和配置一起判断。`));
      blocks.push({ id: `${platform}-decision`, heading: '把参数放回使用流程', text: `可以沿着「${scene}」的实际流程，把常用软件、外设和文件任务列成清单，逐项确认。资料中的规格只说明相应项目；应用适配、使用习惯与现场体验需要另行核对。${stageFor(brief.buyingStage).cta} 如需沟通选型，可将这份清单和自己的任务一起带到门店，便于围绕具体问题展开交流。`, factIds: [] });
    } else if (platform === 'moments') {
      titles = [`给最近在看电脑的${audience}`, `${scene}的选机小提醒`];
      intro = `围绕「${scene}」看电脑，可以先从一个与你的任务相关的看点开始。今天整理一下${product}资料中能确认的信息：`;
      blocks = facts.slice(0, 1).map((fact, i) => makeBlock(fact, i, '', '\n选购前再带上常用软件清单，核对实际配置与适用条件。'));
    } else {
      titles = [`为${scene}，认真选一台电脑`, product];
      intro = `${audience} · ${goal}`;
      blocks = facts.slice(0, 3).map((fact, i) => makeBlock(fact, i, ''));
    }
    return {
      id: `demo-${platform}`, platform, titles, intro, blocks, cta: `${strategy.cta}\n产品规格与功能请以实际销售版本及适用条件为准。`,
      tags: platform === 'xiaohongshu' ? ['电脑选购', profile.kind === 'student' ? '学习装备' : profile.kind === 'creator' ? '创作工具' : profile.kind === 'home' ? '家庭电脑' : '办公装备', '选机清单'] : [],
      images: uniqueImages.slice(0, strategy.imageCount).map((image, i) => ({ imageId: image.id, afterBlock: Math.min(i, Math.max(blocks.length - 1, 0)), caption: image.description && !/\.(?:png|jpe?g|webp|gif)\b/i.test(image.description) ? image.description : '本型号产品资料图', reason: i === 0 ? '作为产品主图，便于读者辨认本次介绍的型号。' : `结合${platform === 'poster' ? '海报' : '正文'}展示本型号已有的产品素材，图示以原始资料为准。` })),
    };
  });
}

/** Normalize number typography without conflating different product configurations. */
function numberTokens(text: string, evidence: EvidenceBundle, taskContexts: string[] = []): string[] {
  let value = text.replace(/^\s*(?:\d+[.、)）]|[（(]\d+[)）])\s+/gm, '');
  for (const productLiteral of [evidence.product.name, evidence.product.system, ...taskContexts]) {
    if (productLiteral) value = value.split(productLiteral).join('');
  }
  return [...value.normalize('NFKC').matchAll(/\d+(?:\.\d+)?(?:\s*[:×x]\s*\d+(?:\.\d+)?)*(?:\s*(?:%|kg|g|mm|cm|GB|TB|Wh|W|Hz|MHz|GHz|nits|nit|英寸|元|小时|分钟|倍|天))?/gi)]
    .map(m => m[0].replace(/\s+/g, '').toLowerCase().replace(/×/g, 'x'));
}

function factualClaimWithoutCitation(text: string): boolean {
  return text.split(/[。！？\n]/).some(sentence => {
    const value = sentence.trim();
    if (/^(当前没有|先补齐|准备一份|可以沿着|资料中的规格|请核对|请确认|核对|确认|涉及|产品规格与功能请|购买前请)/.test(value)) return false;
    return /(?:搭载|配备|预装|采用|内置|拥有|重约|重量为|分辨率为|续航(?:长达|达到|为|\s*\d)|处理器为|存储容量为|屏占比为|屏幕尺寸为|色域为|电池容量为|售价|价格为|补贴后|到手价|(?:支持|兼容)(?:跨|手机|多屏|无线|智能|触控|所有|全部|Windows|鸿蒙|HarmonyOS|OLED|4K|8K)|多屏协同|一键(?:传|互联|连接)|跨设备(?:传|共享|协同))/.test(value);
  });
}

function instructionRisks(brief: Brief, evidence: EvidenceBundle): string[] {
  const request = brief.instructions.replace(/(?:不要|不加|禁止|不写|避免|去掉|删除)[^，。；\n]{0,30}/g, '');
  const supported = evidence.facts.filter(f => f.status === 'supported').map(f => f.statement).join('\n');
  const risks: string[] = [];
  if (/(价格|售价|优惠|降价|补贴|折扣|到手价|\d+\s*元)/.test(request) && !/(售价|到手价|补贴|\d+\s*元)/.test(supported)) risks.push('价格、促销或补贴');
  if (/(限时|仅剩|库存|最后.*台|售罄)/.test(request) && !/(库存|仅剩|售罄)/.test(supported)) risks.push('库存或稀缺性');
  if (/(实测|亲测|我用过|亲身|提升.*倍|节省.*小时)/.test(request)) risks.push('未提供依据的体验或实测结论');
  if (/(最好|最强|第一|稳赚|百分之百|100%保证|绝对)/.test(request)) risks.push('绝对化或保证性表述');
  return risks;
}

export function reviewDrafts(brief: Brief, evidence: EvidenceBundle, drafts: Draft[]): ReviewReport {
  const issues: ReviewIssue[] = [];
  let issueIndex = 0;
  const add = (issue: Omit<ReviewIssue, 'id'>) => issues.push({ ...issue, id: `review-${++issueIndex}` });
  const factMap = new Map(evidence.facts.map(f => [f.id, f]));
  const imageMap = new Map(evidence.images.map(i => [i.id, i]));
  const cited = new Set<string>(), usedImages = new Set<string>();
  if (evidence.sourceMode === 'local') add({ severity: 'warning', category: 'source', message: '本次依据来自本地知识库，尚未通过 ima 在线检索核验。', suggestion: '可用于本地演示；正式提交前切换 ima 并重新生成。' });
  if (brief.knowledgeSource !== evidence.sourceMode) add({ severity: 'error', category: 'source', message: '任务选择的知识来源与实际证据来源不一致。', suggestion: '按所选知识来源重新检索，不得将本地资料标记为 ima。' });
  if (evidence.product.id !== brief.productId) add({ severity: 'error', category: 'fact', message: '检索所得产品与任务指定产品不一致。', suggestion: '重新检索指定型号与系统版本。' });
  for (const warning of evidence.warnings) add({ severity: 'warning', category: 'source', message: warning, suggestion: '核对原始资料，补足依据后再发布。' });
  for (const risk of instructionRisks(brief, evidence)) add({ severity: 'warning', category: 'compliance', message: `附加要求涉及${risk}，缺少可验证依据，成稿不得采纳该类要求。`, suggestion: '补充可追溯的官方依据，或保留当前有依据的表达。' });
  const taskContexts = [brief.audience, brief.scene, brief.goal].map(safeContext).filter(v => v !== '日常使用');
  const requested = new Set(brief.platforms);
  if (!drafts.length) add({ severity: 'error', category: 'platform', message: '尚未生成任何平台的文案。', suggestion: '生成至少一份所选平台文案。' });
  for (const platform of requested) if (!drafts.some(d => d.platform === platform)) add({ severity: 'error', category: 'platform', platform, message: `缺少${PLATFORM_POLICIES[platform].name}文案。`, suggestion: '按任务所选平台补充生成。' });
  if (new Set(drafts.map(d => d.platform)).size !== drafts.length) add({ severity: 'error', category: 'platform', message: '同一平台出现重复成稿。', suggestion: '每个平台仅保留一份当前成稿。' });
  for (const draft of drafts) {
    const policy = PLATFORM_POLICIES[draft.platform];
    if (!policy) { add({ severity: 'error', category: 'platform', message: '文案包含未知平台。', suggestion: '使用支持的平台重新生成。' }); continue; }
    const text = [draft.titles.join('\n'), draft.intro, ...draft.blocks.map(b => `${b.heading}\n${b.text}`), draft.cta].join('\n');
    const draftFactIds = [...new Set(draft.blocks.flatMap(b => b.factIds))];
    const draftFacts = draftFactIds.map(id => factMap.get(id)).filter((f): f is Fact => !!f && f.status === 'supported');
    if (!requested.has(draft.platform)) add({ severity: 'warning', category: 'platform', platform: draft.platform, message: '文案包含任务未选择的平台。', suggestion: '移除该平台或调整任务平台。' });
    for (const block of draft.blocks) {
      const facts: Fact[] = [];
      for (const factId of new Set(block.factIds)) {
        const fact = factMap.get(factId);
        if (!fact) add({ severity: 'error', category: 'fact', platform: draft.platform, blockId: block.id, factId, message: `段落引用的事实 ${factId} 不在本次证据包中。`, suggestion: '改用本次证据包中的有效事实编号。' });
        else {
          cited.add(factId);
          if (fact.status !== 'supported') add({ severity: 'error', category: 'fact', platform: draft.platform, blockId: block.id, factId, message: '引用事实尚未获得原文支持。', suggestion: '读取原文并确认后再引用。' });
          else facts.push(fact);
          if (fact.sourceMode !== evidence.sourceMode) add({ severity: 'error', category: 'source', platform: draft.platform, factId, message: '引用事实的来源模式与本次证据包不一致。', suggestion: '重新建立同一来源的证据包。' });
        }
      }
      const allowed = new Set(numberTokens(facts.map(f => `${f.statement} ${f.quote} ${f.qualifiers.join(' ')}`).join('\n'), evidence));
      const unsupported = [...new Set(numberTokens(`${block.heading}\n${block.text}`, evidence, taskContexts).filter(token => !allowed.has(token)))];
      if (unsupported.length) add({ severity: 'error', category: 'fact', platform: draft.platform, blockId: block.id, message: `段落包含引用依据未支持的数字：${unsupported.join('、')}。`, suggestion: '删除这些数字，或引用能支持相同数值与单位的事实。' });
      if (!block.factIds.length && factualClaimWithoutCitation(block.text)) add({ severity: 'error', category: 'fact', platform: draft.platform, blockId: block.id, message: '产品功能或规格描述缺少事实引用。', suggestion: '为该段落添加对应事实，或改为不作产品承诺的核对建议。' });
      for (const fact of facts) {
        const claim = `${block.heading} ${block.text}`;
        // Verbatim facts remain valid; model paraphrases must preserve material limitations.
        if (fact.qualifiers.length && !claim.includes(fact.statement) && fact.qualifiers.some(q => /仅|依|不同|为准|版本|典型|额定|实际|条件/.test(q) && !claim.includes(q))) add({ severity: 'warning', category: 'fact', platform: draft.platform, blockId: block.id, factId: fact.id, message: '改写后的段落可能缺少原始事实的适用条件。', suggestion: `保留限定条件：${fact.qualifiers.join('；')}` });
      }
    }
    const globalAllowed = new Set(numberTokens(draftFacts.map(f => `${f.statement} ${f.quote} ${f.qualifiers.join(' ')}`).join('\n'), evidence));
    const uncitedNumbers = [...new Set(numberTokens(`${draft.titles.join(' ')} ${draft.intro} ${draft.cta}`, evidence, taskContexts).filter(t => !globalAllowed.has(t)))];
    if (uncitedNumbers.length) add({ severity: 'error', category: 'fact', platform: draft.platform, message: `标题、导语或行动引导出现无依据数字：${uncitedNumbers.join('、')}。`, suggestion: '删除无依据数据，产品参数请放在引用了事实的正文段落。' });
    if ([...draft.titles, draft.intro, draft.cta].some(value => factualClaimWithoutCitation(value))) add({ severity: 'error', category: 'fact', platform: draft.platform, message: '标题、导语或行动引导含无段落引用的产品功能断言。', suggestion: '将功能或规格描述放入引用了对应事实的正文段落；标题与导语保留场景和核对建议。' });
    if (/(最好|最强|全球第一|行业第一|全网第一|稳赚|百分之百保证|100\s*%\s*(?:保证|安全|成功|兼容|提升)|绝对(?:领先|安全|好用)|永久(?:免费|有效))/.test(text)) add({ severity: 'error', category: 'compliance', platform: draft.platform, message: '文案含绝对化或保证性宣传。', suggestion: '改为有证据支持、带适用条件的具体描述。' });
    if (/(?:我|我们|本人)(?:亲自|已经|已|实际)?(?:用过|使用了|体验了|实测|亲测)|亲测|亲身体验|用了.*(?:天|周|个月)|实测(?:发现|证明|提升|续航)/.test(text)) add({ severity: 'error', category: 'compliance', platform: draft.platform, message: '文案可能虚构个人体验或实测结论。', suggestion: '改为资料说明；如需使用体验，补充真实授权的测试记录。' });
    const allSupport = draftFacts.map(f => `${f.statement} ${f.quote}`).join('\n');
    const commercial = /(到手价|售价|补贴后|国补|限时(?:抢购|优惠)|仅剩|最后\s*\d+\s*台|\d+(?:\.\d+)?\s*元)/;
    if (commercial.test(text) && !commercial.test(allSupport)) add({ severity: 'error', category: 'compliance', platform: draft.platform, message: '文案出现未获依据支持的价格、补贴或稀缺性信息。', suggestion: '删除销售承诺；仅在取得对应活动、地区和时效依据后使用。' });
    if (evidence.product.system && /HarmonyOS|鸿蒙/i.test(evidence.product.system) && /(?:搭载|预装|采用|运行)\s*Windows/i.test(text) || evidence.product.system && /Windows/i.test(evidence.product.system) && /(?:搭载|预装|采用|运行)\s*(?:HarmonyOS|鸿蒙)/i.test(text)) add({ severity: 'error', category: 'fact', platform: draft.platform, message: '文案中的操作系统与所选产品系统冲突。', suggestion: '严格使用所选型号与系统版本的证据。' });
    const imageIds = new Set<string>();
    for (const placement of draft.images) {
      const asset = imageMap.get(placement.imageId);
      if (!asset || !asset.url) add({ severity: 'error', category: 'image', platform: draft.platform, message: '引用的图片不存在或没有可展示的资源地址。', suggestion: '使用本次证据包中已成功读取的图片。' });
      else {
        usedImages.add(asset.id);
        if (asset.productId !== evidence.product.id) add({ severity: 'error', category: 'image', platform: draft.platform, message: `图片「${asset.name}」不属于当前产品。`, suggestion: '移除跨型号图片，换为本型号素材。' });
        if (asset.sourceMode !== evidence.sourceMode) add({ severity: 'error', category: 'source', platform: draft.platform, message: `图片「${asset.name}」来源与本次证据包不一致。`, suggestion: '重新获取同一来源的图片。' });
        if (asset.width <= 0 || asset.height <= 0) add({ severity: 'warning', category: 'image', platform: draft.platform, message: `图片「${asset.name}」缺少有效尺寸信息。`, suggestion: '确认图片可读取且适合所选平台。' });
      }
      if (imageIds.has(placement.imageId)) add({ severity: 'warning', category: 'image', platform: draft.platform, message: '同一文案中重复使用了相同图片。', suggestion: '改用不同的同型号图片，或减少重复位置。' });
      imageIds.add(placement.imageId);
      if (placement.afterBlock < -1 || placement.afterBlock >= draft.blocks.length) add({ severity: 'warning', category: 'image', platform: draft.platform, message: '图片插入位置超出正文段落范围。', suggestion: '将图片放到已有段落后，或使用 -1 作为封面。' });
    }
    if (imageIds.size < policy.minImages || imageIds.size > policy.maxImages) add({ severity: 'warning', category: 'platform', platform: draft.platform, message: `${policy.name}图片数量为 ${imageIds.size} 张，要求 ${policy.minImages === policy.maxImages ? policy.minImages : `${policy.minImages}–${policy.maxImages}`} 张。`, suggestion: '补充本型号图片；素材不足时保留缺口，不跨型号补齐。' });
    if (draft.platform === 'poster' && draft.blocks.length > 3) add({ severity: 'warning', category: 'platform', platform: draft.platform, message: '海报超过三个卖点段落。', suggestion: '精选最多三个有依据的核心卖点。' });
    const wordCount = text.replace(/\s/g, '').length;
    if (wordCount < policy.minWords || wordCount > policy.maxWords) add({ severity: 'warning', category: 'platform', platform: draft.platform, message: `${policy.name}正文长度为 ${wordCount} 字，建议 ${policy.minWords}–${policy.maxWords} 字。`, suggestion: '按平台阅读习惯精简或补充场景说明，并保留来源条件。' });
    if (!draft.blocks.length || !draftFactIds.length) add({ severity: 'error', category: 'fact', platform: draft.platform, message: '当前文案没有可追溯的产品事实。', suggestion: '补充产品原文后重新生成。' });
  }
  const categories: { category: ReviewIssue['category']; label: string; ok: string }[] = [
    { category: 'fact', label: '事实与引用', ok: '事实编号有效，数字与引用依据一致。' },
    { category: 'image', label: '图片与型号', ok: '图片存在，归属型号一致，未重复使用。' },
    { category: 'compliance', label: '营销表达', ok: '未发现规则涵盖的无依据销售承诺或绝对化表达。' },
    { category: 'platform', label: '平台规则', ok: '图片数量、长度与结构符合本平台规则。' },
    { category: 'source', label: '来源状态', ok: '来源模式一致；仍需发布者核对授权与资料时效。' },
  ];
  return {
    status: issues.some(i => i.severity === 'error') ? 'blocked' : issues.some(i => i.severity === 'warning') ? 'needs_attention' : 'passed',
    issues, factCount: evidence.facts.length, citedFactCount: cited.size, imageCount: usedImages.size,
    checks: categories.map(({ category, label, ok }) => { const own = issues.filter(i => i.category === category); return { label, status: own.some(i => i.severity === 'error') ? 'fail' as const : own.some(i => i.severity === 'warning') ? 'warning' as const : 'pass' as const, detail: own.length ? own.map(i => i.message).join(' ') : ok }; }),
    reviewedBy: 'rules',
  };
}
