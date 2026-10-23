/** Pure synthetic local acceptance. Never imports start.ts, .env or private sources. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import type { Draft } from '../shared/types.js';
import { renderProductVideo, VIDEO_SPEC } from '../server/render/video.js';
import { closeRenderRuntime } from '../server/render/browser-pool.js';

const execute = promisify(execFile);
const destination = path.resolve('.local-state/verification', `html-video-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(destination, { recursive: true });
const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600"><rect width="900" height="600" fill="#faf9f6"/><rect x="168" y="80" width="564" height="350" rx="20" fill="#b9b8b2"/><rect x="188" y="100" width="524" height="310" rx="8" fill="#223e35"/><circle cx="450" cy="255" r="85" fill="#d7deb8"/><path d="M118 450h664l55 42H63z" fill="#d4d3cd"/><path d="M63 492h774v13c0 10-12 16-28 16H91c-16 0-28-6-28-16z" fill="#a5a59f"/><rect x="365" y="455" width="170" height="16" rx="4" fill="#aaa9a4"/></svg>`)).png().toBuffer();
const background = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs><radialGradient id="g"><stop stop-color="#b4c7a4"/><stop offset="1" stop-color="#f4efe4"/></radialGradient></defs><rect width="1080" height="1920" fill="url(#g)"/><circle cx="950" cy="950" r="580" fill="#e0be8b" opacity=".35"/></svg>`)).png().toBuffer();
const draft: Draft = { id: 'synthetic-video-draft', platform: 'xiaohongshu', titles: ['开学选电脑，先看这两件事'], intro: '纯模拟验收文案，不表示真实产品事实。', blocks: [
  { id: 'carry', heading: '亲手试一试', text: '放进日常背包，感受随身携带。', factIds: [] },
  { id: 'screen', heading: '打开你的课件', text: '现场观察文字大小与屏幕比例。', factIds: [] },
], cta: '带上你的问题，到店聊聊。', tags: [], images: [] };
const started = performance.now();
const cancellation = new AbortController();
const stop = () => cancellation.abort();
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try {
  const result = await renderProductVideo({ draft, title: draft.titles[0], productName: '纯模拟机型 A', signal: cancellation.signal, images: [{ id: 'synthetic-original', name: '纯模拟产品原图', uri: `data:image/png;base64,${png.toString('base64')}`, width: 900, height: 600 }], background: { id: 'synthetic-background', name: '纯模拟背景', uri: `data:image/png;base64,${background.toString('base64')}`, width: 1080, height: 1920 }, onProgress: progress => { if (progress.phase !== 'frames' || progress.completedFrames % 30 === 0) console.log(JSON.stringify({ ...progress, elapsedMs: Math.round(performance.now() - started) })); } });
  const elapsedMs = Math.round(performance.now() - started);
  const media = path.join(destination, 'product.mp4');
  await Promise.all([writeFile(media, result.data), writeFile(path.join(destination, 'cover.png'), result.cover), writeFile(path.join(destination, 'source.html'), result.html), writeFile(path.join(destination, 'storyboard.json'), JSON.stringify(result.storyboard, null, 2) + '\n')]);
  const { stdout } = await execute('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,nb_read_frames,duration:format=duration,size', '-of', 'json', media]);
  const frameSamples = [];
  for (const seconds of [0, 3.65, 4.2, 9.65, 10.2, 15.65, 16.8, 19.96]) {
    const filename = `frame-${String(seconds).replace('.', '_')}.png`;
    await execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', media, '-frames:v', '1', '-y', path.join(destination, filename)]);
    frameSamples.push({ seconds, file: filename, sha256: createHash('sha256').update(await readFile(path.join(destination, filename))).digest('hex') });
  }
  const report = { synthetic: true, createdAt: new Date().toISOString(), elapsedMs, modelCalls: 0, spec: VIDEO_SPEC, bytes: result.data.length, probe: JSON.parse(stdout), sha256: createHash('sha256').update(result.data).digest('hex'), frameSamples, platformPasteVerified: false, note: 'Pure synthetic local rendering; product shape is synthetic, not real product evidence.' };
  await writeFile(path.join(destination, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ destination, elapsedMs, bytes: result.data.length, frameSamples: frameSamples.length }));
} finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await closeRenderRuntime(); }
