import dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listProducts } from '../server/knowledge.js';
import { createOutline, confirmOutline, confirmedOutline, publicOutline, saveOutline } from '../server/outlines.js';
import { publicResult, runPipeline } from '../server/pipeline.js';
import { renderRun, getRenderAsset } from '../server/render/index.js';
dotenv.config({ path: '.env.local' }); dotenv.config();
const ima = process.argv.includes('--ima');
const product = (await listProducts()).find(p => /MateBook 14/.test(p.name) && /鸿蒙|HarmonyOS/.test(p.system + p.name))!;
const output = path.resolve('output/live-workflow'); await mkdir(output, { recursive: true });
let outline = await createOutline({ productId: product.id, audience: '大学新生', scene: '开学季', goal: '到店体验', buyingStage: '对比选择', platforms: ['moments'], instructions: '只围绕机身重量的一个段落写作，完整保留圆键盘与方键盘条件及测量差异，不扩展其他卖点。不写价格或亲测经历。', mode: 'live', knowledgeSource: ima ? 'ima' : 'local' });
await writeFile(path.join(output, 'model-outline.json'), JSON.stringify(publicOutline(outline), null, 2));
if (process.argv.includes('--edit-one-point')) {
  const fact = outline.evidence.facts.find(f => /重量|kg|千克/i.test(f.statement));
  if (!fact) throw new Error('没有可供单卖点验收的已支持事实。');
  const p = outline.platforms[0];
  outline = saveOutline(outline.id, outline.version, [{ ...p, title: '开学选机，先想想每天怎么带', intro: '大学新生的日常携带需求，可先列入到店核对清单。', sections: [{ id: 'b-weight', heading: '携带相关规格', points: [fact.statement, ...fact.qualifiers].slice(0, 4), factIds: [fact.id] }], imageIds: p.imageIds.slice(0, 1), cta: '欢迎带着自己的学习任务到店，核对实际销售配置。' }]);
}
console.log('真实大纲已生成，进入确认。');
confirmOutline(outline.id, outline.version);
const approved = confirmedOutline(outline.id, outline.version);
const result = await runPipeline(approved.brief, entry => { if (entry.status === 'done') console.log(`${entry.step}: ${entry.label}`); }, { evidence: approved.evidence, outline: approved });
await writeFile(path.join(output, 'result.json'), JSON.stringify(publicResult(result), null, 2));
const report = { checkedAt: new Date().toISOString(), source: result.evidence.sourceMode, modelCalled: true, reviewedBy: result.review.reviewedBy, reviewStatus: result.review.status, outlineVersion: approved.version, sectionCount: approved.platforms[0].sections.length, issues: result.review.issues.map(i => ({ severity: i.severity, category: i.category })), renderSucceeded: false };
try {
  const bundle = await renderRun(result, { runId: result.id, revision: result.revision, platform: 'moments', selectedTitleIndex: 0, templateId: 'moments-portrait' });
  for (const artifact of bundle.artifacts) await writeFile(path.join(output, artifact.name), (await getRenderAsset(artifact.id)).data);
  report.renderSucceeded = true;
} finally { await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report));
