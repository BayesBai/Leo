import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { Brief, Draft, EvidenceBundle, RenderTemplate } from '../shared/types.js';
import { briefSchema, outlineEditSchema } from '../server/schemas.js';
import { channelSimilarity } from '../server/channels.js';
import { reviewDrafts } from '../server/policies.js';
import { mergeSemanticReview } from '../server/pipeline.js';
import { renderEditorialCover, renderMomentsCard, renderStorePoster } from '../server/render/compositions.js';
import { planXhs, renderXhs, type RenderImage } from '../server/render/layouts.js';

const mock = JSON.parse(await readFile(new URL('../docs/api/versions/2026-10-18-165045/fixtures/frontend.mock.json', import.meta.url), 'utf8'));
const evidence = mock.result.evidence as EvidenceBundle;
const brief = { ...mock.result.brief, platforms: ['wechat', 'xiaohongshu', 'moments', 'poster'] } as Brief;
const draft = (platform: Draft['platform']): Draft => ({ id: 'mock-draft', platform, titles: ['模拟选机提问'], intro: '模拟开学场景，先明确日常任务。', blocks: [{ id: 'b1', heading: '模拟系统', text: '这是模拟产品条件，发布前需要核对。', factIds: [] }], cta: '带着问题到店交流。', tags: [], images: [] });
const template = (platform: Draft['platform'], width = 1080, height = 1440): RenderTemplate => ({ id: platform === 'poster' ? 'poster-ink' : platform === 'xiaohongshu' ? 'xhs-cream' : `${platform}-test`, platform, name: '模拟模板', width, height });
const imageBytes = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#a2b9c5' } }).png().toBuffer();
const images: RenderImage[] = [{ id: 'mock-image', name: '模拟占位图', uri: `data:image/png;base64,${imageBytes.toString('base64')}`, width: 300, height: 200 }];

test('one task accepts all four channels and keeps duplicate/oversized input rejection', () => {
  assert.equal(briefSchema.parse(brief).platforms.length, 4);
  assert.equal(briefSchema.parse({ ...brief, platforms: ['wechat', 'poster'] }).platforms.length, 2);
  assert.equal(briefSchema.safeParse({ ...brief, platforms: [...brief.platforms, 'wechat'] }).success, false);
  assert.equal(briefSchema.safeParse({ ...brief, platforms: ['wechat', 'wechat'] }).success, false);
  const platformOutlines = brief.platforms.map(platform => ({ platform, title: '模拟大纲', angle: '', intro: '', sections: [{ id: 'b1', heading: '模拟', points: ['模拟内容'], factIds: [] }], imageIds: [], cta: '模拟交流' }));
  assert.equal(outlineEditSchema.parse({ version: 1, platforms: platformOutlines }).platforms.length, 4);
});

test('review warns about copied framing while shared product body facts alone are not similar framing', () => {
  const a = draft('wechat'), b = draft('moments');
  a.intro = b.intro = '开学选择电脑之前，我们一起从常用任务出发，再看看清单中有哪些需要到店确认的问题。';
  assert.equal(channelSimilarity(a, b, evidence), 1);
  assert.ok(reviewDrafts(brief, evidence, [a, b]).issues.some(issue => issue.category === 'platform' && issue.message.includes('过于接近')));
  b.titles = ['周末来聊聊']; b.intro = '最近有朋友问起开学的安排，欢迎私信说说你的学习计划。'; b.blocks[0].heading = '今天的一点分享'; b.cta = '想交流的朋友可以留言。';
  assert.ok(channelSimilarity(a, b, evidence) < 0.76);
  assert.ok(!reviewDrafts(brief, evidence, [a, b]).issues.some(issue => issue.message.includes('过于接近')));
});

test('ordinary store-action suggestions are not superiority claims, and no hard error can become exportable after model review', () => {
  const d = draft('moments');
  d.blocks[0].text = '最好亲手拿起对应版本，也可以先带上自己的软件清单到店核对。';
  assert.ok(!reviewDrafts(brief, evidence, [d]).issues.some(i => i.message.includes('绝对化')));
  d.blocks[0].text = '这款产品是业内最好、最强的电脑。';
  const base = reviewDrafts(brief, evidence, [d]);
  assert.ok(base.issues.some(i => i.category === 'compliance' && i.severity === 'error'));
  const complianceOnly = { ...base, issues: base.issues.filter(i => i.category === 'compliance') };
  assert.equal(mergeSemanticReview(complianceOnly, { summary: '模型未发现问题', issues: [] }).status, 'blocked');
});

test('new compositions produce distinct actual PNGs from identical content, preserve capacity and reject external images', async () => {
  const pngs = await Promise.all([
    renderEditorialCover('模拟选机提问', images, template('wechat', 1200, 900), '纯模拟 · 待复核', '模拟机型'),
    renderMomentsCard(draft('moments'), '模拟选机提问', images, template('moments'), '纯模拟 · 待复核', '模拟机型'),
    renderStorePoster(draft('poster'), '模拟选机提问', images, template('poster', 1080, 1920), '纯模拟 · 待复核', '模拟机型'),
  ]);
  assert.deepEqual(await Promise.all(pngs.map(async png => { const meta = await sharp(png).metadata(); return [meta.width, meta.height]; })), [[1200, 900], [1080, 1440], [1080, 1920]]);
  const samples = await Promise.all(pngs.map(png => sharp(png).resize(8, 8).removeAlpha().raw().toBuffer()));
  assert.ok(!samples[0].equals(samples[1]) && !samples[1].equals(samples[2]));
  const huge = draft('poster'); huge.blocks[0].text = '所有必要事实条件都必须完整保留。'.repeat(1000);
  await assert.rejects(renderStorePoster(huge, '模拟', images, template('poster', 1080, 1920), '纯模拟', '模拟机型'), (error: any) => error.status === 422);
  const bad = [{ ...images[0], uri: 'https://blocked.invalid/private.png' }];
  await assert.rejects(renderEditorialCover('模拟', bad, template('wechat'), '模拟', '模拟'), (error: any) => error.status === 422);
  await assert.rejects(renderMomentsCard(draft('moments'), '模拟', bad, template('moments'), '模拟', '模拟'), (error: any) => error.status === 422);
  await assert.rejects(renderStorePoster(draft('poster'), '模拟', bad, template('poster'), '模拟', '模拟'), (error: any) => error.status === 422);
  const aborted = AbortSignal.abort();
  await assert.rejects(renderStorePoster(draft('poster'), '模拟', images, template('poster'), '模拟', '模拟', aborted), { name: 'AbortError' });
});

test('XHS cover, checklist and closing pages are visually different and form one complete sequence', async () => {
  const d = draft('xiaohongshu'); d.blocks.push({ ...d.blocks[0], id: 'b2', heading: '再确认' });
  const pages = planXhs(d, d.titles[0], images);
  assert.deepEqual(pages.map(p => p.kind), ['cover', 'checklist', 'checklist', 'closing']);
  const pngs = await renderXhs(pages, template('xiaohongshu'), '纯模拟 · 待复核', '模拟机型');
  const samples = await Promise.all([pngs[0], pngs[1], pngs.at(-1)!].map(png => sharp(png).resize(1, 1).removeAlpha().raw().toBuffer()));
  assert.ok(!samples[0].equals(samples[1]) && !samples[1].equals(samples[2]));
});
