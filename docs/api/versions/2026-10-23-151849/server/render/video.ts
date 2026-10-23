import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { Draft, EvidenceBundle } from '../../shared/types.js';
import type { VideoScript, VideoScriptReview, VideoScriptScene } from '../../shared/video.js';
import { WorkflowError } from '../outlines.js';
import { FairLimiter } from '../fair-limiter.js';
import { withRenderPage } from './browser-pool.js';
import { assertEmbeddedImages, escapeHtml, fontFile, type RenderImage } from './layouts.js';
import { HTML_DESIGN_RULES, HTML_DESIGN_VERSION, HTML_SKILL_HASHES } from '../design/html-rules.js';

export const VIDEO_SPEC = Object.freeze({ width: HTML_DESIGN_RULES.video.width, height: HTML_DESIGN_RULES.video.height, durationSeconds: HTML_DESIGN_RULES.video.seconds, fps: HTML_DESIGN_RULES.video.fps, frameCount: HTML_DESIGN_RULES.video.seconds * HTML_DESIGN_RULES.video.fps });
export const VIDEO_RENDERER_VERSION = 'html-gsap-video-2';
const videoSlots = new FairLimiter(1);
const require = createRequire(import.meta.url);
let assets: Promise<{ gsap: string; regular: string; bold: string }> | undefined;

export interface VideoScene {
  role: 'opening' | 'information' | 'action'; start: number; end: number;
  heading: string; text: string; blockId?: string; factIds: string[]; qualifiers: string[];
}
export interface VideoStoryboard {
  version: typeof VIDEO_RENDERER_VERSION; width: number; height: number; fps: number;
  frameCount: number; durationSeconds: number; productName: string; scenes: VideoScene[];
  sourceImageIds: string[]; designVersion: string; skillHashes: Readonly<Record<string, string>>;
}
export interface ProductVideoInput {
  draft: Draft; title: string; productName: string; images: RenderImage[];
  background?: RenderImage; facts?: EvidenceBundle['facts']; signal?: AbortSignal;
  script?: VideoScript; scriptReview?: VideoScriptReview;
  onProgress?: (progress: { phase: 'storyboard' | 'frames' | 'encode'; completedFrames: number; totalFrames: number }) => void | Promise<void>;
}
export interface ProductVideoResult {
  data: Buffer; cover: Buffer; html: string; storyboard: VideoStoryboard;
  width: number; height: number; durationSeconds: number; fps: number; frameCount: number;
}

function videoError(status: number, code: string, message: string): WorkflowError & { code: string } {
  return Object.assign(new WorkflowError(status, message), { code });
}
const tooLong = () => videoError(422, 'VIDEO_COPY_TOO_LONG', '当前已审稿没有适合 20 秒视频的完整短句，或必要适用条件无法同屏读完。请精简对应内容并重新审核；未截断事实或限定条件。');
/** Roughly seven Chinese glyphs/second; Latin names count half a glyph. */
export function videoReadingUnits(text: string) {
  return Array.from(text.replace(/\s/g, '')).reduce((sum, letter) => sum + (/^[\x00-\x7f]$/.test(letter) ? 0.5 : 1), 0);
}
function sentences(text: string): string[] {
  return (text.match(/[^。！？!?；;\n]+(?:[。！？!?；;]+|$)/g) || []).map(sentence => sentence.trim()).filter(Boolean);
}
const normalized = (text: string) => text.replace(/[\s。！？!?；;，,：:]+/g, '').toLowerCase();

export function videoSceneText(scene: VideoScriptScene) {
  return [scene.text, ...new Set(scene.conditions.filter(condition => condition.mode === 'display' && !normalized(scene.text).includes(normalized(condition.text))).map(condition => condition.text))].filter(Boolean).join('\n');
}

/** Allocate integer frames from reading time. Twenty seconds remains exactly 600 frames. */
export function planVideoTimings(title: string, cta: string, information: Array<{ heading: string; text: string }>) {
  if (!title.trim() || !cta.trim() || !information.length || information.length > 2) throw videoError(422, 'VIDEO_SCRIPT_STRUCTURE', '视频需要标题、行动引导及一至两个核心信息。');
  const framesFor = (value: string, minimum: number) => Math.max(minimum, Math.ceil((videoReadingUnits(value) / 7 + .35) * VIDEO_SPEC.fps));
  const opening = framesFor(title, 84), action = framesFor(cta, 78);
  if (opening > 180) throw videoError(422, 'VIDEO_TITLE_TOO_LONG', '视频标题需要超过 6 秒才能读完，请在独立视频短稿中缩短标题；原图文标题无需修改。');
  if (action > 180) throw videoError(422, 'VIDEO_ACTION_TOO_LONG', '视频行动引导需要超过 6 秒才能读完，请精简独立视频短稿中的行动引导。');
  const available = VIDEO_SPEC.frameCount - opening - action;
  const required = information.map(scene => framesFor(scene.heading + scene.text, 105));
  const needed = required.reduce((sum, frames) => sum + frames, 0);
  if (needed > available) throw videoError(422, 'VIDEO_COPY_TOO_LONG', `视频信息及必要适用条件约需 ${(needed / VIDEO_SPEC.fps).toFixed(1)} 秒，当前可用 ${(available / VIDEO_SPEC.fps).toFixed(1)} 秒。请减少独立视频中的信息点；未删去事实条件。`);
  let cursor = opening;
  const result = [{ start: 0, end: opening / VIDEO_SPEC.fps }];
  required.forEach((frames, index) => {
    const allocation = index === required.length - 1 ? VIDEO_SPEC.frameCount - action - cursor : frames + Math.floor((available - needed) * frames / needed);
    result.push({ start: cursor / VIDEO_SPEC.fps, end: (cursor + allocation) / VIDEO_SPEC.fps }); cursor += allocation;
  });
  result.push({ start: cursor / VIDEO_SPEC.fps, end: VIDEO_SPEC.durationSeconds });
  return result;
}

/** Select original complete sentences only; carry every applicable condition on the same scene. */
export function buildVideoStoryboard(input: Pick<ProductVideoInput, 'draft' | 'title' | 'productName' | 'images' | 'facts' | 'script' | 'scriptReview'>): VideoStoryboard {
  const { draft, title, productName, images, facts = [] } = input;
  if (!['wechat', 'xiaohongshu'].includes(draft.platform)) throw videoError(422, 'VIDEO_CHANNEL_UNSUPPORTED', '当前只有公众号和小红书渠道支持按需短视频。');
  if (!images.length) throw videoError(422, 'VIDEO_SOURCE_REQUIRED', '短视频至少需要一张有效的同型号产品原图，生成背景不能替代产品原图。');
  assertEmbeddedImages(images);
  if (input.script) {
    if (input.scriptReview?.status !== 'passed') throw videoError(409, 'VIDEO_SCRIPT_NOT_REVIEWED', '独立视频短稿尚未审核通过，原图文成品仍可使用。');
    const script = input.script, timings = planVideoTimings(script.title, script.cta, script.scenes.map(scene => ({ heading: scene.heading, text: videoSceneText(scene) })));
    const scenes: VideoScene[] = [{ role: 'opening', ...timings[0], heading: script.title, text: '', factIds: [], qualifiers: [] }, ...script.scenes.map((scene, index) => ({ role: 'information' as const, ...timings[index + 1], heading: scene.heading, text: videoSceneText(scene), blockId: scene.id, factIds: scene.factIds, qualifiers: scene.conditions.filter(condition => condition.mode === 'display').map(condition => condition.text) })), { role: 'action', ...timings.at(-1)!, heading: script.cta, text: '', factIds: [], qualifiers: [] }];
    return { version: VIDEO_RENDERER_VERSION, ...VIDEO_SPEC, productName, scenes, sourceImageIds: images.slice(0, 3).map(image => image.id), designVersion: HTML_DESIGN_VERSION, skillHashes: HTML_SKILL_HASHES };
  }
  if (draft.blocks.some(block => block.factIds.some(id => !facts.some(fact => fact.id === id && fact.status === 'supported')))) throw videoError(409, 'VIDEO_FACTS_CHANGED', '视频引用的事实或适用条件不可核对，请载入当前已审核稿并重新取证。');
  if (!draft.titles.includes(title)) throw videoError(409, 'VIDEO_VERSION_CONFLICT', '视频标题必须来自当前已审核渠道版本。');
  if (!title.trim() || !draft.cta.trim() || videoReadingUnits(productName) > 48) throw tooLong();
  const allSentences = [draft.intro, ...draft.blocks.map(block => block.text), draft.cta].flatMap(sentences);
  const candidates: Array<Omit<VideoScene, 'role' | 'start' | 'end'>> = [];
  for (const block of draft.blocks) {
    const qualifiers = [...new Set(block.factIds.flatMap(id => facts.find(fact => fact.id === id)?.qualifiers || []).filter(Boolean))];
    for (const sentence of sentences(block.text)) {
      // A sentence outside this block can be a shared reviewed condition. Use its
      // complete original wording, never a substring or an evidence-only rewrite.
      const conditions = qualifiers.filter(qualifier => !normalized(sentence).includes(normalized(qualifier))).map(qualifier => allSentences.find(value => normalized(value).includes(normalized(qualifier))));
      if (conditions.some(value => !value)) continue;
      const text = [sentence, ...new Set(conditions.filter((value): value is string => !!value))].join('\n');
      if (qualifiers.some(qualifier => normalized(qualifier).includes(normalized(sentence)))) continue;
      if (videoReadingUnits(text + block.heading) <= 84 && videoReadingUnits(block.heading) <= 20) candidates.push({ heading: block.heading, text, blockId: block.id, factIds: [...block.factIds], qualifiers });
    }
  }
  const short = candidates.filter(candidate => videoReadingUnits(candidate.text + candidate.heading) <= 42);
  const first = short[0];
  // Two scenes from different original blocks avoid repeating one fact twice.
  const second = first && short.find(candidate => candidate.blockId !== first.blockId && candidate.text !== first.text);
  const selected = first && second ? [first, second] : candidates.length ? [candidates[0]] : [];
  if (!selected.length) throw tooLong();
  const timings = planVideoTimings(title, draft.cta, selected);
  const scenes: VideoScene[] = [{ role: 'opening', ...timings[0], heading: title, text: '', factIds: [], qualifiers: [] }];
  selected.forEach((candidate, index) => scenes.push({ ...candidate, role: 'information', ...timings[index + 1] }));
  scenes.push({ role: 'action', ...timings.at(-1)!, heading: draft.cta, text: '', factIds: [], qualifiers: [] });
  return { version: VIDEO_RENDERER_VERSION, ...VIDEO_SPEC, productName, scenes, sourceImageIds: images.slice(0, 3).map(image => image.id), designVersion: HTML_DESIGN_VERSION, skillHashes: HTML_SKILL_HASHES };
}

async function embeddedRuntime() {
  return assets ||= Promise.all([readFile(require.resolve('gsap/dist/gsap.min.js'), 'utf8'), readFile(fontFile), readFile(path.join(path.dirname(fontFile), 'NotoSansSC-Bold.ttf'))]).then(([gsap, regular, bold]) => ({ gsap, regular: regular.toString('base64'), bold: bold.toString('base64') }));
}

export async function buildProductVideoHtml(storyboard: VideoStoryboard, images: RenderImage[], background?: RenderImage) {
  if (!images.length) throw videoError(422, 'VIDEO_SOURCE_REQUIRED', '短视频至少需要一张有效的同型号产品原图。');
  assertEmbeddedImages([...images, ...(background ? [background] : [])]);
  const runtime = await embeddedRuntime();
  const image = (index: number) => images[index % images.length];
  const text = (value: string) => escapeHtml(value).replace(/\n/g, '<br>');
  const scenes = storyboard.scenes.map((scene, index) => `<section class="scene ${scene.role}" id="scene-${index}"><div class="scene-inner"><div class="eyebrow" data-fit>${escapeHtml(storyboard.productName)}</div><div class="rule"></div><div class="text-panel"><h1 data-fit>${text(scene.heading)}</h1>${scene.text ? `<p class="body" data-fit>${text(scene.text)}</p>` : ''}</div><figure><img src="${image(index).uri}" alt="${escapeHtml(image(index).name)}"></figure><div class="folio">${String(index + 1).padStart(2, '0')}<span> / ${String(storyboard.scenes.length).padStart(2, '0')}</span></div></div></section>`).join('');
  const timings = JSON.stringify(storyboard.scenes.map(scene => ({ start: scene.start, end: scene.end })));
  const transition = HTML_DESIGN_RULES.video.transitionSeconds;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080,initial-scale=1"><title>${escapeHtml(storyboard.scenes[0].heading)}</title><style>
  @font-face{font-family:VideoNoto;src:url(data:font/ttf;base64,${runtime.regular}) format('truetype');font-weight:400}@font-face{font-family:VideoNoto;src:url(data:font/ttf;base64,${runtime.bold}) format('truetype');font-weight:700}
  *{box-sizing:border-box}html,body{margin:0;width:1080px;height:1920px;overflow:hidden}body{background:#eae5db;font-family:VideoNoto,sans-serif;color:#18352d;-webkit-font-smoothing:antialiased}.canvas{width:1080px;height:1920px;position:relative;overflow:hidden}.ambient{position:absolute;inset:0;background:radial-gradient(ellipse at 80% 78%,#d4ddc9 0,transparent 65%),#f3f0e7}.ambient img{width:100%;height:100%;object-fit:cover;opacity:.20}.scene{position:absolute;inset:0;visibility:hidden;opacity:0}.scene-inner{position:absolute;inset:0;padding:112px 88px 106px;overflow:hidden}.eyebrow{font-size:30px;line-height:1.45;font-weight:700;letter-spacing:1.2px;max-height:90px;overflow:hidden}.rule{width:116px;height:8px;background:#d98455;margin-top:34px}.text-panel{margin-top:65px;position:relative;z-index:2}h1{font-size:88px;line-height:1.24;letter-spacing:-3px;font-weight:700;margin:0;max-height:440px;overflow:visible;overflow-wrap:anywhere}.body{margin:42px 0 0;font-size:56px;line-height:1.6;letter-spacing:.3px;white-space:normal;overflow-wrap:anywhere;max-height:660px}figure{margin:0;position:absolute;left:88px;right:88px;top:890px;height:720px;display:flex;align-items:center;justify-content:center;padding:32px;background:rgba(255,255,255,.84);border-radius:44px;box-shadow:0 22px 80px #14332b0b;overflow:hidden}figure img{display:block;width:100%;height:100%;object-fit:contain}.folio{position:absolute;left:88px;right:88px;bottom:112px;border-top:1px solid #18352d33;padding-top:28px;font-size:26px;font-weight:700;letter-spacing:2px}.folio span{font-weight:400;opacity:.5}.information h1{font-size:48px;line-height:1.45;letter-spacing:0;color:#647c6d;max-height:140px}.information .text-panel{margin-top:55px}.information figure{top:1180px;height:410px;background:rgba(255,255,255,.75);border-radius:26px}.action{background:#18372f;color:#fff9e9}.action .eyebrow{color:#c6d7b6}.action .rule{background:#e5ae74}.action .text-panel{margin-top:80px}.action h1{font-size:88px;line-height:1.35;max-height:580px}.action figure{top:960px;height:580px;background:#f4f0e7}.action .folio{border-color:#fff9e933}.progress{position:absolute;left:0;bottom:0;width:1080px;height:9px;background:#d98455;transform-origin:left center;z-index:9;transform:scaleX(0)}
  h1,.action h1{line-height:1.5;padding:8px 0;text-wrap:balance}.information h1{line-height:1.6;padding:6px 0}.body{text-wrap:pretty}
  </style></head><body><main class="canvas"><div class="ambient">${background ? `<img src="${background.uri}" alt="">` : ''}</div>${scenes}<div class="progress"></div></main><script>${runtime.gsap.replace(/<\/script/gi, '<\\/script')}</script><script>
  (()=>{const timings=${timings};const tl=gsap.timeline({paused:true,defaults:{ease:'power2.inOut'}});gsap.set('#scene-0',{autoAlpha:1});timings.forEach((scene,index)=>{const el=document.getElementById('scene-'+index);if(index){tl.fromTo(el,{autoAlpha:0},{autoAlpha:1,duration:${transition},immediateRender:false},scene.start-${transition});tl.to('#scene-'+(index-1),{autoAlpha:0,duration:${transition}},scene.start-${transition});tl.fromTo(el.querySelector('.text-panel'),{y:24},{y:0,duration:${transition},immediateRender:false,ease:'${HTML_DESIGN_RULES.motion.ease}'},scene.start-${transition})}tl.fromTo(el.querySelector('figure img'),{scale:${HTML_DESIGN_RULES.motion.maxScale}},{scale:1,duration:scene.end-scene.start,immediateRender:false,ease:'none'},scene.start)});tl.fromTo('.progress',{scaleX:0},{scaleX:1,duration:20,ease:'none'},0);tl.seek(0,false);gsap.ticker.sleep();window.productVideo={timeline:tl,seek(seconds){tl.seek(Math.max(0,Math.min(20,seconds)),false);gsap.ticker.sleep()}}})();
  </script></body></html>`;
}

interface ProcessResult { code: number | null; error?: Error; stderr: string }
function launch(command: string, args: string[], signal?: AbortSignal) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (part: Buffer) => { stderr = (stderr + part.toString()).slice(-16_384); });
  // EPIPE is reported by the awaited write as well; never leave an unhandled event.
  child.stdin.on('error', () => {});
  let processError: Error | undefined;
  const finished = new Promise<ProcessResult>(resolve => {
    child.once('error', error => { processError = error; });
    child.once('close', code => resolve({ code, error: processError, stderr }));
  });
  let hardKill: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { child.kill('SIGTERM'); hardKill = setTimeout(() => child.kill('SIGKILL'), 750); hardKill.unref(); };
  signal?.addEventListener('abort', stop, { once: true });
  const detach = () => { signal?.removeEventListener('abort', stop); clearTimeout(hardKill); };
  if (signal?.aborted) stop();
  return { child, finished, stop, detach };
}

function writeFrame(child: ChildProcessWithoutNullStreams, data: Buffer, signal?: AbortSignal) {
  signal?.throwIfAborted();
  // Await the stream write callback: at most one PNG is queued, and pipe/encoder
  // backpressure controls the producer instead of buffering 600 PNGs in memory.
  return new Promise<void>((resolve, reject) => child.stdin.write(data, error => error ? reject(error) : resolve()));
}

export function validateVideoProbe(probe: unknown) {
  if (!probe || typeof probe !== 'object' || !Array.isArray((probe as { streams?: unknown }).streams)) throw videoError(500, 'VIDEO_VALIDATION_FAILED', '本机视频元数据不可读取，未发布文件。');
  const value = probe as { streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string; r_frame_rate?: string; nb_read_frames?: string; duration?: string }>; format?: { duration?: string } };
  const videos = value.streams?.filter(stream => stream.codec_type === 'video') || [];
  const video = videos[0];
  const duration = Number(value.format?.duration || video?.duration);
  if (videos.length !== 1 || value.streams?.some(stream => stream.codec_type === 'audio') || !video || video.codec_name !== 'h264' || video.width !== VIDEO_SPEC.width || video.height !== VIDEO_SPEC.height || video.pix_fmt !== 'yuv420p' || video.r_frame_rate !== '30/1' || Number(video.nb_read_frames) !== VIDEO_SPEC.frameCount || Math.abs(duration - VIDEO_SPEC.durationSeconds) > .04) throw videoError(500, 'VIDEO_VALIDATION_FAILED', '本机视频编码校验未通过，未发布不完整文件；已完成图文仍可使用。');
}

/** One local deadline covers both semaphore queues, browser work, encode and probe. */
export async function withVideoDeadline<T>(callerSignal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>, timeoutMs = 10 * 60 * 1000): Promise<T> {
  callerSignal?.throwIfAborted();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs); timer.unref();
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline.signal]) : deadline.signal;
  try { return await operation(signal); }
  catch (error) {
    callerSignal?.throwIfAborted();
    if (deadline.signal.aborted) throw videoError(504, 'VIDEO_LOCAL_TIMEOUT', '本地视频制作超过 10 分钟，图文已保留；可重试视频，不会重新调用文案、审稿或生图模型。');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function renderProductVideo(input: ProductVideoInput): Promise<ProductVideoResult> {
  return withVideoDeadline(input.signal, signal => renderProductVideoWithinDeadline({ ...input, signal }));
}

async function renderProductVideoWithinDeadline(input: ProductVideoInput): Promise<ProductVideoResult> {
  input.signal?.throwIfAborted();
  const storyboard = buildVideoStoryboard(input);
  if (input.background) assertEmbeddedImages([input.background]);
  await input.onProgress?.({ phase: 'storyboard', completedFrames: 0, totalFrames: VIDEO_SPEC.frameCount });
  const owner = `video-${randomUUID()}`;
  const release = await videoSlots.acquire(owner, input.signal);
  let directory: string | undefined;
  try {
    input.signal?.throwIfAborted();
    directory = await mkdtemp(path.join(os.tmpdir(), `hackson-video-${process.pid}-`));
    const output = path.join(directory, 'product.mp4');
    const html = await buildProductVideoHtml(storyboard, input.images.slice(0, 3), input.background);
    let cover: Buffer | undefined;
    await withRenderPage(owner, { width: VIDEO_SPEC.width, height: VIDEO_SPEC.height }, input.signal, async page => {
      await page.setContent(html, { waitUntil: 'load', timeout: 45_000 });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(image => image.decode())); });
      // Check every scene before animation: no crop, shrinking loop, or ellipsis.
      const fits = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-fit]')).every(element => {
        const bounds = element.getBoundingClientRect();
        return element.scrollHeight <= element.clientHeight + 2 && element.scrollWidth <= element.clientWidth + 2 && bounds.left >= 84 && bounds.right <= 996 && bounds.bottom <= (element.closest('.information') ? 1160 : element.closest('.action') ? 920 : 840);
      }));
      if (!fits) throw tooLong();
      const capture = await page.context().newCDPSession(page);
      const encoder = launch('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '2', '-movflags', '+faststart', '-frames:v', '600', output], input.signal);
      try {
        for (let frame = 0; frame < VIDEO_SPEC.frameCount; frame++) {
          input.signal?.throwIfAborted();
          await page.evaluate(seconds => {
            (window as unknown as { productVideo: { seek: (seconds: number) => void } }).productVideo.seek(seconds);
            // Commit computed layout before Chromium's screenshot surface capture.
            return document.querySelector('.canvas')!.getBoundingClientRect().width;
          }, frame / VIDEO_SPEC.fps);
          // Lossless PNG with fast compression; avoids screenshot helper waits
          // and expensive size-oriented encoding for every one of the 600 frames.
          const screenshot = await capture.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: VIDEO_SPEC.width, height: VIDEO_SPEC.height, scale: 1 }, captureBeyondViewport: true, fromSurface: true, optimizeForSpeed: true });
          const png = Buffer.from(screenshot.data, 'base64');
          if (frame === 0) {
            const metadata = await sharp(png).metadata();
            if (metadata.width !== VIDEO_SPEC.width || metadata.height !== VIDEO_SPEC.height) throw videoError(500, 'VIDEO_FRAME_SIZE_INVALID', '本机视频截图尺寸不正确，未开始发布视频。');
          }
          if (frame === 30) cover = png;
          await writeFrame(encoder.child, png, input.signal);
          if (frame === 0 || (frame + 1) % 30 === 0) await input.onProgress?.({ phase: 'frames', completedFrames: frame + 1, totalFrames: VIDEO_SPEC.frameCount });
        }
        encoder.child.stdin.end();
        await input.onProgress?.({ phase: 'encode', completedFrames: VIDEO_SPEC.frameCount, totalFrames: VIDEO_SPEC.frameCount });
        const result = await encoder.finished;
        input.signal?.throwIfAborted();
        if (result.error) throw videoError(503, 'VIDEO_RUNTIME_MISSING', '本机缺少 FFmpeg，请安装 FFmpeg 后重试视频；已完成图文仍可使用。');
        if (result.code !== 0) throw videoError(500, 'VIDEO_ENCODE_FAILED', '本机视频编码失败，未发布不完整文件；请检查 FFmpeg 的 H.264 编码支持和磁盘空间。');
      } catch (error) {
        encoder.stop(); const stopped = await encoder.finished;
        input.signal?.throwIfAborted();
        if (stopped.error) throw videoError(503, 'VIDEO_RUNTIME_MISSING', '本机缺少 FFmpeg，请安装 FFmpeg 后重试视频；已完成图文仍可使用。');
        if (error instanceof WorkflowError) throw error;
        throw Object.assign(videoError(500, 'VIDEO_ENCODE_FAILED', '本机视频编码中断，未发布不完整文件；已完成图文仍可使用。'), { cause: error });
      } finally { encoder.detach(); await capture.detach().catch(() => {}); }
    });
    const probe = launch('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,nb_read_frames,duration:format=duration', '-of', 'json', output], input.signal);
    let probeJson = '';
    probe.child.stdin.end();
    probe.child.stdout.on('data', (part: Buffer) => { probeJson = (probeJson + part.toString()).slice(0, 65_536); });
    try {
      const checked = await probe.finished;
      input.signal?.throwIfAborted();
      if (checked.error) throw videoError(503, 'VIDEO_RUNTIME_MISSING', '本机缺少 ffprobe，无法验证视频，未发布文件。');
      if (checked.code !== 0) throw videoError(500, 'VIDEO_VALIDATION_FAILED', '本机视频文件校验失败，未发布文件。');
      try { validateVideoProbe(JSON.parse(probeJson)); } catch (error) { if (error instanceof WorkflowError) throw error; throw videoError(500, 'VIDEO_VALIDATION_FAILED', '本机视频元数据不可读取，未发布文件。'); }
    } finally { probe.detach(); }
    const metadata = await stat(output);
    if (metadata.size > 128 * 1024 * 1024) throw videoError(500, 'VIDEO_TOO_LARGE', '本机视频超过文件大小限制，未发布文件。');
    input.signal?.throwIfAborted();
    return { data: await readFile(output), cover: cover!, html, storyboard, ...VIDEO_SPEC };
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); release(); }
}
