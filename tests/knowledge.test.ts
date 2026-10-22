import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseCsv, detectImageType, listProducts, getEvidence, getAsset, getLocalStats, extractFacts, verifyIma, getImaStatus } from '../server/knowledge';
import type { Product } from '../shared/types';
import { SYNTHETIC_HARMONY_SYSTEM, SYNTHETIC_PRODUCT_NAME, SYNTHETIC_WINDOWS_SYSTEM } from './fixtures/synthetic-kb.js';

test('CSV preserves quoted commas, escaped quotes, multiline Chinese descriptions and BOM', () => {
  assert.deepEqual(parseCsv('\uFEFF文件名,官网图片说明\r\n"a.jpg","外观,机身"\r\n"b.png","第一行\n第二行 ""绿色"""'), [
    { 文件名: 'a.jpg', 官网图片说明: '外观,机身' }, { 文件名: 'b.png', 官网图片说明: '第一行\n第二行 "绿色"' },
  ]);
  assert.throws(() => parseCsv('a,b\n1,"unclosed'), /引号/);
});

test('image validation uses bytes, rejecting a renamed HTML response', () => {
  assert.equal(detectImageType(Buffer.from('<html>login</html>')), undefined);
  assert.equal(detectImageType(Buffer.from([255, 216, 255, 0])), 'image/jpeg');
  assert.equal(detectImageType(Buffer.from([137,80,78,71,13,10,26,10])), 'image/png');
  assert.equal(detectImageType(Buffer.from('RIFFxxxxWEBP')), 'image/webp');
});

test('facts preserve system and SKU restrictions next to the corresponding CPU', () => {
  const product: Product = { id: 'p', name: 'Specific Model', system: 'Windows / Linux', category: '', description: '', imageCount: 0 };
  const facts = extractFacts('# Specific Model - 产品事实\n\n## 操作系统\n\nWindows 11\n\nLinux V20\n\n## 处理器\n\nUltra 7\n\n*仅限 Windows 版本产品搭载。\n\nUltra 5\n\n## 价格\n\n1999元', product, 'local', '2026-10-18');
  assert.equal(facts.length, 2);
  assert.equal(facts[0].sourceMode, 'local');
  assert.equal(facts[0].status, 'supported');
  assert.match(facts[1].statement, /Ultra 7（仅限 Windows 版本产品搭载。）；Ultra 5/);
  assert(facts[1].qualifiers.some(text => text.includes('仅限 Windows')));
  assert(facts.every(fact => !fact.statement.includes('1999')));
});

test('synthetic catalog keeps same-name models, images and product facts bound to their exact system', async () => {
  assert.deepEqual(await getLocalStats(), { available: true, productCount: 2, imageCount: 8 });
  const products = await listProducts();
  const harmony = products.find(product => product.name === SYNTHETIC_PRODUCT_NAME && product.system === SYNTHETIC_HARMONY_SYSTEM);
  const windows = products.find(product => product.name === SYNTHETIC_PRODUCT_NAME && product.system === SYNTHETIC_WINDOWS_SYSTEM);
  assert(harmony); assert(windows); assert.notEqual(harmony.id, windows.id); assert.equal(harmony.imageCount, 4);
  const evidence = await getEvidence(harmony.id, 'local');
  assert.equal(evidence.sourceMode, 'local');
  assert(evidence.facts.length >= 5 && evidence.facts.length <= 10);
  assert(evidence.facts.every(fact => fact.sourceMode === 'local' && fact.sourceTitle.includes(harmony.name)));
  assert(evidence.facts.some(fact => fact.statement.includes('1.2 kg')));
  assert(evidence.facts.every(fact => !fact.statement.includes('Windows')));
  assert(evidence.warnings.some(warning => warning.includes('未通过 ima')));
  assert(evidence.images.every(image => image.productId === harmony.id && image.sourceMode === 'local'));
  const otherEvidence = await getEvidence(windows.id, 'local');
  assert(otherEvidence.facts.some(fact => fact.statement.includes('1.6 kg')));
  assert(otherEvidence.facts.every(fact => !fact.statement.includes('HarmonyOS')));
  assert(evidence.images.every(image => !otherEvidence.images.some(other => other.id === image.id)));
  const first = evidence.images[0];
  assert.match(first.url, /^\/api\/assets\/[0-9a-f-]{36}$/);
  const asset = await getAsset(first.url.split('/').pop()!);
  assert(asset.data.length > 100); assert.match(asset.contentType, /^image\//);
  assert(!JSON.stringify(evidence).includes(process.cwd()));
});

test('missing local library returns metadata-only catalog while local evidence explicitly fails', async () => {
  const original = process.env.LOCAL_KB_ROOT;
  try {
    process.env.LOCAL_KB_ROOT = path.join(os.tmpdir(), 'missing-huawei-library-' + Date.now());
    const products = await listProducts();
    assert.equal(products.length, 10);
    assert(products.every(product => product.imageCount === 0 && !product.coverUrl));
    assert(products.every(product => product.description.includes('公开产品目录')));
    assert.equal(products.find(product => product.name === 'HUAWEI MateBook Pro S')?.id, 'pc-118b291c71a454a8');
    assert.deepEqual(await getLocalStats(), { available: false, productCount: 0, imageCount: 0 });
    await assert.rejects(() => getEvidence(products[0].id, 'local'), /本地知识库未安装/);
    await assert.rejects(() => getEvidence('../../secrets', 'local'), /未找到该产品/);
    await assert.rejects(() => getAsset('../../.env'), /图片不存在/);
    await assert.rejects(() => getAsset('00000000-0000-0000-0000-000000000000'), /图片不存在/);
  } finally { if (original === undefined) delete process.env.LOCAL_KB_ROOT; else process.env.LOCAL_KB_ROOT = original; }
});

test('image index cannot read outside the exact product folder or accept disguised files', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'huawei-evidence-test-'));
  const original = process.env.LOCAL_KB_ROOT;
  try {
    const productFolder = path.join(temp, 'P1-产品参数库', '01-鸿蒙电脑', 'Test Model');
    await fs.mkdir(path.join(productFolder, 'images'), { recursive: true });
    await fs.writeFile(path.join(productFolder, '产品事实.md'), '# Test Model - 产品事实\n\n## 操作系统\n\nHarmonyOS\n\n## 内存\n\n16 GB\n\n## 存储\n\n512 GB');
    await fs.writeFile(path.join(temp, 'outside.png'), Buffer.from([137,80,78,71,13,10,26,10]));
    await fs.writeFile(path.join(productFolder, 'images', 'fake.jpg'), '<html>login</html>');
    await fs.writeFile(path.join(productFolder, '图片索引.csv'), '文件名,产品型号,官网图片说明\n../../outside.png,Test Model,unsafe\nfake.jpg,Test Model,not image');
    process.env.LOCAL_KB_ROOT = temp;
    const products = await listProducts();
    assert.equal(products.length, 1); assert.equal(products[0].imageCount, 0);
    const evidence = await getEvidence(products[0].id, 'local');
    assert.deepEqual(evidence.images, []);
  } finally {
    if (original === undefined) delete process.env.LOCAL_KB_ROOT; else process.env.LOCAL_KB_ROOT = original;
    const resolved = path.resolve(temp);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('ima resolves a same-name import wrapper and duplicate model search results, without substituting local images', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ima-contract-test-'));
  const keys = ['IMA_SKILL_PATH', 'IMA_CLIENT_ID', 'IMA_API_KEY', 'IMA_KB_NAME', 'LOCAL_KB_ROOT'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const script = path.join(temp, 'mock-ima.cjs');
    const markdown = '# HUAWEI MateBook Pro S - 产品事实\n\n## 操作系统\n\nHarmonyOS 6.1\n\n## 内存\n\n16 GB\n\n## 存储\n\n512 GB';
    await fs.writeFile(script, `const [route,raw] = process.argv.slice(2); const body=JSON.parse(raw); if(process.argv.some(arg=>arg.includes(process.env.IMA_API_KEY)))process.exit(3); let data;
      if(route.endsWith('/search_knowledge_base'))data={info_list:[{kb_id:'internal-kb',kb_name:'contract-test-library'}],is_end:true};
      else if(route.endsWith('/get_knowledge_base'))data={infos:{'internal-kb':{id:'internal-kb',name:'contract-test-library'}}};
      else if(route.endsWith('/search_knowledge'))data={info_list:[{media_id:'internal-folder',title:'HUAWEI MateBook Pro S',media_type:99},{media_id:'internal-other-model-reference',title:'HUAWEI MateBook Pro S',media_type:99}],is_end:true};
      else if(route.endsWith('/get_knowledge_list')){
        const folders={
          root:[{media_id:'internal-wrapper',title:'contract-test-library',media_type:99}],
          'internal-wrapper':[{media_id:'internal-p1',title:'P1-产品参数库',media_type:99},{media_id:'internal-unrelated',title:'P4-价格政策库（机密）',media_type:99}],
          'internal-p1':[{media_id:'internal-harmony',title:'01-鸿蒙电脑',media_type:99}],
          'internal-harmony':[{media_id:'internal-folder',title:'HUAWEI MateBook Pro S',media_type:99}],
          'internal-folder':[{media_id:'internal-doc',title:'产品事实.md',media_type:7}]
        };if(!folders[body.folder_id||'root'])throw Error('Must not browse unrelated folders');data={knowledge_list:folders[body.folder_id||'root'],is_end:true};
      }
      else if(route.endsWith('/get_media_info'))data={media_type:11,notebook_ext_info:{notebook_id:'internal-note'}};
      else if(route.endsWith('/get_doc_content'))data={content:${JSON.stringify(markdown)}};
      else throw Error('Unexpected route'); process.stdout.write(JSON.stringify({code:0,data}));`);
    process.env.IMA_SKILL_PATH = script; process.env.IMA_CLIENT_ID = 'test-client'; process.env.IMA_API_KEY = 'test-key-do-not-log'; process.env.IMA_KB_NAME = 'contract-test-library';
    process.env.LOCAL_KB_ROOT = path.join(temp, 'missing-local-library');
    assert.deepEqual(await getLocalStats(), { available: false, productCount: 0, imageCount: 0 });
    const verified = await verifyIma(); assert.equal(verified.kbName, 'contract-test-library'); assert.equal(getImaStatus().verified, true);
    const product = (await listProducts()).find(product => product.name === 'HUAWEI MateBook Pro S')!;
    const evidence = await getEvidence(product.id, 'ima');
    assert.equal(evidence.sourceMode, 'ima'); assert.equal(evidence.images.length, 0);
    assert(evidence.facts.every(fact => fact.sourceMode === 'ima' && fact.quote.length > 0));
    assert(evidence.warnings.some(warning => warning.includes('没有用本地图片替代')));
    const output = JSON.stringify(evidence);
    assert(!output.includes('internal-')); assert(!output.includes(process.env.IMA_API_KEY)); assert(!output.includes(temp));
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    const resolved = path.resolve(temp); assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('ima stops on official skill updates and business errors, without reporting verified', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ima-failure-test-'));
  const keys = ['IMA_SKILL_PATH', 'IMA_CLIENT_ID', 'IMA_API_KEY', 'IMA_KB_NAME'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const script = path.join(temp, 'mock-ima.cjs');
    process.env.IMA_SKILL_PATH = script; process.env.IMA_CLIENT_ID = 'test-client'; process.env.IMA_API_KEY = 'private-test-key'; process.env.IMA_KB_NAME = 'failure-test-library';
    await fs.writeFile(script, `process.stderr.write(JSON.stringify({code:-200,msg:'update available'}));process.exit(1);`);
    await assert.rejects(() => verifyIma(), /有新版本/); assert.equal(getImaStatus().verified, false);
    await fs.writeFile(script, `process.stdout.write(JSON.stringify({code:110030,msg:'无权限 '+process.env.IMA_API_KEY}));`);
    await assert.rejects(() => verifyIma(), error => { assert(error instanceof Error); assert.match(error.message, /无权限/); assert(!error.message.includes('private-test-key')); return true; });
    assert.equal(getImaStatus().verified, false);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    const resolved = path.resolve(temp); assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('cancellation terminates an in-flight ima subprocess and never caches its unfinished evidence', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ima-cancel-test-'));
  const keys = ['IMA_SKILL_PATH', 'IMA_CLIENT_ID', 'IMA_API_KEY', 'IMA_KB_NAME', 'LOCAL_KB_ROOT'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const script = path.join(temp, 'mock-ima.cjs'); const marker = path.join(temp, 'note-started');
    const markdown = '# HUAWEI MateBook Pro S - 产品事实\n\n## 操作系统\n\nHarmonyOS 6.1\n\n## 内存\n\n24 GB\n\n## 存储\n\n512 GB';
    await fs.writeFile(script, `const fs=require('fs');const [route]=process.argv.slice(2);let data;
      if(route.endsWith('/search_knowledge_base'))data={info_list:[{id:'cancel-kb',name:'cancel-test-library'}],is_end:true};
      else if(route.endsWith('/get_knowledge_base'))data={infos:{}};
      else if(route.endsWith('/search_knowledge'))data={info_list:[{media_id:'cancel-folder',title:'HUAWEI MateBook Pro S'}],is_end:true};
      else if(route.endsWith('/get_knowledge_list'))data={knowledge_list:[{media_id:'cancel-doc',title:'产品事实.md'}],is_end:true};
      else if(route.endsWith('/get_media_info'))data={media_type:11,notebook_ext_info:{notebook_id:'cancel-note'}};
      else if(route.endsWith('/get_doc_content'))data={content:${JSON.stringify(markdown)}};
      const send=()=>process.stdout.write(JSON.stringify({code:0,data}));
      if(route.endsWith('/get_doc_content')&&!fs.existsSync(${JSON.stringify(marker)})){fs.writeFileSync(${JSON.stringify(marker)},'started');setTimeout(send,15000);}else send();`);
    process.env.IMA_SKILL_PATH = script; process.env.IMA_CLIENT_ID = 'cancel-client'; process.env.IMA_API_KEY = 'cancel-key'; process.env.IMA_KB_NAME = 'cancel-test-library';
    process.env.LOCAL_KB_ROOT = path.join(temp, 'missing-local-library');
    const product = (await listProducts()).find(product => product.name === 'HUAWEI MateBook Pro S')!;
    const controller = new AbortController();
    const operation = getEvidence(product.id, 'ima', controller.signal);
    const rejected = assert.rejects(operation, error => { assert.equal((error as Error).name, 'AbortError'); return true; });
    let started = false;
    for (let i = 0; i < 160; i++) { try { await fs.access(marker); started = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 25)); } }
    const abortedAt = Date.now(); controller.abort(); await rejected;
    assert(started, 'mock original-read subprocess should have started');
    assert(Date.now() - abortedAt < 1500, 'cancelling retrieval must not wait for the delayed subprocess response');
    const evidence = await getEvidence(product.id, 'ima');
    assert(evidence.facts.some(fact => fact.statement.includes('24 GB')), 'next attempt must actually read a complete new original');
    const alreadyAborted = new AbortController(); alreadyAborted.abort();
    await assert.rejects(() => getEvidence(product.id, 'ima', alreadyAborted.signal), { name: 'AbortError' });
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    const resolved = path.resolve(temp); assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(resolved, { recursive: true, force: true });
  }
});
