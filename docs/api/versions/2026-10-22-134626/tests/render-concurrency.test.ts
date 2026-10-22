import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { closeRenderRuntime, renderXhs } from '../server/render/layouts.js';

const template = { id: 'xhs-cream', platform: 'xiaohongshu' as const, name: '纯模拟模板', width: 1080, height: 1440 };
const card = { heading: '并发排版测试', text: '完整保留正文与限定条件。', images: [], factIds: [], role: 'card' as const };
test('cancelling one isolated XHS context does not close another job sharing Chromium', async () => {
  const controller = new AbortController();
  const cancelled = renderXhs(Array.from({ length: 4 }, () => card), template, '审核中，仅供预览', '模拟机型A', controller.signal);
  // Attach rejection handling before cancellation can happen during the cold browser launch.
  const rejected = assert.rejects(cancelled);
  const success = renderXhs([card, card], template, '审核中，仅供预览', '模拟机型B');
  const timer = setTimeout(() => controller.abort(), 250);
  try {
    await rejected; const pages = await success;
    assert.equal(pages.length, 2);
    const image = await sharp(pages[0]).metadata(); assert.equal(image.width, 1080); assert.equal(image.height, 1440);
  } finally { clearTimeout(timer); await closeRenderRuntime(); }
});
