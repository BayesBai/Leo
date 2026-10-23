import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import sharp from 'sharp';
import type { Draft, Fact } from '../shared/types.js';
import { buildProductVideoHtml, buildVideoStoryboard, renderProductVideo, validateVideoProbe, videoReadingUnits, withVideoDeadline, VIDEO_SPEC } from '../server/render/video.js';
import { closeRenderRuntime, renderRuntimeStats } from '../server/render/browser-pool.js';
import type { RenderImage } from '../server/render/layouts.js';

const draft: Draft = { id: 'synthetic-video-draft', platform: 'xiaohongshu', titles: ['先看需求，再选电脑'], intro: '纯模拟内容。', blocks: [
  { id: 'one', heading: '随身体验', text: '把电脑放进常用背包，亲手试一试。', factIds: [] },
  { id: 'two', heading: '屏幕体验', text: '打开自己的课件，现场观察文字大小。', factIds: [] },
], cta: '带上你的问题，到店聊聊。', tags: [], images: [] };
const bytes = await sharp({ create: { width: 200, height: 120, channels: 3, background: '#bad0c0' } }).png().toBuffer();
const images: RenderImage[] = [{ id: 'synthetic-product', name: '纯模拟图片', uri: `data:image/png;base64,${bytes.toString('base64')}`, width: 200, height: 120 }];
const input = { draft, title: draft.titles[0], productName: '纯模拟机型', images };
const fact: Fact = { id: 'f1', statement: '标准版约798g。', quote: '纯模拟事实', sourceTitle: '纯模拟', retrievedAt: new Date().toISOString(), qualifiers: ['以实际销售版本为准。'], sourceMode: 'local', status: 'supported' };

test('video storyboard keeps original sentences, frame count and readable scene budgets', () => {
  const board = buildVideoStoryboard(input);
  assert.equal(board.scenes.length, 4);
  assert.deepEqual(board.scenes.map(scene => [scene.start, scene.end]), [[0, 4], [4, 10], [10, 16], [16, 20]]);
  assert.deepEqual(board.scenes.slice(1, 3).map(scene => scene.text), draft.blocks.map(block => block.text));
  assert.equal(board.frameCount, 600); assert.equal(board.fps, 30); assert.equal(board.durationSeconds, 20);
  assert.equal(videoReadingUnits('中文AB'), 3);
});

test('necessary fact qualifiers travel as complete reviewed sentences on the same information scene', () => {
  const conditioned = structuredClone(draft);
  conditioned.blocks = [{ id: 'fact', heading: '重量', text: '标准版约798g。', factIds: ['f1'] }];
  conditioned.intro = fact.qualifiers[0];
  const board = buildVideoStoryboard({ ...input, draft: conditioned, facts: [fact] });
  assert.equal(board.scenes.length, 3);
  assert.equal(board.scenes[1].text, '标准版约798g。\n以实际销售版本为准。');
  assert.deepEqual(board.scenes[1].qualifiers, fact.qualifiers);
  conditioned.intro = '没有适用条件的模拟稿。';
  assert.throws(() => buildVideoStoryboard({ ...input, draft: conditioned, facts: [fact] }), (error: any) => error.status === 422 && error.code === 'VIDEO_COPY_TOO_LONG');
});

test('oversized copy, stale title, unsupported channel and unembedded images fail before paid or media work', () => {
  const oversized = structuredClone(draft); oversized.blocks = [{ ...draft.blocks[0], text: '完整且不可截断的必要事实条件'.repeat(30) + '。' }];
  assert.throws(() => buildVideoStoryboard({ ...input, draft: oversized }), (error: any) => error.status === 422 && error.code === 'VIDEO_COPY_TOO_LONG');
  assert.throws(() => buildVideoStoryboard({ ...input, title: '过期标题' }), (error: any) => error.status === 409);
  assert.throws(() => buildVideoStoryboard({ ...input, draft: { ...draft, platform: 'moments' } }), (error: any) => error.status === 422);
  assert.throws(() => buildVideoStoryboard({ ...input, images: [] }), (error: any) => error.status === 422);
  assert.throws(() => buildVideoStoryboard({ ...input, images: [{ ...images[0], uri: 'https://invalid.example/image.png' }] }), (error: any) => error.status === 422);
  assert.throws(() => buildVideoStoryboard({ ...input, draft: { ...draft, blocks: [{ ...draft.blocks[0], factIds: ['missing'] }] } }), (error: any) => error.status === 409 && error.code === 'VIDEO_FACTS_CHANGED');
});

test('video HTML is self contained, escaped and driven by a paused GSAP timeline with explicit seek', async () => {
  const malicious = { ...draft, titles: ['<script>危险</script>'] };
  const board = buildVideoStoryboard({ ...input, draft: malicious, title: malicious.titles[0] });
  const html = await buildProductVideoHtml(board, images);
  assert.ok(html.includes('&lt;script&gt;危险&lt;/script&gt;'));
  assert.ok(html.includes('gsap.timeline({paused:true'));
  assert.ok(html.includes('tl.seek(')); assert.ok(html.includes('gsap.ticker.sleep()'));
  assert.ok(html.includes('data:font/ttf;base64,')); assert.ok(!html.includes('<script src='));
  assert.ok(!html.includes('审核中')); assert.ok(!html.includes('setInterval('));
});

test('video publication requires exact H.264 frame dimensions, duration, count and no audio', () => {
  const good = { streams: [{ codec_type: 'video', codec_name: 'h264', width: VIDEO_SPEC.width, height: VIDEO_SPEC.height, pix_fmt: 'yuv420p', r_frame_rate: '30/1', nb_read_frames: '600' }], format: { duration: '20.000000' } };
  assert.doesNotThrow(() => validateVideoProbe(good));
  for (const change of [{ nb_read_frames: '599' }, { pix_fmt: 'yuv444p' }, { width: 540 }, { codec_name: 'hevc' }, { r_frame_rate: '24/1' }]) {
    assert.throws(() => validateVideoProbe({ ...good, streams: [{ ...good.streams[0], ...change }] }), (error: any) => error.code === 'VIDEO_VALIDATION_FAILED');
  }
  assert.throws(() => validateVideoProbe({ ...good, format: { duration: '19.9' } }));
  assert.throws(() => validateVideoProbe({ ...good, streams: [...good.streams, { codec_type: 'audio' }] }));
});

test('the local video deadline aborts work with 504 while caller cancellation retains AbortError', async () => {
  const stopped = (signal: AbortSignal) => new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(withVideoDeadline(undefined, stopped, 10), (error: any) => error.status === 504 && error.code === 'VIDEO_LOCAL_TIMEOUT');
    const caller = new AbortController();
    const cancelled = withVideoDeadline(caller.signal, stopped, 1000);
    const rejected = assert.rejects(cancelled, { name: 'AbortError' });
    caller.abort(); await rejected;
  } finally { clearTimeout(keepAlive); }
});

test('running and queued video cancellation release shared pages and delete temporary encoding files', async () => {
  const prefix = `hackson-video-${process.pid}-`;
  const before = new Set((await readdir(os.tmpdir())).filter(name => name.startsWith(prefix)));
  const controller = new AbortController(); const queued = new AbortController();
  let notifyStarted!: () => void;
  const started = new Promise<void>(resolve => { notifyStarted = resolve; });
  const running = renderProductVideo({ ...input, signal: controller.signal, onProgress: progress => { if (progress.phase === 'frames') notifyStarted(); } });
  const runningRejected = assert.rejects(running, { name: 'AbortError' });
  await started;
  const pending = renderProductVideo({ ...input, signal: queued.signal });
  const queuedRejected = assert.rejects(pending, { name: 'AbortError' });
  queued.abort(); controller.abort();
  try {
    await Promise.all([runningRejected, queuedRejected]);
    assert.equal(renderRuntimeStats().activePages, 0);
    const remaining = (await readdir(os.tmpdir())).filter(name => name.startsWith(prefix) && !before.has(name));
    assert.deepEqual(remaining, []);
  } finally { controller.abort(); queued.abort(); await closeRenderRuntime(); }
});
