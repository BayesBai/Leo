import { createElement as h } from 'react';
import { readFile } from 'node:fs/promises';
import satori from 'satori';
import sharp from 'sharp';
import { fontFile } from './layouts.js';

let watermarkFont: Promise<Buffer> | undefined;
/** The public preview contains a visible mark in its bytes, independent of UI controls. */
export async function markPreview(data: Buffer, format: 'png' | 'wechat-richtext', label: string): Promise<Buffer> {
  if (format === 'wechat-richtext') {
    const overlay = `<div aria-label="${label}" style="position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;justify-content:center;color:rgba(95,54,40,.55);font-size:32px;font-weight:700;transform:rotate(-18deg);background:rgba(255,255,255,.10)">${label}</div>`;
    const html = data.toString('utf8');
    return Buffer.from(html.includes('</body>') ? html.replace('</body>', () => overlay + '</body>') : html + overlay);
  }
  const metadata = await sharp(data).metadata();
  const width = metadata.width!, height = metadata.height!;
  const font = await (watermarkFont ||= readFile(fontFile));
  const svg = await satori(h('div', { style: { width, height, position: 'relative', display: 'flex', background: 'rgba(255,255,255,.08)' } },
    ...[.22, .49, .76].map(fraction => h('div', { style: { position: 'absolute', top: height * fraction, left: width * .07, width: width * .86,
      display: 'flex', justifyContent: 'center', padding: 12, transform: 'rotate(-18deg)', background: 'rgba(255,255,255,.62)',
      color: 'rgba(94,52,38,.68)', fontSize: Math.max(24, width / 25), fontFamily: 'PreviewNoto', fontWeight: 700 } }, label))),
    { width, height, fonts: [{ name: 'PreviewNoto', data: font, weight: 700 }] });
  return sharp(data).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}
