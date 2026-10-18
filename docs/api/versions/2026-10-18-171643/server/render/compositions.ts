import { readFile } from 'node:fs/promises';
import { createElement as h } from 'react';
import satori, { type SatoriNode } from 'satori';
import sharp from 'sharp';
import type { Draft, RenderTemplate } from '../../shared/types.js';
import { WorkflowError } from '../outlines.js';
import { assertEmbeddedImages, type RenderImage } from './layouts.js';

let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 700 }[]> | undefined;
const loadFonts = () => fonts ||= Promise.all(([400, 700] as const).map(async weight => ({ name: 'Noto', weight, data: await readFile(new URL(`./fonts/NotoSansSC${weight === 700 ? '-Bold' : ''}.ttf`, import.meta.url)) })));
type Style = Record<string, string | number>;
const box = (style: Style, ...children: any[]) => h('div', { style: { boxSizing: 'border-box', display: 'flex', flexDirection: 'column', flexShrink: 0, ...style } }, ...children);
const text = (value: string, style: Style = {}) => box({ whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...style }, value);
const picture = (image: RenderImage, width: number, height: number) => h('img', { src: image.uri, width, height, style: { objectFit: 'contain' } });

async function rasterize(template: RenderTemplate, build: (size: number) => ReturnType<typeof h>, sizes: number[], signal?: AbortSignal) {
  const fontData = await loadFonts();
  for (const size of sizes) {
    signal?.throwIfAborted(); const nodes: SatoriNode[] = [];
    const svg = await satori(build(size), { width: template.width, height: template.height, fonts: fontData, onNodeDetected: n => nodes.push(n) });
    const overflow = nodes.filter(n => !(n.top >= -1 && n.left >= -1 && n.top + n.height <= template.height - 16 && n.left + n.width <= template.width + 1 || n.type === 'div' && n.width === template.width && n.height === template.height));
    if (!overflow.length) { signal?.throwIfAborted(); const data = await sharp(Buffer.from(svg)).png().toBuffer(); signal?.throwIfAborted(); return data; }
    if (process.env.RENDER_DEBUG === '1') console.log('channel composition bounds', template.id, size, overflow.slice(0, 4).map(n => ({ top: n.top, bottom: n.top + n.height, right: n.left + n.width })));
  }
  throw new WorkflowError(422, '当前渠道版式放不下完整文字，请精简大纲或更换模板。未截断任何正文或必要条件。');
}

/** Store poster: campaign heading, product stage, individually laid out selling points and action strip. */
export async function renderStorePoster(draft: Draft, title: string, images: RenderImage[], template: RenderTemplate, marker: string, product: string, signal?: AbortSignal) {
  signal?.throwIfAborted(); assertEmbeddedImages(images);
  const ink = template.id.includes('ink'), bg = ink ? '#162d43' : '#fff4e0', fg = ink ? '#ffffff' : '#182f43', accent = ink ? '#ffdc85' : '#9e452f';
  return rasterize(template, size => box({ width: template.width, height: template.height, padding: 56, gap: 24, fontFamily: 'Noto', fontSize: size, lineHeight: 1.48, background: bg, color: fg },
    box({ flexDirection: 'row', justifyContent: 'space-between', fontSize: 22, letterSpacing: 3, color: accent }, text('知序 · 门店提案'), text('STORE EDITION')),
    text(title, { fontSize: Math.min(88, size * 2.4), fontWeight: 700, lineHeight: 1.2, marginTop: 12 }),
    text(draft.intro, { fontSize: Math.max(25, size), color: accent }),
    text(product, { fontSize: 27 }),
    box({ height: 540, background: '#ffffff', borderRadius: ink ? 40 : 0, alignItems: 'center', justifyContent: 'center', padding: 20 }, ...images.map(image => picture(image, 900, 500))),
    ...draft.blocks.map((block, index) => box({ padding: 24, gap: 12, borderLeft: `5px solid ${accent}`, background: ink ? '#203e58' : '#ffffff' },
      box({ flexDirection: 'row', gap: 15, alignItems: 'center' }, text(String(index + 1).padStart(2, '0'), { fontSize: 21, color: accent }), text(block.heading, { fontSize: size + 2, fontWeight: 700 })),
      text(block.text, { fontSize: size }))),
    text(draft.cta, { marginTop: 'auto', background: accent, color: ink ? '#172b3e' : '#ffffff', padding: 24, fontSize: size + 2, fontWeight: 700 }),
    ...(draft.tags.length ? [text(draft.tags.map(t => `#${t}`).join(' '), { fontSize: 20 })] : []),
    text(marker, { fontSize: 20, color: ink ? '#b3c7d8' : '#6e6d67' })), [36, 32, 28, 24, 21], signal);
}

/** Moments: a store conversation and photo collage; the complete copy is also exported separately. */
export async function renderMomentsCard(draft: Draft, title: string, images: RenderImage[], template: RenderTemplate, marker: string, product: string, signal?: AbortSignal) {
  signal?.throwIfAborted(); assertEmbeddedImages(images);
  const tall = template.height > 1080;
  const photoWidth = Math.floor((988 - (images.length - 1) * 12) / Math.max(1, images.length));
  return rasterize(template, size => box({ width: template.width, height: template.height, background: '#f0f6f3', padding: 46, gap: 20, color: '#203e35', fontFamily: 'Noto', lineHeight: 1.5 },
    box({ flexDirection: 'row', gap: 16, alignItems: 'center' }, text('知', { width: 54, height: 54, background: '#2d6b53', color: 'white', alignItems: 'center', justifyContent: 'center', fontSize: 30, borderRadius: 12 }),
      box({ gap: 3 }, text('知序 · 门店日常', { fontSize: 25, fontWeight: 700 }), text(product, { fontSize: 20, color: '#647d72' }))),
    text(title, { fontSize: size * 1.5, fontWeight: 700 }),
    text(draft.intro, { fontSize: size }),
    box({ flexDirection: 'row', gap: 12, height: tall ? 380 : 290 }, ...images.map(image => box({ width: photoWidth, height: tall ? 380 : 290, background: '#ffffff', borderRadius: 18, alignItems: 'center', justifyContent: 'center', padding: 10 }, picture(image, photoWidth - 20, tall ? 350 : 260)))),
    ...draft.blocks.map(block => box({ background: '#ffffff', padding: 22, borderRadius: 20, gap: 10 }, text(block.heading, { fontSize: Math.max(21, size - 3), fontWeight: 700, color: '#38745c' }), text(block.text, { fontSize: size }))),
    text(draft.cta, { padding: 18, borderLeft: '4px solid #5c967a', fontSize: size, color: '#3e6654' }),
    ...(draft.tags.length ? [text(draft.tags.map(t => `#${t}`).join(' '), { fontSize: 20 })] : []),
    text(marker, { marginTop: 'auto', fontSize: 18, color: '#778c82' })), [32, 28, 24, 21, 18], signal);
}

/** Editorial cover: asymmetric two-column journal composition, unrelated to the poster/feed trees. */
export async function renderEditorialCover(title: string, images: RenderImage[], template: RenderTemplate, marker: string, product: string, signal?: AbortSignal) {
  signal?.throwIfAborted(); assertEmbeddedImages(images);
  return rasterize(template, size => box({ width: template.width, height: template.height, padding: 58, background: '#fbf8f0', color: '#28373f', fontFamily: 'Noto', gap: 36 },
    box({ flexDirection: 'row', justifyContent: 'space-between', borderBottom: '2px solid #28373f', paddingBottom: 20, fontSize: 23, letterSpacing: 3 }, text('知序 / 选购观察'), text('PC JOURNAL')),
    box({ flexDirection: 'row', gap: 34, alignItems: 'center', height: 530 },
      box({ width: 500, gap: 28, borderLeft: '8px solid #c76b44', paddingLeft: 28 }, text('从问题开始，而后选择', { fontSize: 22, color: '#a05d40' }), text(title, { fontSize: size, lineHeight: 1.35, fontWeight: 700 }), text(product, { fontSize: 24, color: '#6c7a7a' })),
      box({ width: 550, height: 490, background: '#e8edeb', alignItems: 'center', justifyContent: 'center' }, ...images.slice(0, 1).map(image => picture(image, 520, 450)))),
    text(marker, { fontSize: 20, color: '#7a817c', marginTop: 'auto' })), [58, 50, 43, 36], signal);
}
