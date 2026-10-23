/** Rehydrate the same local evidence handles after process restart; never re-call the model. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunResult } from '../shared/types.js';
import { getEvidence } from '../server/knowledge.js';
import { getRenderAsset, renderRun, renderTemplates } from '../server/render/index.js';
const input = path.resolve(process.argv[2] || 'output/live-workflow/result.json');
const result = JSON.parse(await readFile(input, 'utf8')) as RunResult;
if (result.evidence.sourceMode !== 'local') throw new Error('本脚本仅重建本地素材句柄；ima过期请走正式流程重新检索。');
const evidence = await getEvidence(result.brief.productId, 'local');
for (const fact of result.evidence.facts) {
  const fresh = evidence.facts.find(f => f.id === fact.id);
  if (!fresh || JSON.stringify([fresh.statement, fresh.quote, fresh.qualifiers]) !== JSON.stringify([fact.statement, fact.quote, fact.qualifiers])) throw new Error('事实已发生变化，不能沿用旧稿审核。');
}
for (const image of result.evidence.images) {
  const fresh = evidence.images.find(i => i.id === image.id);
  if (!fresh || fresh.productId !== image.productId || fresh.name !== image.name) throw new Error('原图映射发生变化，请重新生成。');
}
result.evidence = { ...result.evidence, images: evidence.images };
const template = renderTemplates.find(t => t.id === (process.argv[3] || 'moments-portrait'));
if (!template) throw new Error('未知模板');
const bundle = await renderRun(result, { runId: result.id, revision: result.revision, platform: template.platform, selectedTitleIndex: 0, templateId: template.id });
const output = path.dirname(input);
for (const artifact of bundle.artifacts) await writeFile(path.join(output, artifact.name), (await getRenderAsset(artifact.id)).data);
if (bundle.zipUrl) await writeFile(path.join(output, '成品与来源.zip'), (await getRenderAsset(bundle.zipUrl.split('/').pop()!.split('?')[0], true)).data);
const file = path.join(output, 'verification.json');
const verification = JSON.parse(await readFile(file, 'utf8')); verification.renderSucceeded = true; verification.templateId = template.id; verification.renderedAt = new Date().toISOString();
await writeFile(file, JSON.stringify(verification, null, 2));
console.log(JSON.stringify({ templateId: template.id, reviewStatus: bundle.reviewStatus, artifactCount: bundle.artifacts.length, modelRecalled: false }));
