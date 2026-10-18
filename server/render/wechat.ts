import { randomUUID } from 'node:crypto';
import { createWenyanCore } from '@wenyan-md/core';
import { JSDOM } from 'jsdom';
import type { Draft, RenderTemplate } from '../../shared/types.js';
import { WorkflowError } from '../outlines.js';
import { assertEmbeddedImages, escapeHtml, type RenderImage } from './layouts.js';

/** Wenyan only sees generated placeholders; all user text and image bytes are inserted afterwards. */
export async function renderWechatArticle(draft: Draft, title: string, images: RenderImage[], template: RenderTemplate, marker: string, signal?: AbortSignal) {
  signal?.throwIfAborted(); assertEmbeddedImages(images);
  const inputText = JSON.stringify({ draft, title, marker, imageNames: images.map(image => image.name) });
  let nonce: string;
  do { nonce = randomUUID().replaceAll('-', ''); } while (inputText.includes(nonce));
  const replacements: { token: string; html: string }[] = [];
  const placeholder = (html: string) => {
    const token = `WENYANCONTENT${nonce}INDEX${replacements.length}END`;
    replacements.push({ token, html }); return token;
  };
  // Markdown escaping is insufficient for HTML block parsing in some upstream paths.
  // Encode literal text only after Markdown/style processing so no input becomes markup,
  // a Mermaid diagram, a front-matter document, or an automatically generated hyperlink.
  const text = (value: string) => placeholder(escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>'));
  const lines = [`# ${text(title)}`, '', `> ${text(marker)}`, '', text(draft.intro), ''];
  const appendImage = (image: RenderImage, caption: string) => {
    const token = placeholder(`<img src="${image.uri}" alt="${escapeHtml(image.name)}" style="display:block;max-width:100%;height:auto;border-radius:8px;margin:20px auto;object-fit:contain">`);
    lines.push(token, '', text(caption), '');
  };
  const appendImages = (index: number) => draft.images.filter(p => p.afterBlock === index).forEach(p => appendImage(images.find(i => i.id === p.imageId)!, p.caption));
  appendImages(-1);
  draft.blocks.forEach((block, index) => { lines.push(`## ${text(block.heading)}`, '', text(block.text), ''); appendImages(index); });
  for (const p of draft.images.filter(p => p.afterBlock >= draft.blocks.length)) appendImage(images.find(i => i.id === p.imageId)!, p.caption);
  lines.push(text(draft.cta), '', text(draft.tags.map(t => `#${t}`).join(' ')));
  const css = `#wenyan{font-family:Arial,sans-serif;color:#283a35;font-size:16px;line-height:1.9;padding:16px}#wenyan h1{font-size:27px;line-height:1.5;margin:18px 0;color:${template.id.includes('warm') ? '#9c6240' : '#274e43'}}#wenyan h2{font-size:21px;border-left:4px solid #aa6b4b;padding-left:12px;margin:28px 0 16px}#wenyan p{margin:18px 0}#wenyan img{max-width:100%;height:auto;border-radius:8px}#wenyan blockquote{color:#7c7566;border-left:3px solid #d0c3aa;padding:8px 12px}`;
  const core = await createWenyanCore({ isWechat: true, mermaid: false, isConvertMathJax: false });
  signal?.throwIfAborted();
  // Use the public core API with an inert DOM. The Node publishing wrapper also installs
  // optional Mermaid globals and account configuration, which this renderer does not need.
  const rendered = await core.renderMarkdown(lines.join('\n'));
  const dom = new JSDOM(`<body><section id="wenyan">${rendered}</section></body>`);
  let html: string;
  try { html = await core.applyStylesWithTheme(dom.window.document.getElementById('wenyan')!, { themeCss: css, hlThemeCss: '', isAddFootnote: false, isMacStyle: false }); }
  finally { dom.window.close(); }
  signal?.throwIfAborted();
  for (const replacement of replacements) {
    if (html.split(replacement.token).length !== 2) throw new WorkflowError(500, '公众号配图排版失败，正文已保留，请重新排版。');
    // A callback preserves literal $&, $`, and $' in image metadata.
    html = html.replace(replacement.token, () => replacement.html);
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="margin:0;background:white">${html}</body></html>`;
}
