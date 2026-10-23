import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Draft, RenderTemplate } from '../../shared/types.js';
import { WorkflowError } from '../outlines.js';
import { HTML_DESIGN_RULES, HTML_DESIGN_VERSION, htmlDesignMetadata } from '../design/html-rules.js';
import { assertEmbeddedImages, escapeHtml, fontFile, type CardPage, type RenderImage } from './layouts.js';
import { withRenderPage } from './browser-pool.js';

export interface HtmlRenderContext { background?: RenderImage; productName?: string }
export interface HtmlCardPage extends Omit<CardPage, 'kind'> { sections?: Array<{ heading: string; text: string }>; kind?: CardPage['kind'] | 'steps' | 'focus' | 'comparison' }
export interface HtmlPage { data: Buffer; html: string }
const text = (value: string) => escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>');
const fontFamily = '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';
let fontPromise: Promise<string> | undefined;
const embeddedFont = () => fontPromise ||= readFile(fontFile).then(data => data.toString('base64'));

/** Preserve entire approved blocks and their conditions. Never split at arbitrary characters. */
export function planHtmlXhs(draft: Draft, title: string, images: RenderImage[]): HtmlCardPage[] {
  assertEmbeddedImages(images);
  const blocks = draft.blocks.map(block => ({ heading: block.heading, text: block.text, factIds: block.factIds }));
  if (blocks.length < 2) throw new WorkflowError(422, '小红书需要封面和至少两组完整信息。请在大纲补充分组，未拆散事实与适用条件。');
  const groups: typeof blocks[] = [];
  const target = Math.min(5, blocks.length);
  let cursor = 0;
  for (let index = 0; index < target; index++) {
    const take = Math.ceil((blocks.length - cursor) / (target - index));
    groups.push(blocks.slice(cursor, cursor + take)); cursor += take;
  }
  if (groups.length > 5) throw new WorkflowError(422, '当前正文需要超过六页才能清晰呈现。请在大纲合并内容后重新确认，未截断正文或限定条件。');
  const pages: HtmlCardPage[] = [{ heading: title, text: draft.intro, factIds: [], images: images.slice(0, 1), role: 'cover', kind: 'cover' }];
  groups.forEach((group, index) => {
    const sections = group.map(block => ({ heading: block.heading, text: block.text }));
    const ending = index === groups.length - 1 ? [draft.cta, draft.tags.map(tag => `#${tag.replace(/^#/, '')}`).join(' ')].filter(Boolean).join('\n\n') : '';
    const kind = /对比|比较|区别|选择/.test(group[0].heading) && sections.length >= 2 ? 'comparison' : /步骤|准备|清单|先|再|最后|怎么/.test(group[0].heading) ? 'steps' : 'focus';
    pages.push({ heading: group[0].heading, text: [group.map((block, i) => `${i ? block.heading + '\n' : ''}${block.text}`).join('\n\n'), ending].filter(Boolean).join('\n\n'), sections: [...sections, ...(ending ? [{ heading: '', text: ending }] : [])], factIds: [...new Set(group.flatMap(block => block.factIds))], images: [], role: 'card', kind });
  });
  images.slice(1).forEach((image, index) => pages[1 + index % groups.length].images.push(image));
  // A repeat of an actual source image anchors the series without inventing a
  // filler illustration or charging for another generated visual.
  pages.slice(1).forEach((page, index) => { if (!page.images.length && images.length) page.images.push(images[(index + 1) % images.length]); });
  return pages;
}

function palette(template: RenderTemplate) {
  return /cream|warm/.test(template.id) ? { paper: '#f6efdf', ink: '#292f28', accent: '#a94e2f', soft: '#e9d8ba' } : { paper: '#e9efea', ink: '#193e37', accent: '#a65339', soft: '#c4d6c9' };
}
function imageMarkup(images: RenderImage[], className = 'product') { return images.map(image => `<img class="${className}" src="${image.uri}" alt="${escapeHtml(image.name)}">`).join(''); }
function pageHtml(card: HtmlCardPage, index: number, count: number, template: RenderTemplate, product: string, context: HtmlRenderContext, size: number) {
  const p = palette(template), cover = card.role === 'cover', kind = card.kind || 'focus';
  const sections = card.sections || [{ heading: '', text: card.text }];
  const background = context.background ? `<img class="environment" src="${context.background.uri}" alt="">` : '';
  const content = cover
    ? `<div class="cover-heading"><h1>${text(card.heading)}</h1></div><figure class="cover-visual">${background}${imageMarkup(card.images)}</figure><p class="intro">${text(card.text)}</p>`
    : `<div class="chapter"><span class="chapter-number">${String(index).padStart(2, '0')}</span><h1>${text(card.heading)}</h1></div><div class="sections ${kind}">${sections.map((section, i) => `<section class="copy-section"><span class="step-number">${String(i + 1).padStart(2, '0')}</span><div>${i && section.heading ? `<h2>${text(section.heading)}</h2>` : ''}<p>${text(section.text)}</p></div></section>`).join('')}</div>${card.images.length ? `<figure class="detail-visual">${imageMarkup(card.images)}</figure>` : ''}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><meta name="design-version" content="${HTML_DESIGN_VERSION}"><title>${escapeHtml(card.heading)}</title><style>
  *{box-sizing:border-box}html,body{margin:0;width:1080px;height:1440px}body{font-family:${fontFamily};color:${p.ink};background:${p.paper};-webkit-font-smoothing:antialiased}.canvas{position:relative;width:1080px;height:1440px;padding:64px;display:flex;flex-direction:column;isolation:isolate}.running{display:flex;align-items:center;justify-content:space-between;font-size:22px;line-height:1.5;letter-spacing:.04em;padding-bottom:26px;border-bottom:1px solid ${p.ink}44;color:${p.ink}}.running-product{max-width:820px;overflow-wrap:anywhere}.series-mark{width:24px;height:24px;flex-shrink:0;border:5px solid ${p.accent};border-radius:50%}.main{display:flex;flex-direction:column;gap:30px;flex:1;min-height:0;padding:32px 0 28px}.cover-heading h1{font-size:${Math.max(66, size * 2.2)}px;line-height:1.5;letter-spacing:-.035em;margin:0;font-weight:700}.cover-heading{max-width:910px}.cover-visual{position:relative;display:flex;justify-content:center;align-items:center;min-height:360px;height:480px;flex-shrink:0;isolation:isolate;background:${p.soft};border-radius:180px 180px 24px 24px;padding:22px;margin:0}.environment{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;border-radius:inherit;opacity:.42}.product{object-fit:contain;max-width:100%;width:100%;height:100%;min-width:0;position:relative}.intro{font-size:${size}px;line-height:1.65;margin:0;white-space:normal}.chapter{display:flex;gap:26px;align-items:flex-start}.chapter-number{font-size:100px;line-height:1.5;font-weight:700;letter-spacing:-.08em;color:${p.accent};flex-shrink:0}.chapter h1{margin:0;font-size:${Math.max(42, size * 1.5)}px;line-height:1.5;letter-spacing:-.025em}.sections{display:flex;flex-direction:column;gap:26px}.copy-section{display:flex;gap:22px}.copy-section h2{font-size:${size * 1.12}px;line-height:1.45;margin:0 0 14px}.copy-section p{font-size:${size}px;line-height:1.7;margin:0;overflow-wrap:anywhere}.step-number{display:none;font-size:22px;line-height:1.6;color:${p.accent};border:1px solid ${p.accent};width:46px;height:46px;border-radius:50%;align-items:center;justify-content:center;flex-shrink:0}.steps .step-number{display:flex}.focus .copy-section:first-child{border-left:5px solid ${p.accent};padding-left:28px}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:22px}.comparison .copy-section{padding:28px;background:${p.soft};border-radius:8px}.comparison .copy-section:last-child:nth-child(odd){grid-column:1/-1}.detail-visual{display:flex;justify-content:center;align-items:center;gap:22px;min-height:240px;height:290px;flex-shrink:0;margin:0;margin-top:auto;padding:16px;background:#fffdf8;border-radius:10px}.detail-visual .product{max-width:${100 / Math.max(card.images.length, 1)}%}.folio{display:flex;justify-content:space-between;font-size:22px;line-height:1.5;border-top:1px solid ${p.ink}44;padding-top:18px;color:${p.ink}bb}.folio-line{width:120px;height:5px;margin-top:12px;background:${p.accent}}h1,h2,p{overflow-wrap:anywhere}
  </style></head><body><article class="canvas" data-layout="${escapeHtml(kind)}"><header class="running"><span class="running-product">${text(product)}</span><span class="series-mark"></span></header><main class="main">${content}</main><footer class="folio"><span class="folio-line"></span><span>${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}</span></footer></article></body></html>`;
}

export async function renderXhsWithSource(pages: HtmlCardPage[], template: RenderTemplate, product: string, signal?: AbortSignal, context: HtmlRenderContext = {}) {
  signal?.throwIfAborted(); pages.forEach(page => assertEmbeddedImages(page.images)); if (context.background) assertEmbeddedImages([context.background]);
  if (pages.length < 3 || pages.length > 6) throw new WorkflowError(422, '小红书图文应为封面加信息内页，共三至六页。');
  const owner = `html-xhs-${randomUUID()}`, fontData = await embeddedFont();
  const operations = pages.map((card, index) => withRenderPage(owner, HTML_DESIGN_RULES.page, signal, async page => {
    for (const size of [38, 35, HTML_DESIGN_RULES.page.minBodyPx]) {
      const html = pageHtml(card, index, pages.length, template, product, context, size);
      await page.setContent(html.replace('</style>', () => `@font-face{font-family:"Noto Sans SC";font-weight:100 900;src:url(data:font/ttf;base64,${fontData})}</style>`), { waitUntil: 'load', timeout: 20_000 });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(image => image.decode())); });
      const fits = await page.evaluate(() => {
        const main = document.querySelector('.main')!.getBoundingClientRect(), footer = document.querySelector('.folio')!.getBoundingClientRect();
        const children = Array.from(document.querySelector('.main')!.children).map(element => element.getBoundingClientRect());
        const separated = children.every((bounds, i) => !i || children[i - 1].bottom <= bounds.top + 1);
        return separated && Array.from(document.querySelectorAll('.main > *, .copy-section, h1, h2, p, .running-product')).every(element => {
          const bounds = element.getBoundingClientRect();
          return bounds.left >= 63 && bounds.right <= 1017 && bounds.bottom <= footer.top - 10 && element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1 && (element.closest('.running') || bounds.top >= main.top - 1);
        });
      });
      if (!fits && process.env.RENDER_DEBUG === '1') console.log('html layout bounds', index, size, await page.evaluate(() => Array.from(document.querySelectorAll('.main > *, .copy-section, h1, h2, p, .running-product')).map(element => { const r = element.getBoundingClientRect(); return { class: element.className || element.tagName, top:r.top, bottom:r.bottom, left:r.left, right:r.right, scroll:element.scrollHeight, client:element.clientHeight }; })));
      if (fits) return { data: await page.screenshot({ type: 'png' }), html };
    }
    throw new WorkflowError(422, `第 ${index + 1} 页无法在最小 ${HTML_DESIGN_RULES.page.minBodyPx}px 可读字号内完整呈现。请调整大纲分组；正文及适用条件未被截断。`);
  }));
  const results = await Promise.allSettled(operations);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
  return { pages: results.map(result => (result as PromiseFulfilledResult<HtmlPage>).value), design: { ...htmlDesignMetadata('xiaohongshu', template.id), productName: product, pageRoles: pages.map(page => page.kind || 'focus'), exactCopy: pages.map(page => ({ heading: page.heading, text: page.text })), backgroundId: context.background?.id } };
}

/** A real editable HTML composition; product pixels are never regenerated. */
export async function renderHtmlWechatCover(title: string, product: string, images: RenderImage[], template: RenderTemplate, signal?: AbortSignal, context: HtmlRenderContext = {}): Promise<HtmlPage> {
  signal?.throwIfAborted(); assertEmbeddedImages(images); if (context.background) assertEmbeddedImages([context.background]);
  const p = palette(template), fontData = await embeddedFont();
  return withRenderPage(`html-wechat-${randomUUID()}`, { width: 1200, height: 510 }, signal, async page => {
    for (const size of [54, 48, 42]) {
      const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box}body{margin:0;width:1200px;height:510px;background:${p.paper};color:${p.ink};font-family:${fontFamily}}main{width:1200px;height:510px;padding:48px 60px;display:grid;grid-template-columns:1.06fr 1fr;gap:32px;align-items:center}.copy{position:relative;z-index:1}h1{font-size:${size}px;line-height:1.35;letter-spacing:-.025em;margin:24px 0 0;overflow-wrap:anywhere}p{font-size:23px;line-height:1.6;margin:0;color:${p.accent};overflow-wrap:anywhere}figure{margin:0;height:390px;position:relative;display:flex;align-items:center;isolation:isolate;border-radius:180px 180px 18px 18px;background:${p.soft};padding:20px}.environment{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;opacity:.4;z-index:-1}.product{width:100%;height:100%;object-fit:contain}</style><body><main><section class="copy"><p>${text(product)}</p><h1>${text(title)}</h1></section><figure>${context.background ? `<img class="environment" src="${context.background.uri}" alt="">` : ''}${imageMarkup(images.slice(0, 1))}</figure></main></body></html>`;
      await page.setContent(html.replace('</style>', () => `@font-face{font-family:"Noto Sans SC";src:url(data:font/ttf;base64,${fontData})}</style>`), { waitUntil: 'load' });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(image => image.decode())); });
      if (await page.evaluate(() => Array.from(document.querySelectorAll('.copy,h1,p')).every(element => { const r = element.getBoundingClientRect(); return r.top >= 47 && r.bottom <= 463 && r.left >= 59 && r.right < 630 && element.scrollWidth <= element.clientWidth + 1; }))) return { data: await page.screenshot({ type: 'png' }), html };
    }
    throw new WorkflowError(422, '公众号封面标题过长，无法在可读字号内呈现。请在大纲中调整标题，未截断标题。');
  });
}
