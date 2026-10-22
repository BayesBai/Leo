import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import satori, { type SatoriNode } from 'satori';
import sharp from 'sharp';
import type { Draft, RenderTemplate } from '../../shared/types.js';
import { WorkflowError } from '../outlines.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
export const fontFile = path.join(directory, 'fonts/NotoSansSC.ttf');
let fontPromise: Promise<Buffer> | undefined;
let boldFontPromise: Promise<Buffer> | undefined;
const font = () => fontPromise ||= readFile(fontFile);
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export interface RenderImage { id: string; uri: string; name: string; width: number; height: number }
export interface CardPage { heading: string; text: string; factIds: string[]; images: RenderImage[]; role: 'cover' | 'card' | 'poster'; kind?: 'cover' | 'checklist' | 'closing' }
export function assertEmbeddedImages(images: RenderImage[]) {
  if (images.some(image => !/^data:image\/png;base64,[a-zA-Z0-9+/]+={0,2}$/.test(image.uri))) throw new WorkflowError(422, '排版只接受已解析的嵌入式 PNG 产品图片。');
}
/** Fill only original template slots once; user text never becomes another template slot. */
export function fillXhsTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (slot, key: string) => {
    if (!Object.hasOwn(values, key)) throw new WorkflowError(500, '小红书模板不可用，请检查渲染模板。');
    return values[key];
  });
}
export function planXhs(draft: Draft, title: string, images: RenderImage[]): CardPage[] {
  const perPage = Math.ceil(draft.blocks.length / 4);
  const pages: CardPage[] = [{ heading: title, text: draft.intro, factIds: [], images: images.slice(0, 1), role: 'cover', kind: 'cover' }];
  for (let i = 0; i < draft.blocks.length; i += perPage) {
    const blocks = draft.blocks.slice(i, i + perPage);
    pages.push({ heading: blocks[0].heading || '选购参考', text: blocks.map((b, n) => (n && b.heading ? `${b.heading}\n` : '') + b.text).join('\n\n'), factIds: [...new Set(blocks.flatMap(b => b.factIds))], images: [], role: 'card', kind: 'checklist' });
  }
  images.slice(1).forEach((image, i) => pages[1 + i % (pages.length - 1)].images.push(image));
  pages.push({ heading: '你的清单，还差哪一项？', text: [draft.cta, draft.tags.map(t => `#${t.replace(/^#/, '')}`).join(' ')].filter(Boolean).join('\n\n'), factIds: [], images: [], role: 'card', kind: 'closing' });
  return pages;
}
export function planMoments(draft: Draft, title: string, images: RenderImage[]): CardPage[] {
  const count = Math.min(3, Math.max(1, images.length));
  const size = Math.ceil(draft.blocks.length / count);
  return Array.from({ length: count }, (_, i) => {
    const blocks = draft.blocks.slice(i * size, (i + 1) * size);
    return { heading: i === 0 ? title : blocks[0]?.heading || '欢迎到店交流',
      text: [i === 0 ? draft.intro : '', ...blocks.map(b => `${b.heading}\n${b.text}`), i === count - 1 ? draft.cta : '', i === count - 1 ? draft.tags.map(t => `#${t}`).join(' ') : ''].filter(Boolean).join('\n\n'),
      factIds: blocks.flatMap(b => b.factIds), images: images.slice(i, i + 1), role: 'card' };
  });
}
export async function renderSatori(page: CardPage, template: RenderTemplate, marker: string, product: string, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted(); assertEmbeddedImages(page.images);
  const data = await font();
  const bold = await (boldFontPromise ||= readFile(path.join(directory, 'fonts/NotoSansSC-Bold.ttf')));
  const poster = template.platform === 'poster';
  const dark = template.id.includes('ink');
  for (const size of [40, 34, 28, 24]) {
    signal?.throwIfAborted();
    const nodes: SatoriNode[] = [];
    const text = (value: string, extra = {}) => h('div', { style: { boxSizing: 'border-box', display: 'flex', flexShrink: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...extra } }, value);
    const svg = await satori(h('div', { style: { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', padding: poster ? 74 : 58, gap: poster ? 32 : 22,
      width: template.width, height: template.height, background: dark ? '#202d34' : '#f5f1e9', color: dark ? '#f8f5ef' : '#253731', fontFamily: 'Noto', fontSize: size, lineHeight: 1.5 } },
      text('知序  /  HUAWEI PC', { fontSize: 25, letterSpacing: 4, color: dark ? '#b8caba' : '#717d6c' }),
      text(page.heading, { fontSize: Math.min(poster ? 82 : 65, size * 1.8), lineHeight: 1.28, fontWeight: 700 }),
      text(product, { fontSize: 27, color: dark ? '#d7b898' : '#8b6345' }),
      ...page.images.map(image => h('div', { style: { boxSizing: 'border-box', display: 'flex', flexShrink: 0, justifyContent: 'center', borderRadius: 24, padding: 18, background: '#ffffff', height: poster ? 530 : template.height > 1080 ? 410 : 300 } },
        h('img', { src: image.uri, width: 860, height: poster ? 494 : template.height > 1080 ? 374 : 264, style: { objectFit: 'contain' } }))),
      text(page.text, { fontSize: size }),
      text(marker, { fontSize: 22, marginTop: 'auto', borderTop: `1px solid ${dark ? '#687770' : '#d2d8ce'}`, paddingTop: 18, color: dark ? '#bdc8bf' : '#747c72' }),
    ), { width: template.width, height: template.height, fonts: [{ name: 'Noto', data, weight: 400 }, { name: 'Noto', data: bold, weight: 700 }], onNodeDetected: node => nodes.push(node) });
    const overflow = nodes.filter(n => !(n.top >= -1 && n.left >= -1 && n.top + n.height <= template.height - 24 && n.left + n.width <= template.width + 1 || n.type === 'div' && n.width === template.width && n.height === template.height));
    if (process.env.RENDER_DEBUG === '1' && overflow.length) console.log('layout bounds', size, overflow.map(n => ({ type: n.type, x: n.left, y: n.top, w: n.width, h: n.height })));
    if (!overflow.length) {
      signal?.throwIfAborted(); const png = await sharp(Buffer.from(svg)).png().toBuffer(); signal?.throwIfAborted(); return png;
    }
  }
  throw new WorkflowError(422, '当前图版放不下完整文字。请在大纲中精简内容后重新确认，未截断任何事实或限定条件。');
}
/** Upstream MIT card frame; all dynamic content is escaped and all network requests are denied. */
export async function renderXhs(pages: CardPage[], template: RenderTemplate, marker: string, product: string, signal?: AbortSignal): Promise<Buffer[]> {
  signal?.throwIfAborted(); pages.forEach(page => assertEmbeddedImages(page.images));
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.cache/ms-playwright');
  const { chromium } = await import('playwright');
  let browser;
  // macOS headless-shell can lose its ICU bundle in GPU children; use official Chromium's new headless mode.
  try { browser = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { channel: 'chromium' } : {}) }); }
  catch { signal?.throwIfAborted(); throw new WorkflowError(503, '缺少 Chromium 渲染运行时，请先运行 npm run setup:render。'); }
  const abort = () => { void browser.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const base = await readFile(path.join(directory, 'vendor/xhs-poster.html'), 'utf8');
    const fontData = (await font()).toString('base64');
    const outputs: Buffer[] = [];
    for (let i = 0; i < pages.length; i++) {
      signal?.throwIfAborted();
      const card = pages[i];
      const kind = card.kind || (card.role === 'cover' ? 'cover' : 'checklist');
      const closing = kind === 'closing', cover = kind === 'cover';
      const page = await browser.newPage({ viewport: { width: 1080, height: 1440 }, deviceScaleFactor: 1 });
      await page.route('**/*', route => route.abort());
      let fit = false;
      for (const size of [36, 31, 26]) {
        let html = fillXhsTemplate(base, {
          BG_COLOR: closing ? '#173f4e' : cover ? template.id.includes('cream') ? '#ffe27a' : '#c8eedf' : '#fffef8', ACCENT_COLOR: '#e66749',
          HEADER_BLOCK: `<div class="header"><span class="running-title">知序 · ${cover ? '选机清单 / 先收藏' : closing ? '评论区见 / YOUR NEXT STEP' : `清单 ${String(i).padStart(2, '0')} / CHECKLIST`}</span></div>`,
          TITLE_BLOCK: `<div class="title-area"><h1>${escapeHtml(card.heading)}</h1></div>`,
          BODY_HTML: `<div class="page-kicker">${escapeHtml(product)}</div>${!cover ? `<p class="body-copy">${escapeHtml(card.text).replace(/\n/g, '<br>')}</p>` : ''}${card.images.length ? `<div class="products">${card.images.map(image => `<img src="${image.uri}" alt="${escapeHtml(image.name)}">`).join('')}</div>` : ''}${cover ? `<p class="body-copy">${escapeHtml(card.text).replace(/\n/g, '<br>')}</p>` : ''}`,
          AVATAR_URI: '', SOURCE: escapeHtml(marker), PAGE_INFO: `${String(i + 1).padStart(2, '0')} / ${String(pages.length).padStart(2, '0')}`,
        });
        html = html.replace('</style>', `@font-face{font-family:RenderNoto;src:url(data:font/ttf;base64,${fontData}) format('truetype')} :root{--font:RenderNoto,sans-serif} .avatar{display:none}.title-area h1{font-size:${i === 0 ? size * 2.15 : size * 1.6}px;overflow-wrap:anywhere}.content p{font-size:${size}px;line-height:1.65;overflow-wrap:anywhere;white-space:normal}.title-area{margin-bottom:28px}.content{flex-shrink:0;min-height:0;overflow:visible}.products{display:flex;gap:16px;flex-shrink:0;align-items:center;justify-content:center;margin-bottom:28px;padding:18px;background:white;border-radius:22px}.products img{width:${Math.floor(880 / Math.max(1, card.images.length))}px;height:${i === 0 ? 490 : 280}px;object-fit:contain}.footer{margin-top:24px}.author-name{font-size:20px}.body-copy{margin:0} </style>`);
        html = html.replace(/<img class="avatar"[^>]*>/g, '').replace('</style>', '.title-area h1{line-height:1.5;padding:2px 0 8px} </style>');
        const channelCss = `
          .card{padding:52px 64px 44px}.header{margin-bottom:28px}.running-title{color:${closing ? '#cce9dc' : '#364b41'}!important;font-weight:700!important;letter-spacing:.05em!important}
          .title-area{margin-bottom:24px}.title-area:after{width:${cover ? 160 : closing ? 90 : 48}px;height:${cover ? 10 : 5}px;border-radius:10px;background:${closing ? '#ffe27a' : '#e66749'}}
          .title-area h1{font-size:${cover ? size * 2.35 : closing ? size * 1.95 : size * 1.6}px;color:${closing ? '#fff8da' : '#192f2c'};line-height:1.3;letter-spacing:-.02em}
          .page-kicker{font-size:23px;line-height:1.5;margin-bottom:24px;color:${closing ? '#bcdacd' : '#687c6c'}}
          .body-copy{font-size:${size}px!important;line-height:1.6!important;color:${closing ? '#fffdf1' : '#243e34'}!important;background:${closing ? '#265466' : cover ? 'transparent' : '#f0f4e9'};padding:${cover ? 0 : 26}px;border-radius:${closing ? 30 : 10}px;${!cover && !closing ? 'border-left:7px solid #e66749;' : ''}}
          .products{margin:0 0 24px;padding:${cover ? 28 : 12}px;background:${cover ? '#fffdf0' : '#ffffff'};border-radius:${cover ? 48 : 20}px;${cover ? 'border:3px solid #233f34;' : ''}}
          .products img{height:${cover ? 450 : 210}px;width:${Math.floor(880 / Math.max(1, card.images.length)) - (cover ? 20 : 10)}px}
          .footer{border-top-color:${closing ? '#527581' : '#becbb9'};padding-top:20px}.author-name,.page-info{color:${closing ? '#bed9cf' : '#687d6e'}!important}
        `;
        html = html.replace('</style>', () => channelCss + '</style>');
        await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(image => image.decode())); });
        fit = await page.evaluate(() => {
          const card = document.querySelector('.card')!;
          const bounds = card.getBoundingClientRect(), padding = getComputedStyle(card);
          const content = document.querySelector('.content')!.getBoundingClientRect();
          const footer = document.querySelector('.footer')!.getBoundingClientRect();
          return content.bottom <= footer.top + 1 && footer.bottom <= bounds.bottom - parseFloat(padding.paddingBottom) + 1 && Array.from(document.querySelectorAll('.body-copy, h1, .products')).every(element => {
            const r = element.getBoundingClientRect();
            return r.left >= bounds.left + parseFloat(padding.paddingLeft) - 1 && r.right <= bounds.right - parseFloat(padding.paddingRight) + 1 && element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
          });
        });
        if (!fit && process.env.RENDER_DEBUG === '1') console.log('xhs bounds', size, await page.evaluate(() => Array.from(document.querySelectorAll('.content,.footer,.body-copy,h1,.products')).map(e => { const r = e.getBoundingClientRect(); return { class: e.className, y: r.y, bottom: r.bottom, right: r.right, scroll: e.scrollHeight, client: e.clientHeight }; })));
        if (fit) { outputs.push(await page.screenshot({ type: 'png' })); break; }
      }
      await page.close();
      if (!fit) throw new WorkflowError(422, `第 ${i + 1} 页文字超出小红书卡片容量。请精简对应大纲或增加段落后重新确认；内容未被截断。`);
    }
    signal?.throwIfAborted(); return outputs;
  } finally { signal?.removeEventListener('abort', abort); await browser.close().catch(() => {}); }
}
