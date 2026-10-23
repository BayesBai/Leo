import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Draft } from '../shared/types.js';
import { planHtmlXhs, renderXhsWithSource, renderHtmlWechatCover } from '../server/render/html-design.js';
import { renderWechatArticleWithSource } from '../server/render/wechat.js';
import { closeRenderRuntime, renderRuntimeStats, withRenderPage } from '../server/render/browser-pool.js';
import { HTML_SKILL_HASHES } from '../server/design/html-rules.js';
const template = { id:'xhs-sage',platform:'xiaohongshu' as const,name:'模拟系列',width:1080,height:1440 };
const draft:Draft={id:'html-test',platform:'xiaohongshu',titles:['上课、通勤和整理资料，选电脑先看这两件事'],intro:'把日常需求带到店里，在真实任务中逐项确认。',blocks:[{id:'one',heading:'先核对自己的软件',text:'带上常用的软件清单，请店员协助核对适配情况。配置可能因销售版本而异，以实际销售版本为准。',factIds:['fact-one']},{id:'two',heading:'带着资料看屏幕',text:'打开自己常用的课件和表格，观察文字与图表是否便于阅读。请按个人使用习惯体验后再决定。',factIds:[]}],cta:'到店带上清单，一起逐项确认。',tags:['选购清单'],images:[{imageId:'original',afterBlock:0,caption:'同型号产品正面图',reason:'真实素材'}]};
const normalized=(value:string)=>value.replace(/\s+/g,'');

test('pinned HTML skill sources retain verified bytes and licenses',async()=>{
 assert.equal(Object.keys(HTML_SKILL_HASHES).filter(name=>name.endsWith('LICENSE')).length,4);
 for(const [name,hash]of Object.entries(HTML_SKILL_HASHES))assert.equal(createHash('sha256').update(await readFile(new URL('../server/design/vendor/'+name,import.meta.url))).digest('hex'),hash);
});

test('WeChat magazine/checklist output keeps all copy as safe inline HTML and original image proportions',async()=>{
 const image={id:'original',uri:`data:image/png;base64,${(await sharp({create:{width:640,height:360,channels:3,background:'#dce6dd'}}).png().toBuffer()).toString('base64')}`,name:'真实原图',width:640,height:360};
 const source={...draft,platform:'wechat' as const,intro:'导语 <script>无脚本</script> $& {{BODY_HTML}}'};
 for(const id of ['wechat-editorial','wechat-warm']){
  const result=await renderWechatArticleWithSource(source,source.titles[0],[image],{id,platform:'wechat',name:'模拟',width:1200,height:510},undefined,{productName:'模拟型号'});
  const dom=new JSDOM(result.html);
  try{
   assert.equal(dom.window.document.querySelectorAll('script,style,iframe,a').length,0);
   assert.ok(Array.from(dom.window.document.querySelectorAll('p,h1,h2,section,img')).every(element=>element.hasAttribute('style')));
   for(const value of [source.intro,source.cta,...source.blocks.flatMap(block=>[block.heading,block.text])])assert.ok(normalized(dom.window.document.body.textContent!).includes(normalized(value)));
   assert.equal(dom.window.document.images[0].src,image.uri);assert.match(dom.window.document.images[0].getAttribute('style')!,/height:auto/);
   assert.doesNotMatch(result.html,/审核中|发布前复核|检查通过|本地资料/);
   assert.equal(result.design.layout,id==='wechat-warm'?'checklist':'magazine');
  }finally{dom.window.close();}
 }
});

test('HTML XHS page grouping retains entire condition blocks and refuses invented split pages',()=>{
 const pages=planHtmlXhs(draft,draft.titles[0],[]);assert.equal(pages.length,3);
 assert.deepEqual(pages.map(page=>page.kind),['cover','steps','focus']);
 assert.ok(pages[1].text.includes(draft.blocks[0].text));assert.deepEqual(pages[1].factIds,['fact-one']);
 assert.throws(()=>planHtmlXhs({...draft,blocks:[draft.blocks[0]]},draft.titles[0],[]),/至少两组/);
});

test('HTML produces actual XHS pages and a wide cover, returns editable clean source, rejects unreadable overflow',async()=>{
 const image={id:'original',uri:`data:image/png;base64,${(await sharp({create:{width:960,height:540,channels:3,background:'#e5ddca'}}).png().toBuffer()).toString('base64')}`,name:'模拟同型号原图',width:960,height:540};
 try{
  const plan=planHtmlXhs(draft,draft.titles[0],[image]);
  const result=await renderXhsWithSource(plan,template,'模拟产品',undefined,{background:{...image,id:'background'}});
  assert.equal(result.pages.length,3);
  for(const output of result.pages){const metadata=await sharp(output.data).metadata();assert.equal(metadata.width,1080);assert.equal(metadata.height,1440);assert.doesNotMatch(output.html,/审核中|发布前复核|检查通过|本地资料|https?:\/\//);}
  assert.ok(result.pages[1].html.includes('配置可能因销售版本而异'));
  const cover=await renderHtmlWechatCover('先看日常需求，再选适合的电脑','模拟型号',[image],{id:'wechat-editorial',platform:'wechat',name:'模拟',width:1200,height:510});
  const metadata=await sharp(cover.data).metadata();assert.equal(metadata.width,1200);assert.equal(metadata.height,510);
  const long=plan.map((page,index)=>index===1?{...page,text:'完整适用条件。'.repeat(1000),sections:[{heading:'必须完整保留',text:'完整适用条件。'.repeat(1000)}]}:page);
  await assert.rejects(renderXhsWithSource(long,template,'模拟产品'),/最小 32px/);
 }finally{await closeRenderRuntime();}
});

test('shared page pool bounds mixed media work, cancellation releases only its own slot',async()=>{
 const controller=new AbortController();let peak=0,active=0;let release!:()=>void;
 const barrier=new Promise<void>(resolve=>release=resolve);
 const first=withRenderPage('video',{width:1080,height:1920},controller.signal,async()=>{active++;peak=Math.max(peak,active);try{await barrier;}finally{active--;}});
 const rejected=assert.rejects(first);
 const staticRender=withRenderPage('static',{width:1080,height:1440},undefined,async page=>{active++;peak=Math.max(peak,active);await page.setContent('<p>模拟</p>');assert.equal(await page.locator('p').textContent(),'模拟');active--;});
 await staticRender;controller.abort();release();await rejected;assert.ok(peak<=2);assert.ok(renderRuntimeStats().peakPages<=2);await closeRenderRuntime();
});
