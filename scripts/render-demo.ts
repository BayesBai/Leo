import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { listProducts } from '../server/knowledge.js';
import { createOutline, confirmOutline, confirmedOutline } from '../server/outlines.js';
import { runPipeline } from '../server/pipeline.js';
import { getRenderAsset, renderRun, renderTemplates } from '../server/render/index.js';
import type { Brief, Platform } from '../shared/types.js';
const product = (await listProducts()).find(p => /MateBook 14/.test(p.name) && /鸿蒙|HarmonyOS/.test(p.system + p.name));
if (!product) throw new Error('演示需要本地 MateBook 14 鸿蒙版的获授权知识库。');
const output = path.resolve('output/four-channel-demo'); await mkdir(output, { recursive: true });
for (const platform of ['wechat', 'xiaohongshu', 'moments', 'poster'] as Platform[]) {
  console.log(`${platform}: 开始读取资料与创建大纲`);
  const brief: Brief = { productId: product.id, audience: '大学新生', scene: '开学季', goal: '到店体验', buyingStage: '对比选择', platforms: [platform], instructions: '', mode: 'demo', knowledgeSource: 'local' };
  const outline = await createOutline(brief); confirmOutline(outline.id, outline.version);
  const approved = confirmedOutline(outline.id, outline.version);
  const result = await runPipeline(brief, undefined, { outline: approved, evidence: approved.evidence });
  console.log(`${platform}: 正文审稿完成，开始渲染`);
  const template = renderTemplates.find(t => t.platform === platform)!;
  try {
    const bundle = await renderRun(result, { runId: result.id, revision: result.revision, platform, selectedTitleIndex: 0, templateId: template.id });
    const folder = path.join(output, platform); await mkdir(folder, { recursive: true });
    for (const artifact of bundle.artifacts) {
      const asset = await getRenderAsset(artifact.id); await writeFile(path.join(folder, artifact.name), asset.data);
      if (artifact.format === 'png') { const meta = await sharp(asset.data).metadata(); if (meta.width !== artifact.width || meta.height !== artifact.height) throw new Error('PNG 尺寸不符合协议'); }
    }
    if (bundle.zipUrl) { const handle = bundle.zipUrl.split('/').pop()!.split('?')[0]; await writeFile(path.join(folder, `${platform}.zip`), (await getRenderAsset(handle, true)).data); }
    await writeFile(path.join(folder, 'verification.json'), JSON.stringify({ platform, outlineVersion: outline.version, reviewStatus: bundle.reviewStatus, artifacts: bundle.artifacts.map(({ id: _id, previewUrl: _preview, downloadUrl: _download, sourceImageIds: _images, factIds: _facts, ...a }) => a), warnings: bundle.warnings }, null, 2));
    console.log(`${platform}: ${bundle.artifacts.length} 个真实文件，${bundle.reviewStatus}`);
  } catch (error) { console.error(`${platform}:`, error); process.exitCode = 1; }
}
