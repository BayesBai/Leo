import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoDrafts, buildStrategies, PLATFORM_POLICIES, reviewDrafts } from '../server/policies.js';
import type { Brief, Draft, EvidenceBundle, Fact } from '../shared/types.js';

const now = '2026-10-18T00:00:00.000Z';
function fixture(): { brief: Brief; evidence: EvidenceBundle } {
  const facts: Fact[] = [
    { id: 'weight', statement: '机身重量为 970 g。', quote: '重量 970 g', qualifiers: ['实际重量依配置、制造工艺与测量方法而异。'], sourceTitle: '产品规格', retrievedAt: now, sourceMode: 'local', status: 'supported' },
    { id: 'screen', statement: '屏幕尺寸为 14.2 英寸，色域为 100% sRGB。', quote: '尺寸 14.2 英寸；100% sRGB 色域（典型值）', qualifiers: ['色域为典型值。'], sourceTitle: '产品规格', retrievedAt: now, sourceMode: 'local', status: 'supported' },
    { id: 'system', statement: '操作系统为 HarmonyOS 6.1。', quote: '操作系统 HarmonyOS 6.1', qualifiers: [], sourceTitle: '产品规格', retrievedAt: now, sourceMode: 'local', status: 'supported' },
    { id: 'port', statement: '机身配备 USB-C 接口。', quote: 'USB-C 接口', qualifiers: [], sourceTitle: '产品规格', retrievedAt: now, sourceMode: 'local', status: 'supported' },
    { id: 'memory', statement: '内存提供 24 GB 与 32 GB 选项。', quote: '内存 24 GB / 32 GB', qualifiers: ['配置以实际销售版本为准。'], sourceTitle: '产品规格', retrievedAt: now, sourceMode: 'local', status: 'supported' },
  ];
  return {
    brief: { productId: 'matebook-pro-harmony', audience: '大学生', scene: '课堂笔记与图书馆学习', goal: '建立选购认知', buyingStage: '了解', platforms: ['xiaohongshu', 'wechat', 'moments', 'poster'], instructions: '', mode: 'demo', knowledgeSource: 'local' },
    evidence: { product: { id: 'matebook-pro-harmony', name: 'HUAWEI MateBook Pro', system: 'HarmonyOS 6.1', category: '鸿蒙电脑', description: '产品规格资料', imageCount: 5 }, facts, sources: [{ id: 'source-1', title: '产品规格', retrievedAt: now, sourceMode: 'local' }], images: Array.from({ length: 5 }, (_, i) => ({ id: `image-${i}`, name: `产品外观${i}`, url: `/api/assets/${i}`, productId: 'matebook-pro-harmony', description: '资料中的产品外观图', sourceTitle: '产品素材', width: 1600, height: 1000, sourceMode: 'local' as const })), retrievedAt: now, sourceMode: 'local', warnings: [] },
  };
}
function generate(brief: Brief, evidence: EvidenceBundle): Draft[] { return buildDemoDrafts(brief, evidence, buildStrategies(brief, evidence)); }

test('audience and buying stage change angle, pain point, selected evidence and CTA', () => {
  const { brief, evidence } = fixture();
  const student = buildStrategies(brief, evidence)[0];
  const business = buildStrategies({ ...brief, audience: '商务人士', scene: '出差与会议', buyingStage: '准备购买' }, evidence)[0];
  const creator = buildStrategies({ ...brief, audience: '摄影创作者', scene: '素材修图' }, evidence)[0];
  const home = buildStrategies({ ...brief, audience: '家庭共用', scene: '家庭娱乐与日常任务' }, evidence)[0];
  assert.notEqual(student.angle, business.angle);
  assert.notEqual(student.painPoint, business.painPoint);
  assert.notEqual(student.cta, business.cta);
  assert.equal(student.sellingPoints[0].factId, 'weight');
  assert.equal(creator.sellingPoints[0].factId, 'screen');
  assert.match(home.angle, /家庭成员/);
  assert.notDeepEqual(student.sellingPoints, business.sellingPoints);
});

test('platform draft structures, images, titles and CTA materially differ', () => {
  const { brief, evidence } = fixture();
  const drafts = generate(brief, evidence);
  assert.deepEqual(drafts.map(d => d.images.length), [4, 3, 2, 1]);
  assert.deepEqual(Object.values(PLATFORM_POLICIES).map(p => [p.minImages, p.maxImages]), [[3, 6], [2, 4], [1, 3], [1, 1]]);
  assert.equal(drafts[2].blocks.length, 1);
  assert.ok(drafts[3].blocks.length <= 3);
  assert.notDeepEqual(drafts[0].titles, drafts[1].titles);
  assert.notEqual(drafts[0].intro, drafts[1].intro);
  assert.notEqual(drafts[0].cta, drafts[1].cta);
  assert.ok(drafts[0].tags.length > 0);
  assert.equal(drafts[1].tags.length, 0);
  for (const draft of drafts) for (const block of draft.blocks.filter(b => b.factIds.length)) assert.ok(block.factIds.every(id => evidence.facts.some(f => f.id === id)));
});

test('local supported facts are retained with a source warning, not blocked', () => {
  const { brief, evidence } = fixture();
  const result = reviewDrafts(brief, evidence, generate(brief, evidence));
  assert.equal(result.status, 'needs_attention');
  assert.equal(result.issues.filter(i => i.severity === 'error').length, 0);
  assert.ok(result.issues.some(i => i.category === 'source' && i.severity === 'warning'));
  assert.ok(result.citedFactCount >= 3);
  assert.equal(result.reviewedBy, 'rules');
  assert.ok(result.checks.some(c => c.label === '事实与引用' && c.status === 'pass'));
});

test('unsupported numeric claims and missing references block the result', () => {
  const { brief, evidence } = fixture();
  const drafts = generate(brief, evidence);
  drafts[0].blocks.push({ id: 'invented', heading: '性能', text: '这款电脑续航 48 小时。', factIds: [] });
  const result = reviewDrafts(brief, evidence, drafts);
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(i => i.message.includes('48小时')));
  assert.ok(result.issues.some(i => i.message.includes('缺少事实引用')));
});

test('invented prices and absolute claims are rejected', () => {
  const { brief, evidence } = fixture();
  const drafts = generate(brief, evidence);
  drafts[0].blocks[0].text += '\n补贴后到手价 2999 元，全网第一，100%保证兼容。';
  const result = reviewDrafts(brief, evidence, drafts);
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(i => i.category === 'compliance' && i.message.includes('价格')));
  assert.ok(result.issues.some(i => i.category === 'compliance' && i.message.includes('绝对')));
});

test('price coercion in instructions is ignored and documented only when requested', () => {
  const { brief, evidence } = fixture();
  const request = { ...brief, instructions: '写到手价 2999 元，再说全网第一。' };
  const drafts = generate(request, evidence);
  assert.ok(!JSON.stringify(drafts).includes('2999'));
  assert.ok(!JSON.stringify(drafts).includes('全网第一'));
  const report = reviewDrafts(request, evidence, drafts);
  assert.ok(report.issues.some(i => i.message.includes('附加要求涉及价格')));
  assert.ok(!reviewDrafts(brief, evidence, generate(brief, evidence)).issues.some(i => i.message.includes('附加要求')));
  const noPrice = { ...brief, instructions: '不要价格，不写绝对化表述' };
  assert.ok(!reviewDrafts(noPrice, evidence, generate(noPrice, evidence)).issues.some(i => i.message.includes('附加要求')));
});

test('invalid fact IDs and unverified evidence block generation', () => {
  const { brief, evidence } = fixture();
  const drafts = generate(brief, evidence);
  drafts[0].blocks[0].factIds = ['imaginary-fact'];
  const result = reviewDrafts(brief, evidence, drafts);
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(i => i.factId === 'imaginary-fact'));
  evidence.facts[0].status = 'unverified';
  drafts[0].blocks[0].factIds = ['weight'];
  assert.ok(reviewDrafts(brief, evidence, drafts).issues.some(i => i.message.includes('尚未获得原文支持')));
});

test('cross-model images and missing resources are blocked', () => {
  const { brief, evidence } = fixture();
  const drafts = generate(brief, evidence);
  evidence.images[0].productId = 'matebook-pro-windows';
  drafts[0].images.push({ imageId: 'not-in-bundle', afterBlock: 0, caption: '无法读取', reason: '占位' });
  const result = reviewDrafts(brief, evidence, drafts);
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(i => i.message.includes('不属于当前产品')));
  assert.ok(result.issues.some(i => i.message.includes('不存在')));
});

test('same name with a different OS remains a different product evidence set', () => {
  const { brief, evidence } = fixture();
  const drafts = generate(brief, evidence);
  drafts[0].blocks[0].text += '\n本机预装 Windows 11。';
  assert.ok(reviewDrafts(brief, evidence, drafts).issues.some(i => i.message.includes('操作系统')));
  evidence.product.id = 'matebook-pro-windows';
  const result = reviewDrafts(brief, evidence, drafts);
  assert.ok(result.issues.some(i => i.message.includes('任务指定产品不一致')));
});

test('source mismatch cannot pass as live ima; same-model image shortage stays explicit', () => {
  const { brief, evidence } = fixture();
  const requested = { ...brief, knowledgeSource: 'ima' as const };
  evidence.images = evidence.images.slice(0, 1);
  const drafts = generate(requested, evidence);
  assert.ok(drafts.every(d => d.images.length === 1));
  const result = reviewDrafts(requested, evidence, drafts);
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.some(i => i.message.includes('知识来源')));
  assert.ok(result.issues.some(i => i.category === 'platform' && i.message.includes('图片数量')));
});

test('supported percentages, typographic units and product version numbers do not create false positives', () => {
  const { brief, evidence } = fixture();
  const drafts = generate({ ...brief, audience: '设计创作者', scene: '设计工作' }, evidence);
  drafts[0].blocks[0].text = '屏幕尺寸为 14.2 英寸，色域为 100% sRGB。色域为典型值。';
  drafts[0].blocks[0].factIds = ['screen'];
  const result = reviewDrafts(brief, evidence, drafts);
  assert.ok(!result.issues.some(i => i.severity === 'error'), JSON.stringify(result.issues));
});

test('empty evidence does not produce an asserted product fact', () => {
  const { brief, evidence } = fixture();
  evidence.facts = [];
  const drafts = generate(brief, evidence);
  assert.ok(!drafts.some(d => d.blocks.some(b => b.factIds.length)));
  assert.equal(reviewDrafts(brief, evidence, drafts).status, 'blocked');
});

test('cover at afterBlock -1 is valid; out-of-range positions are flagged', () => {
  const { brief, evidence } = fixture();
  const drafts = generate(brief, evidence);
  drafts[0].images[0].afterBlock = -1;
  assert.ok(!reviewDrafts(brief, evidence, drafts).issues.some(i => i.message.includes('插入位置')));
  drafts[0].images[0].afterBlock = -2;
  assert.ok(reviewDrafts(brief, evidence, drafts).issues.some(i => i.message.includes('插入位置')));
});

test('live mode does not claim a rule generator removed a model request', () => {
  const { brief, evidence } = fixture();
  const live = { ...brief, mode: 'live' as const, instructions: '请加一个到手价 2999 元。' };
  const report = reviewDrafts(live, evidence, generate(live, evidence));
  const issue = report.issues.find(i => i.message.includes('附加要求涉及价格'));
  assert.ok(issue);
  assert.match(issue.message, /成稿不得采纳/);
  assert.ok(!issue.message.includes('规则生成器未采纳'));
});

test('nonnumeric functionality in title, intro or CTA requires body citations', () => {
  const { brief, evidence } = fixture();
  for (const field of ['title', 'intro', 'cta']) {
    const drafts = generate(brief, evidence);
    if (field === 'title') drafts[0].titles[0] = '搭载 OLED 触控屏，为创作而来';
    if (field === 'intro') drafts[0].intro = '支持跨设备共享文档，拥有超级终端。';
    if (field === 'cta') drafts[0].cta = '一键传文档，让手机电脑协同。';
    const result = reviewDrafts(brief, evidence, drafts);
    assert.ok(result.issues.some(i => i.message.includes('无段落引用的产品功能')), field);
  }
  const drafts = generate(brief, evidence);
  drafts[0].intro = '请核对常用软件支持范围，并到店确认配置。';
  assert.ok(!reviewDrafts(brief, evidence, drafts).issues.some(i => i.message.includes('无段落引用的产品功能')));
});

test('numbers preserve units, reject changed values, and ignore list numbering', () => {
  const { brief, evidence } = fixture();
  const drafts = generate(brief, evidence);
  drafts[0].blocks[0].text = '1. 机身重量为970g。\n2. 实际重量依配置而异。';
  drafts[0].blocks[0].factIds = ['weight'];
  assert.ok(!reviewDrafts(brief, evidence, drafts).issues.some(i => i.severity === 'error'), JSON.stringify(reviewDrafts(brief, evidence, drafts).issues));
  drafts[0].blocks[0].text = '机身重量为 99 g。';
  assert.ok(reviewDrafts(brief, evidence, drafts).issues.some(i => i.message.includes('99g')));
});

test('a scene containing 4K is task context, never a promised capability', () => {
  const { brief, evidence } = fixture();
  const scenario = { ...brief, audience: '视频创作者', scene: '4K 视频素材整理', goal: '为 2 个创作项目选机' };
  const report = reviewDrafts(scenario, evidence, generate(scenario, evidence));
  assert.ok(!report.issues.some(i => i.severity === 'error'), JSON.stringify(report.issues));
  const injected = { ...brief, scene: '搭载虚构芯片并预装所有软件' };
  assert.ok(!JSON.stringify(generate(injected, evidence)).includes('搭载虚构芯片'));
});

test('unselected screen feature footnotes do not bloat an unrelated screen statement', () => {
  const { brief, evidence } = fixture();
  evidence.facts[1].statement = '屏幕尺寸为 14.2 英寸，类型为 OLED。';
  evidence.facts[1].qualifiers = ['刷新率最高 144 Hz，不同应用界面存在差异。', 'HDR 亮度为 1000 尼特，仅限 Windows 版本。', '触控仅限特定版本。', '实际尺寸因测量方法而异。'];
  const drafts = generate({ ...brief, audience: '设计创作者', scene: '画面整理' }, evidence);
  assert.ok(!drafts[0].blocks[0].text.includes('144'));
  assert.ok(!drafts[0].blocks[0].text.includes('1000'));
  assert.ok(drafts[0].blocks[0].text.includes('实际尺寸'));
});

test('revision can emphasize an evidenced topic without inventing a capability', () => {
  const { brief, evidence } = fixture();
  const original = buildStrategies(brief, evidence);
  assert.equal(original[0].sellingPoints[0].factId, 'weight');
  const changed = { ...brief, instructions: '优先介绍内存，突出内存配置选项。' };
  const strategies = buildStrategies(changed, evidence);
  assert.ok(strategies.every(strategy => strategy.sellingPoints[0].factId === 'memory'));
  const drafts = buildDemoDrafts(changed, evidence, strategies);
  assert.ok(drafts.every(draft => draft.blocks[0].factIds[0] === 'memory'));
  assert.ok(drafts.every(draft => draft.blocks[0].text.includes(evidence.facts.find(f => f.id === 'memory')!.statement)));
  assert.ok(!reviewDrafts(changed, evidence, drafts).issues.some(issue => issue.severity === 'error'));
  const negated = buildStrategies({ ...brief, instructions: '不要强调内存。优先重量。' }, evidence);
  assert.equal(negated[0].sellingPoints[0].factId, 'weight');
});

test('image captions describe actual metadata without exposing verbose filenames', () => {
  const { brief, evidence } = fixture();
  evidence.images[0].name = 'hwpc_matebook_pro_OLED屏幕_01.png';
  evidence.images[0].description = 'OLED屏幕';
  assert.equal(generate(brief, evidence)[0].images[0].caption, 'OLED屏幕');
  evidence.images[0].description = evidence.images[0].name;
  assert.equal(generate(brief, evidence)[0].images[0].caption, '本型号产品资料图');
});
