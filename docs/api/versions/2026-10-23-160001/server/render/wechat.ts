import { randomUUID } from 'node:crypto';
import { createWenyanCore } from '@wenyan-md/core';
import { JSDOM } from 'jsdom';
import type { Draft, RenderTemplate } from '../../shared/types.js';
import { WorkflowError } from '../outlines.js';
import { assertEmbeddedImages, escapeHtml, type RenderImage } from './layouts.js';
import { htmlDesignMetadata, HTML_DESIGN_RULES } from '../design/html-rules.js';
import type { HtmlRenderContext } from './html-design.js';

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
  const lines = [`# ${text(title)}`, '', text(draft.intro), ''];
  const appendImage = (image: RenderImage, caption: string) => {
    const token = placeholder(`<img src="${image.uri}" alt="${escapeHtml(image.name)}" style="display:block;max-width:100%;height:auto;border-radius:8px;margin:20px auto;object-fit:contain">`);
    lines.push(token, '', text(caption), '');
  };
  const appendImages = (index: number) => draft.images.filter(p => p.afterBlock === index).forEach(p => appendImage(images.find(i => i.id === p.imageId)!, p.caption));
  appendImages(-1);
  draft.blocks.forEach((block, index) => { lines.push(`## ${text(block.heading)}`, '', text(block.text), ''); appendImages(index); });
  for (const p of draft.images.filter(p => p.afterBlock >= draft.blocks.length)) appendImage(images.find(i => i.id === p.imageId)!, p.caption);
  lines.push(text(draft.cta), '', text(draft.tags.map(t => `#${t}`).join(' ')));
  const warm = template.id.includes('warm');
  const css = `#wenyan{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;color:#293b43;font-size:17px;line-height:1.9;padding:28px 20px;background:${warm ? '#fffcf5' : '#ffffff'}}#wenyan h1{font-size:28px;line-height:1.45;margin:22px 0 28px;color:#233843;border-bottom:3px solid ${warm ? '#b87946' : '#496c7b'};padding-bottom:22px}#wenyan h2{font-size:22px;line-height:1.6;${warm ? 'background:#f7eddd;padding:15px 18px;border-radius:6px;' : 'border-top:1px solid #bdcdd2;padding-top:22px;'}margin:38px 0 20px;color:${warm ? '#8b522e' : '#284e60'}}#wenyan p{margin:20px 0}#wenyan img{max-width:100%;height:auto;border-radius:2px}#wenyan blockquote{color:#6c7a7e;border-left:3px solid ${warm ? '#c19c71' : '#92acb9'};padding:10px 16px;font-size:14px;background:${warm ? '#f6efe4' : '#f1f5f6'}}`;
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
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="margin:0;background:#eef2f3"><section style="max-width:680px;margin:0 auto;background:white">${html}</section></body></html>`;
}

/** Professional HTML source, kept separate from the legacy Wenyan output contract.
 * All commercial copy is escaped literal text. Every visual style is inline so
 * stripping scripts, classes and stylesheets does not flatten the article.
 */
export async function renderWechatArticleWithSource(draft: Draft, title: string, images: RenderImage[], template: RenderTemplate, signal?: AbortSignal, context: HtmlRenderContext = {}) {
  signal?.throwIfAborted(); assertEmbeddedImages(images);
  const checklist = template.id.includes('warm');
  const color = checklist ? { ink: '#332f2a', accent: '#a4512f', light: '#f4ecdf', line: '#d5bda4' } : { ink: '#263d37', accent: '#2f6859', light: '#edf2ed', line: '#b8cbbf' };
  const copy = (value: string) => escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>');
  const paragraph = (value: string, extra = '') => `<p style="margin:0 0 24px;font-size:${HTML_DESIGN_RULES.wechat.bodyPx}px;line-height:${HTML_DESIGN_RULES.wechat.lineHeight};letter-spacing:.03em;word-break:break-word;overflow-wrap:anywhere;${extra}">${copy(value)}</p>`;
  const used = new Set<string>();
  const imageBlock = (imageId: string, caption: string) => {
    const image = images.find(item => item.id === imageId);
    if (!image) throw new WorkflowError(422, '公众号配图与当前正文不一致，请重新选择有效同型号原图。');
    used.add(imageId);
    return `<section style="margin:30px 0 34px;"><img src="${image.uri}" alt="${escapeHtml(image.name)}" style="display:block;width:100%;max-width:100%;height:auto;object-fit:contain;border-radius:${checklist ? 8 : 2}px;">${caption ? `<p style="margin:12px 4px 0;text-align:center;font-size:13px;line-height:1.7;color:#69736b;word-break:break-word;">${copy(caption)}</p>` : ''}</section>`;
  };
  const at = (index: number) => draft.images.filter(placement => placement.afterBlock === index).map(placement => imageBlock(placement.imageId, placement.caption)).join('');
  const body = draft.blocks.map((block, index) => {
    const heading = checklist
      ? `<section style="margin:0 0 22px;padding:18px 20px;background:${color.light};border-left:4px solid ${color.accent};"><p style="font-size:12px;line-height:1.5;letter-spacing:.12em;color:${color.accent};margin:0 0 8px;">${String(index + 1).padStart(2, '0')}</p><h2 style="font-size:22px;line-height:1.55;letter-spacing:.01em;margin:0;font-weight:700;word-break:break-word;">${copy(block.heading)}</h2></section>`
      : `<section style="margin:0 0 22px;padding-top:26px;border-top:1px solid ${color.line};"><p style="font-size:12px;line-height:1.5;letter-spacing:.16em;color:${color.accent};margin:0 0 12px;">${String(index + 1).padStart(2, '0')}</p><h2 style="font-size:24px;line-height:1.5;letter-spacing:.01em;margin:0;font-weight:700;word-break:break-word;">${copy(block.heading)}</h2></section>`;
    return `<section style="margin:40px 0 0;">${heading}${paragraph(block.text)}${at(index)}</section>`;
  }).join('');
  const initial = at(-1);
  const trailing = draft.images.filter(placement => placement.afterBlock >= draft.blocks.length).map(placement => imageBlock(placement.imageId, placement.caption)).join('');
  const article = `<section style="max-width:680px;margin:0 auto;padding:34px 24px 44px;background:#fffefa;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif;color:${color.ink};box-sizing:border-box;">
  ${context.productName ? `<p style="margin:0 0 16px;font-size:12px;line-height:1.6;letter-spacing:.12em;color:${color.accent};">${copy(context.productName)}</p>` : ''}
  <h1 style="margin:0 0 28px;font-size:30px;line-height:1.4;letter-spacing:-.025em;font-weight:700;word-break:break-word;">${copy(title)}</h1>
  <section style="width:48px;height:4px;margin:0 0 26px;background:${color.accent};"></section>
  ${paragraph(draft.intro, `font-size:18px;line-height:1.9;color:${color.accent};`)}${initial}${body}${trailing}
  ${draft.cta ? `<section style="margin:36px 0 0;padding:22px 24px;border:1px solid ${color.line};background:${color.light};">${paragraph(draft.cta, 'margin:0;')}</section>` : ''}
  ${draft.tags.length ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.8;color:${color.accent};word-break:break-word;">${copy(draft.tags.map(tag => `#${tag.replace(/^#/, '')}`).join(' '))}</p>` : ''}
  </section>`;
  // Validate from the generated inert DOM too; content must survive platform tag
  // sanitization as real text, not a screenshot or an executable HTML fragment.
  const dom = new JSDOM(article);
  try {
    const actual = dom.window.document.body.textContent || '';
    const normalize = (value: string) => value.replace(/\s+/g, '');
    const expected = [title, draft.intro, ...draft.blocks.flatMap(block => [block.heading, block.text]), draft.cta, ...draft.images.map(placement => placement.caption)];
    if (expected.some(value => value && !normalize(actual).includes(normalize(value)))) throw new WorkflowError(500, '公众号排版完整性检查未通过，正文已保留。');
    if (dom.window.document.querySelector('script,style,iframe,svg,object,embed,link,a')) throw new WorkflowError(500, '公众号排版包含不支持的元素。');
  } finally { dom.window.close(); }
  signal?.throwIfAborted();
  return { html: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><body style="margin:0;background:#f2f2ed;">${article}</body></html>`, design: { ...htmlDesignMetadata('wechat', template.id), layout: checklist ? 'checklist' : 'magazine', productName: context.productName, exactCopy: { title, intro: draft.intro, blocks: draft.blocks.map(block => ({ heading: block.heading, text: block.text })), cta: draft.cta }, sourceImageIds: [...used] } };
}
