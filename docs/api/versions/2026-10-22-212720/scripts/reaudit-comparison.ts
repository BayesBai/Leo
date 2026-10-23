/** Reuse unchanged real-model copy after a rule fix; no model calls, no claims of a fresh semantic review. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';
import type { RunResult } from '../shared/types.js';
import { getEvidence } from '../server/knowledge.js';
import { reviewDrafts } from '../server/policies.js';
import { mergeSemanticReview } from '../server/pipeline.js';
import { renderRun, getRenderAsset } from '../server/render/index.js';

const originalFolder = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2], '请指定需要复核的本地comparison目录');
const original: RunResult = JSON.parse(await readFile(path.join(originalFolder, 'result.json'), 'utf8'));
assert.equal(original.brief.mode, 'live'); assert.equal(original.review.reviewedBy, 'rules+model'); assert.equal(original.drafts.length, 4);
assert.equal(original.evidence.sourceMode, 'local', '此复核工具仅支持本地资料的原稿');
const evidence = await getEvidence(original.product.id, 'local');
// Reusing a semantic review is valid only when the reviewed copy and every fact/condition remain unchanged.
for (const fact of original.evidence.facts) {
  const current = evidence.facts.find(f => f.id === fact.id); assert.ok(current);
  assert.equal(current.quote, fact.quote); assert.deepEqual(current.qualifiers, fact.qualifiers); assert.equal(current.statement, fact.statement);
}
for (const draft of original.drafts) for (const placement of draft.images) assert.ok(evidence.images.some(image => image.id === placement.imageId));
const semantic = { summary: original.review.checks.find(c => c.label === '独立模型审稿')?.detail || '沿用原稿独立模型审稿', issues: original.review.issues.filter(i => i.id.startsWith('semantic-')) };
const result: RunResult = { ...original, revision: original.revision + 1, evidence, review: mergeSemanticReview(reviewDrafts(original.brief, evidence, original.drafts), semantic) };
assert.equal(result.review.issues.some(i => i.severity === 'error'), false, '仍有硬错误，不能生成可导出对照');
assert.notEqual(result.review.status, 'blocked');
assert.deepEqual(result.drafts, original.drafts);
const output = path.resolve('output', `channel-comparison-reaudit-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(output, { recursive: true });
const originalVerification = JSON.parse(await readFile(path.join(originalFolder, 'verification.json'), 'utf8'));
const report = { ...originalVerification, sourceRunId: original.id, revision: result.revision, startedAt: new Date().toISOString(), success: false,
  audit: '原文案与事实未变，沿用该稿已执行的独立模型审稿；使用当前规则重新核对、合并与排版。此次未重新调用模型或ima。', review: result.review.status, errorCount: 0 };
const dom = new JSDOM(await readFile(path.join(originalFolder, 'comparison.html'), 'utf8'));
try {
  const images: Buffer[] = [];
  const artifacts = [];
  const templateIds = { wechat: 'wechat-editorial', xiaohongshu: 'xhs-cream', moments: 'moments-portrait', poster: 'poster-ink' };
  for (const [index, platform] of (['wechat', 'xiaohongshu', 'moments', 'poster'] as const).entries()) {
    const bundle = await renderRun(result, { runId: result.id, revision: result.revision, platform, selectedTitleIndex: 0, templateId: templateIds[platform] });
    const folder = path.join(output, platform); await mkdir(folder);
    const column = dom.window.document.querySelector(`.channel-${platform}`)!;
    const pngNodes = column.querySelectorAll('figure img'); let pngIndex = 0;
    for (const artifact of bundle.artifacts) {
      const bytes = (await getRenderAsset(artifact.id)).data; await writeFile(path.join(folder, artifact.name), bytes);
      if (artifact.format === 'png') {
        const meta = await sharp(bytes).metadata(); assert.equal(meta.width, artifact.width); assert.equal(meta.height, artifact.height);
        pngNodes[pngIndex++].setAttribute('src', `data:image/png;base64,${bytes.toString('base64')}`);
        if (!images[index]) images[index] = await sharp(bytes).resize({ width: 350, height: 680, fit: 'contain', background: '#f3f1ec' }).png().toBuffer();
      } else column.querySelector('iframe')!.setAttribute('src', `data:text/html;base64,${bytes.toString('base64')}`);
    }
    assert.ok(bundle.zipUrl); const handle = bundle.zipUrl.split('/').at(-1)!.split('?')[0];
    await writeFile(path.join(folder, '成品与来源.zip'), (await getRenderAsset(handle, true)).data);
    await writeFile(path.join(folder, '文案.txt'), bundle.copyText);
    artifacts.push({ platform, exportable: true, files: bundle.artifacts.map(a => ({ name: a.name, format: a.format, width: a.width, height: a.height })) });
    console.log(`${platform}: ${bundle.artifacts.length} 个真实成品，${bundle.reviewStatus}`);
  }
  const overview = await sharp({ create: { width: 1480, height: 720, channels: 3, background: '#f3f1ec' } }).composite(images.map((input, i) => ({ input, left: 20 + i * 370, top: 20 }))).png().toBuffer();
  await writeFile(path.join(output, '四渠道成品对照.png'), overview);
  const aside = dom.window.document.querySelector('aside')!;
  aside.appendChild(dom.window.document.createElement('br')); aside.appendChild(dom.window.document.createTextNode(report.audit));
  const details = dom.window.document.querySelector('main>details')!;
  details.replaceChildren(); const summary = dom.window.document.createElement('summary'); summary.textContent = `审核提示（${result.review.issues.length}）`; details.appendChild(summary);
  for (const issue of result.review.issues) { const p = dom.window.document.createElement('p'); p.textContent = `${issue.severity}：${issue.message} ${issue.suggestion}`; details.appendChild(p); }
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  const html = dom.serialize(); await writeFile(path.join(output, 'comparison.html'), html); await writeFile('dist/four-channel-comparison.html', html);
  report.artifacts = artifacts; report.success = true;
  await writeFile(path.join(output, 'verification.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
  await writeFile('.cache/latest-channel-comparison.json', JSON.stringify({ output: path.relative(process.cwd(), output) }));
  console.log(JSON.stringify({ output: path.relative(process.cwd(), output), success: true, review: result.review.status, errorCount: 0 }));
} finally { dom.window.close(); }
