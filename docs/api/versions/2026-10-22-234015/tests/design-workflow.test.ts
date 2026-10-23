import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';
import type { Brief, Draft, Platform, RenderTemplate } from '../shared/types.js';
import { buildDesignBrief, buildLayeredDeck, compileImagePrompt, DESIGN_SKILL_HASHES, DESIGN_SKILL_VERSION, designBriefSchema } from '../server/design/index.js';
import { planXhs, renderSatori, renderXhs, type RenderImage } from '../server/render/layouts.js';
import { renderWechatArticle } from '../server/render/wechat.js';
import { renderEditorialCover, renderStorePoster } from '../server/render/compositions.js';

const brief: Brief = { productId: 'mock-product', audience: '有日常资料阅读需求的学生', scene: '开学前确认课程软件与通勤携带安排', goal: '到店核对真实配置与课程软件', buyingStage: '了解', platforms: ['xiaohongshu', 'wechat', 'moments', 'poster'], instructions: '', mode: 'demo', knowledgeSource: 'local' };
const draft = (platform: Platform): Draft => ({ id: `design-${platform}`, platform, titles: ['开学选电脑，先列好真实需求'], intro: '把软件与携带安排放在一起考虑。', blocks: [
  { id: 'b1', heading: '先确认软件', text: '先列出课程软件，再核对所选版本适配条件。', factIds: ['fact-software'] },
  { id: 'b2', heading: '再看实际携带', text: '尺寸和重量因配置版本而异，须以所选销售版本为准。', factIds: ['fact-weight'] },
  { id: 'b3', heading: '带上自己的资料', text: '现场打开自己的资料，再观察显示是否适合。', factIds: ['fact-screen'] },
], cta: '带着清单到店核对。', tags: [], images: [] });
const bytes = await sharp({ create: { width: 150, height: 100, channels: 3, background: '#b8c9bc' } }).png().toBuffer();
const backgroundBytes = await sharp({ create: { width: 300, height: 400, channels: 3, background: '#e8dccb' } }).png().toBuffer();
const image: RenderImage = { id: 'mock-original', name: '纯模拟产品原图', uri: `data:image/png;base64,${bytes.toString('base64')}`, width: 150, height: 100 };
const background: RenderImage = { id: 'mock-generated', name: '纯模拟场景背景', uri: `data:image/png;base64,${backgroundBytes.toString('base64')}`, width: 300, height: 400 };
const template = (platform: Platform, width = 1080, height = 1440): RenderTemplate => ({ id: `${platform}-paper`, platform, name: '纯模拟', width, height });

test('runtime design modules pin source bytes and licenses and validate complete briefs', async () => {
  assert.equal(Object.keys(DESIGN_SKILL_HASHES).length, 10);
  for (const [path, expected] of Object.entries(DESIGN_SKILL_HASHES)) {
    const value = await readFile(new URL(`../server/design/vendor/${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(value).digest('hex'), expected);
  }
  const d = draft('xiaohongshu');
  const design = buildDesignBrief({ draft: d, brief, title: d.titles[0], productName: '纯模拟机型' });
  assert.equal(design.version, DESIGN_SKILL_VERSION); assert.deepEqual(design.canvas, { width: 1080, height: 1440 });
  assert.equal(design.exactCopy.body[1], d.blocks[1].text);
  assert.throws(() => buildDesignBrief({ draft: d, brief: { ...brief, audience: '' }, title: d.titles[0], productName: '纯模拟机型' }), (error: any) => error.status === 422);
  assert.equal(designBriefSchema.safeParse({ ...design, titleZone: { x: .9, y: .1, width: .9, height: .2 } }).success, false);
  assert.throws(() => buildDesignBrief({ draft: draft('moments'), brief, title: '测试', productName: '纯模拟' }), (error: any) => error.status === 422);
});

test('compiled image prompt includes complete geometry, constraints and reproducible rule versions without asking AI to draw product or Chinese text', () => {
  const d = draft('poster'); const design = buildDesignBrief({ draft: d, brief, title: d.titles[0], productName: '纯模拟机型' });
  const result = compileImagePrompt(design);
  assert.ok(result.prompt.length > 1200); assert.equal(result.skillVersion, DESIGN_SKILL_VERSION);
  assert.equal(result.promptHash, createHash('sha256').update(result.prompt).digest('hex'));
  for (const section of ['1080×1920', '目标受众', '渠道与职责', '预留位置', '标题层预留区域', '正文及行动区', '安全边距', '阅读路径', '色彩', '字体层级', '光线与材质', '系列一致性', '禁止事项', '不生成电脑', '不生成任何中文']) assert.ok(result.prompt.includes(section), section);
  assert.equal(result.prompt.includes(d.titles[0]), false, 'approved words belong to editable text, not image prompt');
});

test('XHS uses three to six information pages, retains actual conditions and CTA, and has no stock ending', () => {
  for (const count of [1, 2, 3, 6, 11]) {
    const d = draft('xiaohongshu'); d.blocks = Array.from({ length: count }, (_, index) => ({ ...d.blocks[index % 3], id: `b${index}`, heading: `事项${index}` }));
    const pages = planXhs(d, d.titles[0], [image]);
    assert.ok(pages.length >= 3 && pages.length <= 6);
    assert.equal(pages.filter(page => page.kind === 'closing').length, 0);
    const content = pages.map(page => page.text).join('');
    assert.ok(content.includes(d.cta));
    for (const block of d.blocks) assert.ok(content.includes(block.text), block.text);
  }
});

test('Canva import deck has real separate background, source picture and editable Chinese text and genuine MCP replacement placeholder', async () => {
  const d = draft('xiaohongshu'); const design = buildDesignBrief({ draft: d, brief, title: d.titles[0], productName: '纯模拟机型' });
  const result = await buildLayeredDeck({ draft: d, title: d.titles[0], productName: '纯模拟机型', platform: 'xiaohongshu', images: [image], background, brief: design, editableTitlePlaceholder: true });
  assert.equal(result.pages.length, 4); assert.deepEqual(result.verificationEdit, { from: 'VIRGO_HEADLINE_PLACEHOLDER', to: d.titles[0] });
  const files = unzipSync(result.buffer); const first = strFromU8(files['ppt/slides/slide1.xml']);
  assert.match(first, /AI_ENVIRONMENT_BACKGROUND/); assert.match(first, /PRODUCT_ORIGINAL_mock-original/); assert.match(first, /APPROVED_HEADLINE/); assert.match(first, /VIRGO_HEADLINE_PLACEHOLDER/);
  assert.ok((first.match(/<p:pic>/g) || []).length >= 2); assert.match(first, /<a:t>纯模拟机型<\/a:t>/);
  const media = Object.entries(files).filter(([key]) => key.startsWith('ppt/media/')).map(([, value]) => Buffer.from(value));
  assert.ok(media.some(value => value.equals(bytes)), 'unaltered product bytes must remain an independent image');
  assert.ok(media.some(value => value.equals(backgroundBytes)), 'AI background remains a separate image');
  const content = Object.entries(files).filter(([key]) => /^ppt\/slides\/slide\d+\.xml$/.test(key)).map(([, value]) => strFromU8(value)).join('');
  for (const block of d.blocks) assert.ok(content.includes(block.text));
  assert.doesNotMatch(content, /审核中|仅供预览|发布前复核|本地资料|检查通过/);
  assert.equal(result.pages[0].sourceImageIds.includes(background.id), false);
});

test('WeChat and poster decks use exact channel sizes, preserve text and reject missing product evidence or cancellation', async () => {
  for (const platform of ['wechat', 'poster'] as const) {
    const d = draft(platform); const result = await buildLayeredDeck({ draft: d, title: d.titles[0], productName: '纯模拟', platform, images: [image], background });
    assert.deepEqual([result.pages[0].width, result.pages[0].height], platform === 'wechat' ? [1200, 510] : [1080, 1920]);
    const files = unzipSync(result.buffer); const xml = strFromU8(files['ppt/slides/slide1.xml']);
    assert.match(xml, /APPROVED_HEADLINE/); assert.match(xml, /PRODUCT_ORIGINAL/);
    const backgroundLayer = xml.match(/<p:pic>[^]*?name="AI_ENVIRONMENT_BACKGROUND"[^]*?<\/p:pic>/)?.[0];
    assert.ok(backgroundLayer);
    assert.match(backgroundLayer, /<a:srcRect l="\d+" r="\d+" t="\d+" b="\d+"\/>/, 'background reuses original pixels with an editable aspect-preserving crop');
    if (platform === 'wechat') assert.ok(!backgroundLayer.includes('t="0" b="0"'), 'portrait visual must be reframed for landscape instead of stretched');
    if (platform === 'poster') for (const block of d.blocks) assert.ok(xml.includes(block.text));
  }
  const d = draft('poster');
  await assert.rejects(buildLayeredDeck({ draft: d, title: d.titles[0], productName: '模拟', platform: 'poster', images: [], background }), (error: any) => error.status === 422);
  await assert.rejects(buildLayeredDeck({ draft: d, title: d.titles[0], productName: '模拟', platform: 'poster', images: [image], signal: AbortSignal.abort() }), { name: 'AbortError' });
  d.blocks[0].text = '完整保留必要事实与限定条件。'.repeat(2000);
  await assert.rejects(buildLayeredDeck({ draft: d, title: d.titles[0], productName: '模拟', platform: 'poster', images: [image] }), (error: any) => error.status === 422);
});

test('review status never enters article content or composited image pixels', async () => {
  const d = draft('wechat'); const a = await renderWechatArticle(d, d.titles[0], [], template('wechat'), '审核中，仅供预览');
  const b = await renderWechatArticle(d, d.titles[0], [], template('wechat'), '内容检查通过 · 本地资料 · 发布前复核');
  assert.equal(a, b);
  const dom = new JSDOM(a); try { assert.doesNotMatch(dom.window.document.body.textContent!, /审核中|仅供预览|发布前复核|本地资料|检查通过/); assert.ok(dom.window.document.body.textContent!.includes(d.blocks[1].text)); } finally { dom.window.close(); }
  for (const render of [
    (marker: string) => renderEditorialCover('先核对课程软件', [image], template('wechat', 1200, 510), marker, '纯模拟'),
    (marker: string) => renderStorePoster(draft('poster'), '先核对课程软件', [image], template('poster', 1080, 1920), marker, '纯模拟'),
    (marker: string) => renderSatori({ heading: '模拟内容', text: '必要条件原样保留。', images: [image], factIds: [], role: 'card' }, template('xiaohongshu'), marker, '纯模拟'),
  ]) assert.ok((await render('审核中，仅供预览')).equals(await render('内容检查通过')));
  const pages = planXhs(draft('xiaohongshu'), '模拟真实信息', [image]);
  const pngsA = await renderXhs(pages, template('xiaohongshu'), '审核中，仅供预览', '纯模拟');
  const pngsB = await renderXhs(pages, template('xiaohongshu'), '内容检查通过', '纯模拟');
  assert.ok(pngsA.every((value, index) => value.equals(pngsB[index])));
});
