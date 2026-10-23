/** One brief → one confirmed outline → one run → four channel deliverables. --live calls the configured model. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { generateFromOutline } from '../src/api.js';
import { channelSimilarity } from '../server/channels.js';
import type { Brief, OutlineResult, Platform, Product, RenderBundle, RunResult } from '../shared/types.js';

const base = 'http://127.0.0.1:9755';
const mode = process.argv.includes('--live') ? 'live' : 'demo';
const platforms: Platform[] = ['wechat', 'xiaohongshu', 'moments', 'poster'];
const labels = ['公众号 · 决策解读', '小红书 · 选机清单', '朋友圈 · 私域沟通', '门店海报 · 主视觉'];
const templateIds = ['wechat-editorial', 'xhs-cream', 'moments-portrait', 'poster-ink'];
const output = path.resolve('output', `channel-comparison-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(output, { recursive: true });
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => originalFetch(new URL(String(url), base), options);
async function json<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, signal: AbortSignal.timeout(600_000), ...(body ? { headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Error(`HTTP ${response.status}: ${data.message || '请求失败'}`);
  return data;
}
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const report: Record<string, unknown> = { mode, startedAt: new Date().toISOString(), success: false };
try {
  const { products } = await json<{ products: Product[] }>('/api/products');
  const product = products.find(p => /MateBook 14/.test(p.name) && /鸿蒙|HarmonyOS/.test(p.name + p.system));
  assert.ok(product, '需要授权本地资料中的 MateBook 14 鸿蒙版');
  const brief: Brief = { productId: product.id, audience: '大学新生与家长', scene: '开学季选购与日常学习', goal: '到店体验', buyingStage: '对比选择', platforms,
    instructions: '同一产品面向同一批开学选机客户：公众号做选择分析，小红书做可收藏的到店提问清单，朋友圈只聊一个轻量话题并邀请私信，海报只选一个条件能完整放下的卖点。四份标题、开场和CTA不能互相复制。优先选条件简明的系统、屏幕尺寸等事实，避免在短版中堆复杂参数。不要虚构亲测、软件兼容性、性能体验、优惠或价格。保留所选事实的必要条件；自然嵌入即可，不要逐段堆免责声明。',
    mode, knowledgeSource: 'local' };
  console.log(`开始 ${mode} 同任务四渠道大纲。`);
  const outline = await json<OutlineResult>('/api/outlines', 'POST', brief);
  await writeFile(path.join(output, 'outline.json'), JSON.stringify(outline, null, 2));
  assert.equal(outline.platforms.length, 4);
  await json(`/api/outlines/${outline.id}/confirm`, 'POST', { version: outline.version });
  console.log('同一个大纲已确认，开始正文与审稿。');
  const result: RunResult = await generateFromOutline(outline.id, outline.version, AbortSignal.timeout(900_000), entry => { if (entry.status === 'done') console.log(`${entry.step}: ${entry.label}`); });
  assert.equal(result.outline?.id, outline.id); assert.equal(result.drafts.length, 4);
  assert.equal(result.review.status === 'blocked', result.review.issues.some(i => i.severity === 'error'), '审核状态必须与硬错误一致');
  if (mode === 'live') assert.equal(result.review.reviewedBy, 'rules+model');
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  report.runId = result.id; report.outlineVersion = outline.version; report.review = result.review.status; report.reviewedBy = result.review.reviewedBy;
  report.channels = result.drafts.map(d => ({ platform: d.platform, title: d.titles[0], blocks: d.blocks.length, characters: Array.from([d.intro, ...d.blocks.map(b => b.text), d.cta].join('')).length }));
  report.similarity = result.drafts.flatMap((a, i) => result.drafts.slice(i + 1).map(b => ({ a: a.platform, b: b.platform, score: channelSimilarity(a, b, result.evidence) })));
  const columns: string[] = [], thumbnails: Buffer[] = [], bundles: RenderBundle[] = [];
  for (const [i, platform] of platforms.entries()) {
    const draft = result.drafts.find(d => d.platform === platform)!;
    const folder = path.join(output, platform); await mkdir(folder);
    const bundle = await json<RenderBundle>('/api/render', 'POST', { runId: result.id, revision: result.revision, platform, selectedTitleIndex: 0, templateId: templateIds[i] });
    assert.equal(bundle.runId, result.id); assert.equal(bundle.platform, platform); bundles.push(bundle);
    const copy = [draft.titles[0], draft.intro, ...draft.blocks.map(b => `${b.heading}\n${b.text}`), draft.cta, draft.tags.map(t => `#${t}`).join(' ')].filter(Boolean).join('\n\n');
    await writeFile(path.join(folder, '文案.txt'), copy);
    const visuals: string[] = [], articles: string[] = [];
    for (const artifact of bundle.artifacts) {
      const response = await fetch(artifact.previewUrl); assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer()); await writeFile(path.join(folder, artifact.name), bytes);
      if (artifact.format === 'png') {
        const meta = await sharp(bytes).metadata(); assert.equal(meta.width, artifact.width); assert.equal(meta.height, artifact.height);
        visuals.push(`<figure><img src="data:image/png;base64,${bytes.toString('base64')}" alt="${escape(artifact.name)}"><figcaption>${escape(artifact.name)} · ${meta.width}×${meta.height}</figcaption></figure>`);
        if (!thumbnails[i]) thumbnails[i] = await sharp(bytes).resize({ width: 350, height: 680, fit: 'contain', background: '#f3f1ec' }).png().toBuffer();
      } else articles.push(`<details><summary>展开公众号长文排版</summary><iframe title="公众号文章" sandbox="" src="data:text/html;base64,${bytes.toString('base64')}"></iframe></details>`);
    }
    if (bundle.zipUrl) {
      const response = await fetch(bundle.zipUrl); assert.equal(response.status, 200);
      await writeFile(path.join(folder, '成品与来源.zip'), Buffer.from(await response.arrayBuffer()));
    }
    columns.push(`<section class="channel channel-${platform}"><header><small>0${i + 1} / ${labels[i]}</small><h2>${escape(draft.titles[0])}</h2><p>${draft.blocks.length} 段 · ${draft.images.length} 张原图</p></header>${visuals.join('')}${articles.join('')}<details><summary>展开完整文案</summary><pre>${escape(copy)}</pre></details></section>`);
    console.log(`${platform}: ${bundle.artifacts.length} 个成品文件，${bundle.reviewStatus}`);
  }
  const overview = await sharp({ create: { width: 1480, height: 720, channels: 3, background: '#f3f1ec' } }).composite(thumbnails.map((input, i) => ({ input, left: 20 + i * 370, top: 20 }))).png().toBuffer();
  await writeFile(path.join(output, '四渠道成品对照.png'), overview);
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-src data:"><title>知序 · 同任务四渠道对比</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f1ec;color:#253a36;font:15px/1.8 system-ui,sans-serif}main{max-width:1680px;padding:40px 24px;margin:auto}h1{font-size:32px;margin:0}h2{font-size:21px;line-height:1.5}small{letter-spacing:1px}aside{background:#fff7df;border-left:4px solid #ad7b32;padding:16px;margin:24px 0}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;align-items:start}.channel{min-width:0;background:white;border-top:6px solid #b66947;border-radius:12px;overflow:hidden}.channel-xiaohongshu{border-color:#e7bd4b}.channel-moments{border-color:#478d6b}.channel-poster{border-color:#284461}header{padding:20px;min-height:205px}figure{margin:0 16px 22px}img{display:block;width:100%;height:auto}figcaption{font-size:11px;color:#7b857a}details{padding:16px;border-top:1px solid #e2e5dc}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.9 system-ui}iframe{width:100%;height:800px;border:0}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.grid{grid-template-columns:1fr}}</style><main><small>ONE BRIEF / FOUR CHANNELS</small><h1>同一任务，四种表达。</h1><p>${escape(product.name)} · ${escape(brief.scene)} · ${escape(brief.audience)} · ${escape(brief.goal)}</p><aside>${mode === 'live' ? 'DeepSeek 真实生成 + 独立模型审稿' : '规则演示'} · ${escape(result.review.status)}<br>使用本地授权资料，未进行 ima 在线核验；发布前核对销售版本与事实限制。以下均为同一个已确认大纲、同一次正文任务的成品。</aside><div class="grid">${columns.join('')}</div><details><summary>审核提示（${result.review.issues.length}）</summary>${result.review.issues.map(issue => `<p>${escape(issue.severity)}：${escape(issue.message)} ${escape(issue.suggestion)}</p>`).join('')}</details></main></html>`;
  await writeFile(path.join(output, 'comparison.html'), html);
  await mkdir('dist', { recursive: true }); await writeFile('dist/four-channel-comparison.html', html);
  report.artifacts = bundles.map(b => ({ platform: b.platform, files: b.artifacts.map(a => ({ name: a.name, format: a.format, width: a.width, height: a.height })), exportable: !!b.zipUrl }));
  report.success = true;
} catch (error) { report.error = error instanceof Error ? error.message : 'Unknown error'; process.exitCode = 1; console.error(report.error); }
finally {
  report.finishedAt = new Date().toISOString(); await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
  await writeFile('.cache/latest-channel-comparison.json', JSON.stringify({ output: path.relative(process.cwd(), output) }));
  console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...report }));
}
