import { createHash } from 'node:crypto';
import pptxgen from 'pptxgenjs';
import type { Draft, Platform } from '../../shared/types.js';
import { WorkflowError } from '../outlines.js';
import { assertEmbeddedImages, planXhs, type CardPage, type RenderImage } from '../render/layouts.js';
import { DESIGN_RULES, DESIGN_SKILL_HASHES, DESIGN_SKILL_VERSION, designBriefSchema, type DesignBrief } from './rules.js';

export interface LayeredDeckInput {
  draft: Draft; title: string; productName: string; platform: Platform;
  images: RenderImage[]; background?: RenderImage; brief?: DesignBrief; signal?: AbortSignal;
  /** The first text box is replaced by a genuine Canva MCP editing transaction. */
  editableTitlePlaceholder?: boolean;
}
export interface LayeredDeckResult {
  buffer: Buffer;
  pages: { index: number; width: number; height: number; role: 'cover' | 'card' | 'poster'; sourceImageIds: string[]; factIds: string[]; texts: string[] }[];
  fingerprint: string; skillVersion: string; skillHashes: Record<string, string>;
  verificationEdit?: { from: string; to: string };
}
const SCALE = 108;
const inches = (pixels: number) => pixels / SCALE;
const hex = (color: string) => color.replace('#', '');
interface Zone { x: number; y: number; width: number; height: number }
/** Conservative line measurement protects full Chinese qualifiers, without truncation. */
export function fitLayerText(value: string, zone: Zone, initialPx: number, minPx: number, lineHeight = 1.48): number {
  const measure = (size: number) => value.split('\n').reduce((lines, paragraph) => {
    let used = 0, count = 1;
    for (const character of Array.from(paragraph)) {
      const width = /[\u0000-\u00ff]/.test(character) ? (/[MW@%]/.test(character) ? .85 : .6) : 1;
      if (used + width * size > zone.width * .94) { count++; used = 0; }
      used += width * size;
    }
    return lines + count;
  }, 0) * size * lineHeight;
  const candidates: number[] = [];
  for (let size = initialPx; size > minPx; size -= 2) candidates.push(size);
  candidates.push(minPx);
  for (const size of candidates) if (measure(size) <= zone.height * .96) return size;
  throw new WorkflowError(422, '分层版式无法容纳完整文案，请调整该渠道大纲。未裁掉或改写任何必要条件。');
}
function addText(slide: pptxgen.Slide, value: string, zone: Zone, size: number, color: string, bold: boolean, objectName: string, minimum = 22) {
  if (!value) return;
  const actual = fitLayerText(value, zone, size, minimum, bold ? 1.3 : 1.48);
  slide.addText(value, {
    x: inches(zone.x), y: inches(zone.y), w: inches(zone.width), h: inches(zone.height),
    fontFace: 'Noto Sans SC', fontSize: actual * 72 / SCALE, bold, color: hex(color),
    margin: 0, breakLine: false, valign: 'top', charSpacing: 0, paraSpaceAfter: 0,
    lineSpacingMultiple: bold ? 1.2 : 1.4, objectName, lang: 'zh-CN',
  });
}
function addImage(slide: pptxgen.Slide, image: RenderImage, zone: Zone, name: string) {
  const scale = Math.min(zone.width / image.width, zone.height / image.height);
  const width = image.width * scale, height = image.height * scale;
  slide.addImage({ data: image.uri, x: inches(zone.x + (zone.width - width) / 2), y: inches(zone.y + (zone.height - height) / 2), w: inches(width), h: inches(height), objectName: name, altText: image.name });
}
function addPanel(slide: pptxgen.Slide, zone: Zone, color: string, objectName: string, transparency = 0) {
  slide.addShape('rect', { x: inches(zone.x), y: inches(zone.y), w: inches(zone.width), h: inches(zone.height), fill: { color: hex(color), transparency }, line: { color: hex(color), transparency: 100 }, objectName });
}

/**
 * Real PPTX objects, not screenshot slides: product bytes, background bytes and
 * every text box remain separate importable objects for Canva. No paid API here.
 */
export async function buildLayeredDeck(input: LayeredDeckInput): Promise<LayeredDeckResult> {
  const { draft, title, productName, platform, images, background, signal } = input;
  signal?.throwIfAborted();
  if (platform !== draft.platform || platform === 'moments') throw new WorkflowError(422, '该分层工作流仅用于小红书、公众号封面和门店海报；朋友圈直接使用原图。');
  if (!images.length) throw new WorkflowError(422, '视觉制作至少需要一张有效同型号产品原图，AI 背景不能代替来源证据。');
  assertEmbeddedImages(images); if (background) assertEmbeddedImages([background]);
  if ([...images, ...(background ? [background] : [])].some(image => !Number.isFinite(image.width) || image.width <= 0 || !Number.isFinite(image.height) || image.height <= 0)) throw new WorkflowError(422, '图片尺寸无效，无法构建分层文件。');
  const brief = input.brief ? designBriefSchema.parse(input.brief) : undefined;
  if (brief && (brief.platform !== platform || brief.productName !== productName || brief.exactCopy.title !== title)) throw new WorkflowError(409, '设计简报与当前已审核稿件不一致，请重新制作该渠道视觉。');
  const width = platform === 'wechat' ? 1200 : 1080, height = platform === 'wechat' ? 510 : platform === 'poster' ? 1920 : 1440;
  const palette = brief?.palette || ['#F4EBDD', '#233F38', '#C66C45'];
  const [paper, ink, accent] = palette;
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'VIRGO_CHANNEL', width: inches(width), height: inches(height) });
  pptx.layout = 'VIRGO_CHANNEL'; pptx.author = 'Virgo'; pptx.subject = `${DESIGN_SKILL_VERSION};${platform}`;
  pptx.title = title; pptx.company = 'Virgo';
  pptx.theme = { headFontFace: 'Noto Sans SC', bodyFontFace: 'Noto Sans SC' };
  const pages: CardPage[] = platform === 'xiaohongshu' ? planXhs(draft, title, images) : [{ heading: title, text: '', factIds: draft.blocks.flatMap(block => block.factIds), images: images.slice(0, 1), role: platform === 'poster' ? 'poster' : 'cover' }];
  const metadata: LayeredDeckResult['pages'] = [];
  let verificationEdit: LayeredDeckResult['verificationEdit'];
  for (let index = 0; index < pages.length; index++) {
    signal?.throwIfAborted(); const page = pages[index]; const slide = pptx.addSlide();
    slide.background = { color: hex(paper) };
    // Separate full-canvas background, no product synthesis and no text baked in.
    if (background && (index === 0 || platform === 'poster')) {
      slide.addImage({ data: background.uri, x: 0, y: 0, w: inches(background.width), h: inches(background.height), sizing: { type: 'cover', w: inches(width), h: inches(height) }, objectName: 'AI_ENVIRONMENT_BACKGROUND', altText: 'AI 场景背景；非产品证据' });
    }
    const heading = index === 0 && input.editableTitlePlaceholder ? 'VIRGO_HEADLINE_PLACEHOLDER' : page.heading;
    if (index === 0 && input.editableTitlePlaceholder) verificationEdit = { from: heading, to: title };
    const texts: string[] = [productName, page.heading];
    const addHeadline = (zone: Zone, size: number, min: number, objectName = 'APPROVED_HEADLINE') => {
      const actual = fitLayerText(page.heading, zone, size, min, 1.3);
      addText(slide, heading, zone, actual, ink, true, objectName, min);
    };
    if (platform === 'wechat') {
      addPanel(slide, { x: 0, y: 0, width: 620, height }, paper, 'TITLE_CONTRAST_PLANE', 8);
      addPanel(slide, { x: 64, y: 98, width: 6, height: 260 }, accent, 'EDITORIAL_ACCENT');
      addText(slide, productName, { x: 94, y: 70, width: 475, height: 42 }, 25, ink, false, 'PRODUCT_NAME');
      addHeadline({ x: 94, y: 140, width: 480, height: 265 }, 58, 32);
      addImage(slide, images[0], { x: 630, y: 60, width: 510, height: 390 }, `PRODUCT_ORIGINAL_${images[0].id}`);
    } else if (platform === 'poster') {
      addPanel(slide, { x: 48, y: 64, width: 984, height: 445 }, paper, 'TITLE_CONTRAST_PLANE', 4);
      addText(slide, productName, { x: 76, y: 89, width: 930, height: 44 }, 27, ink, false, 'PRODUCT_NAME');
      addHeadline({ x: 76, y: 167, width: 930, height: 260 }, 90, 46);
      addImage(slide, images[0], { x: 95, y: 510, width: 890, height: 620 }, `PRODUCT_ORIGINAL_${images[0].id}`);
      const body = [draft.intro, ...draft.blocks.map(block => `${block.heading}\n${block.text}`)].filter(Boolean).join('\n\n');
      texts.push(body, draft.cta);
      addPanel(slide, { x: 48, y: 1150, width: 984, height: 550 }, paper, 'BODY_CONTRAST_PLANE', 3);
      addText(slide, body, { x: 76, y: 1180, width: 928, height: 480 }, 36, ink, false, 'APPROVED_BODY', 23);
      addPanel(slide, { x: 64, y: 1735, width: 952, height: 120 }, ink, 'ACTION_BACKGROUND');
      addText(slide, draft.cta, { x: 92, y: 1754, width: 896, height: 84 }, 34, paper, true, 'APPROVED_ACTION', 24);
    } else if (index === 0) {
      addPanel(slide, { x: 42, y: 45, width: 996, height: 500 }, paper, 'TITLE_CONTRAST_PLANE', 5);
      addText(slide, productName, { x: 70, y: 78, width: 940, height: 46 }, 26, ink, false, 'PRODUCT_NAME');
      addHeadline({ x: 70, y: 166, width: 940, height: 330 }, 84, 46);
      addImage(slide, images[0], { x: 95, y: 540, width: 890, height: 570 }, `PRODUCT_ORIGINAL_${images[0].id}`);
      texts.push(page.text);
      addPanel(slide, { x: 48, y: 1140, width: 984, height: 236 }, paper, 'INTRO_CONTRAST_PLANE', 5);
      addText(slide, page.text, { x: 72, y: 1170, width: 936, height: 175 }, 34, ink, false, 'APPROVED_INTRO', 24);
    } else {
      addPanel(slide, { x: 66, y: 77, width: 66, height: 7 }, accent, 'SERIES_ACCENT');
      addText(slide, productName, { x: 66, y: 108, width: 940, height: 40 }, 24, ink, false, 'PRODUCT_NAME');
      addHeadline({ x: 66, y: 192, width: 948, height: 190 }, 58, 38, 'APPROVED_SECTION_HEADING');
      const hasImages = page.images.length > 0;
      const photoHeight = hasImages ? 330 : 0;
      if (hasImages) {
        const imageWidth = 930 / page.images.length;
        page.images.forEach((image, offset) => addImage(slide, image, { x: 75 + imageWidth * offset, y: 380, width: imageWidth - 16, height: photoHeight }, `PRODUCT_ORIGINAL_${image.id}`));
      }
      texts.push(page.text);
      addText(slide, page.text, { x: 72, y: hasImages ? 746 : 415, width: 936, height: hasImages ? 590 : 920 }, 37, ink, false, 'APPROVED_SECTION_BODY', 24);
      addText(slide, `${String(index + 1).padStart(2, '0')} / ${String(pages.length).padStart(2, '0')}`, { x: 875, y: 1370, width: 140, height: 32 }, 21, ink, false, 'PAGE_NUMBER', 20);
    }
    slide.addNotes(JSON.stringify({ ruleVersion: DESIGN_SKILL_VERSION, skillHashes: DESIGN_SKILL_HASHES, rules: DESIGN_RULES, platform, page: index + 1, sourceImageIds: page.images.map(image => image.id), factIds: page.factIds, backgroundEvidence: false }));
    metadata.push({ index, width, height, role: page.role, sourceImageIds: page.images.map(image => image.id), factIds: page.factIds, texts });
  }
  signal?.throwIfAborted(); const result = await pptx.write({ outputType: 'nodebuffer', compression: true }); signal?.throwIfAborted();
  const buffer = Buffer.isBuffer(result) ? result : Buffer.from(result as Uint8Array);
  const fingerprint = createHash('sha256').update(JSON.stringify({ version: DESIGN_SKILL_VERSION, brief, draft, title, productName, platform, images: images.map(image => ({ id: image.id, hash: createHash('sha256').update(image.uri).digest('hex') })), background: background ? createHash('sha256').update(background.uri).digest('hex') : null })).digest('hex');
  return { buffer, pages: metadata, fingerprint, skillVersion: DESIGN_SKILL_VERSION, skillHashes: { ...DESIGN_SKILL_HASHES }, ...(verificationEdit ? { verificationEdit } : {}) };
}
