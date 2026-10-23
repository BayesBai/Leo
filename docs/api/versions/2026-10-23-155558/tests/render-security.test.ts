import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Draft, RunResult } from '../shared/types.js';
import { renderWechatArticle } from '../server/render/wechat.js';
import { assertEmbeddedImages, escapeHtml, fillXhsTemplate, renderSatori, renderXhs, type RenderImage } from '../server/render/layouts.js';
import { readable } from '../server/render/index.js';
import { WorkflowError } from '../server/outlines.js';

const template = { id: 'wechat-editorial', platform: 'wechat' as const, name: '测试模板', width: 1200, height: 630 };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=';
const images: RenderImage[] = [0, 1].map(i => ({ id: `mock-image-${i}`, name: `图片${i} $& $' $\` <img onerror="bad">`, uri: png, width: 1, height: 1 }));
const draft: Draft = { id: 'draft-security', platform: 'wechat', titles: ['测试标题'], intro: '原样保留 WENYANRENDERIMAGE0PLACEHOLDER $& $\` $\' {{BODY_HTML}}',
  blocks: [{ id: 'b1', heading: '正文标题', text: '<script>window.bad=1</script>\n<img src="https://blocked.invalid/x" onerror="bad()">\n[链接](javascript:bad())\n&#x3c;iframe src="file:///secret"&#x3e;\n```mermaid\ngraph LR\nA-->B\n```\n---\naccount: secret', factIds: [] }],
  cta: '按原文条件核对后再使用。', tags: ['测试'], images: [{ imageId: images[0].id, afterBlock: -1, caption: '第一张图片', reason: '' }, { imageId: images[1].id, afterBlock: 0, caption: '第二张图片', reason: '' }] };

test('WeChat treats user markup/old placeholders/replacement sequences as text and retains every source image', async () => {
  const html = await renderWechatArticle(draft, '标题 $& $\' $\` {{SOURCE}} <svg onload="bad()">', images, template, '纯模拟 · 待复核');
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document; const bodyText = doc.body.textContent!;
    assert.equal(doc.querySelectorAll('img').length, 2, Array.from(doc.images).map(image => image.outerHTML).join('\n'));
    assert.deepEqual(Array.from(doc.images).map(image => image.getAttribute('alt')), images.map(image => image.name));
    assert.ok(Array.from(doc.images).every(image => image.getAttribute('src') === png));
    assert.equal(doc.querySelectorAll('script,iframe,svg,object,embed,link,style,a').length, 0);
    assert.ok(Array.from(doc.querySelectorAll('*')).every(element => Array.from(element.attributes).every(attribute => !/^on/i.test(attribute.name))));
    assert.ok(bodyText.includes(draft.intro)); assert.ok(bodyText.includes('<script>window.bad=1</script>'));
    assert.ok(bodyText.includes('[链接](javascript:bad())')); assert.ok(bodyText.includes('graph LR')); assert.ok(bodyText.includes('account: secret'));
    assert.doesNotMatch(bodyText, /WENYANCONTENT[a-f0-9]{32}INDEX\d+END/);
  } finally { dom.window.close(); }
});

test('XHS only expands original template slots once and preserves literal replacement syntax', () => {
  const user = '$& $\` $\' {{BODY_HTML}} <img src=x onerror=bad()> 即使出现模板变量也保留';
  const html = fillXhsTemplate('<h1>{{TITLE_BLOCK}}</h1><p>{{BODY_HTML}}</p>', { TITLE_BLOCK: escapeHtml(user), BODY_HTML: '正文' });
  const dom = new JSDOM(html);
  try { assert.equal(dom.window.document.querySelector('h1')!.textContent, user); assert.equal(dom.window.document.querySelector('p')!.textContent, '正文'); assert.equal(dom.window.document.images.length, 0); }
  finally { dom.window.close(); }
  assert.throws(() => fillXhsTemplate('{{UNKNOWN_SLOT}}', {}), error => error instanceof WorkflowError && error.status === 500);
});

test('all layout entry points refuse external, file, SVG and malformed image URIs before renderer activity', async () => {
  const page = { heading: '纯测试', text: '文字', images: [], factIds: [], role: 'card' as const };
  const cardTemplate = { id: 'moments-square', platform: 'moments' as const, name: '测试模板', width: 1080, height: 1080 };
  for (const uri of ['https://127.0.0.1/private', 'file:///private', 'data:image/svg+xml,<svg/>', png + '" onerror="bad()']) {
    const bad = [{ ...images[0], uri }];
    const rejected = (error: unknown) => error instanceof WorkflowError && error.status === 422;
    assert.throws(() => assertEmbeddedImages(bad), rejected);
    await assert.rejects(renderWechatArticle(draft, '测试', bad, template, '预览'), rejected);
    await assert.rejects(renderSatori({ ...page, images: bad }, cardTemplate, '预览', '测试'), rejected);
    await assert.rejects(renderXhs([{ ...page, images: bad }], { ...cardTemplate, id: 'xhs-cream', platform: 'xiaohongshu', height: 1440 }, '预览', '测试'), rejected);
  }
});

test('already cancelled render entry points do not launch optional renderers', async () => {
  const controller = new AbortController(); controller.abort();
  const page = { heading: '测试', text: '文字', images, factIds: [], role: 'card' as const };
  const cancelled = (error: unknown) => error instanceof Error && error.name === 'AbortError';
  await assert.rejects(renderWechatArticle(draft, '测试', images, template, '预览', controller.signal), cancelled);
  await assert.rejects(renderSatori(page, { ...template, platform: 'moments' }, '预览', '测试', controller.signal), cancelled);
  await assert.rejects(renderXhs([page], { ...template, platform: 'xiaohongshu' }, '预览', '测试', controller.signal), cancelled);
});

test('export text removes private links, asset handles, absolute paths and credential-like tokens', () => {
  const result = { product: { id: 'pc-test', name: '模拟产品' }, evidence: { facts: [], images: [], sources: [] } } as unknown as RunResult;
  const text = readable('公开文案\nC:\\Private Folder\\facts.md\n/home/user/private.txt\n\\\\server\\share\\private.txt\nhttps://private.invalid/x?signature=private\n/api/assets/mock-handle\nsk-mock-secret-token-123\n公开结尾', result);
  assert.doesNotMatch(text, /Private Folder|\/home\/|\\\\server|https?:\/\/|\/api\/assets|sk-mock-secret/);
  assert.match(text, /公开文案/); assert.match(text, /公开结尾/);
});

test('XHS renders literal markup and template sequences into an actual PNG', async () => {
  const page = { heading: '中文 $& {{BODY_HTML}}', text: '<script>文字</script> $\' $\`\n文字保留，不执行标签。', images: [], factIds: [], role: 'card' as const };
  const pngs = await renderXhs([page], { id: 'xhs-cream', platform: 'xiaohongshu', name: '测试模板', width: 1080, height: 1440 }, '纯模拟 · 预览', '模拟机型');
  assert.equal(pngs.length, 1); const meta = await sharp(pngs[0]).metadata(); assert.equal(meta.format, 'png'); assert.equal(meta.width, 1080); assert.equal(meta.height, 1440); assert.ok(pngs[0].length > 10000);
});

test('cancellation after an article file is written and rendering failure remove all unpublished assets', async () => {
  const cache = path.resolve('.cache'); await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(path.join(cache, 'render-security-'));
  const rendererUrl = new URL('../server/render/index.ts', import.meta.url).href;
  const knowledgeUrl = new URL('../server/knowledge.ts', import.meta.url).href;
  const code = `
    import assert from 'node:assert/strict';
    import { mkdir, writeFile, readdir } from 'node:fs/promises';
    import { watch } from 'node:fs';
    import path from 'node:path';
    process.env.AGENT_RENDER_DIR = path.resolve('.cache/render');
    const root = process.env.AGENT_RENDER_DIR; await mkdir(root, {recursive:true});
    process.env.LOCAL_KB_ROOT = path.resolve('mock-kb');
    const productDirectory = path.join(process.env.LOCAL_KB_ROOT,'P1-产品参数库','01-鸿蒙电脑','模拟机型');
    await mkdir(path.join(productDirectory,'images'), {recursive:true});
    await writeFile(path.join(productDirectory,'产品事实.md'), '# 模拟机型 - 产品事实\\n## 操作系统\\n测试系统\\n## 尺寸与重量\\n重量\\n约1.2 kg\\n## 屏幕\\n尺寸\\n14英寸\\n类型\\nLCD\\n分辨率\\n1920×1080\\n');
    await writeFile(path.join(productDirectory,'图片索引.csv'), '文件名,产品型号,官网图片说明\\na.png,模拟机型,模拟正面\\nb.png,模拟机型,模拟背面\\n');
    const sharp = (await import(${JSON.stringify(import.meta.resolve('sharp'))})).default;
    const image = await sharp({create:{width:20,height:20,channels:3,background:'#ddeedd'}}).png().toBuffer();
    for (const name of ['a.png','b.png']) await writeFile(path.join(productDirectory,'images',name),image);
    const {listProducts,getEvidence} = await import(${JSON.stringify(knowledgeUrl)});
    const {renderRun} = await import(${JSON.stringify(rendererUrl)});
    const product = (await listProducts())[0]; const evidence = await getEvidence(product.id,'local');
    const draft = {id:'mock-draft',platform:'wechat',titles:['模拟标题'],intro:'模拟导语',blocks:[{id:'b1',heading:'模拟说明',text:'完整保留文本。',factIds:[]}],cta:'请人工复核。',tags:[],images:evidence.images.map((image,index)=>({imageId:image.id,afterBlock:index-1,caption:'模拟图',reason:''}))};
    const result = {id:'mock-run',revision:1,createdAt:new Date().toISOString(),brief:{mode:'demo'},product,evidence,drafts:[draft],strategies:[],trace:[],notice:'纯模拟',review:{status:'needs_attention',issues:[],checks:[],reviewedBy:'rules',factCount:0,citedFactCount:0,imageCount:2}};
    const controller = new AbortController(); let observedHtml = false;
    const watcher = watch(root,{recursive:true},(_event,name)=>{if(String(name).endsWith('.html')){observedHtml=true;controller.abort();}});
    try { await assert.rejects(renderRun(result,{runId:result.id,revision:1,platform:'wechat',selectedTitleIndex:0,templateId:'wechat-editorial'},controller.signal),error=>error.status===499); }
    finally { watcher.close(); }
    assert.equal(observedHtml,true); assert.deepEqual(await readdir(root),[]);
    draft.platform='poster'; draft.images=draft.images.slice(0,1); draft.blocks[0].text='必须保留的限定条件。'.repeat(1000);
    await assert.rejects(renderRun(result,{runId:result.id,revision:1,platform:'poster',selectedTitleIndex:0,templateId:'poster-paper'}),error=>error.status===422);
    assert.deepEqual(await readdir(root),[]); console.log('isolated cleanup verified');
  `;
  try {
    const output = await promisify(execFile)(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', code], { cwd: temporary, windowsHide: true, timeout: 30_000, maxBuffer: 20_000 });
    assert.match(output.stdout, /isolated cleanup verified/);
  } finally {
    assert.equal(path.dirname(temporary), cache); await rm(temporary, { recursive: true, force: true });
  }
});
