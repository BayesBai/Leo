import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { FairLimiter } from '../fair-limiter.js';
import { WorkflowError } from '../outlines.js';

// All HTML images and video frames share the same two page slots. A long-running
// video owns one slot only; an unrelated static render can continue in the other.
const slots = new FairLimiter(2);
let browserPromise: Promise<Browser> | undefined;
let active = 0;
let peak = 0;
let idle: ReturnType<typeof setTimeout> | undefined;

async function browser() {
  clearTimeout(idle);
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.cache/ms-playwright');
  if (!browserPromise) browserPromise = (async () => {
    const { chromium } = await import('playwright');
    const result = await chromium.launch({ headless: true, ...(process.platform === 'darwin' ? { channel: 'chromium' } : {}) });
    result.on('disconnected', () => { if (browserPromise === pending) browserPromise = undefined; });
    return result;
  })().catch(() => { browserPromise = undefined; throw new WorkflowError(503, '缺少 Chromium 渲染运行时，请先运行 npm run setup:render。'); });
  const pending = browserPromise;
  return pending;
}

export function renderRuntimeStats() { return { activePages: active, peakPages: peak, limit: 2 }; }

export async function closeRenderRuntime() {
  clearTimeout(idle);
  // Closing a shared process must never interrupt an unrelated task.
  if (active) return;
  const pending = browserPromise; browserPromise = undefined;
  await (await pending?.catch(() => undefined))?.close().catch(() => {});
}

export async function withRenderPage<T>(owner: string, viewport: { width: number; height: number }, signal: AbortSignal | undefined, operation: (page: Page) => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  const release = await slots.acquire(owner, signal);
  active++; peak = Math.max(peak, active); clearTimeout(idle);
  let context: BrowserContext | undefined;
  const abort = () => { void context?.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    context = await (await browser()).newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    signal?.throwIfAborted();
    const page = await context.newPage();
    const result = await operation(page);
    signal?.throwIfAborted();
    return result;
  } catch (error) { signal?.throwIfAborted(); throw error; }
  finally {
    signal?.removeEventListener('abort', abort);
    await context?.close().catch(() => {});
    active--; release();
    if (!active) {
      idle = setTimeout(() => { if (!active) void closeRenderRuntime(); }, process.env.NODE_ENV === 'test' ? 100 : 30_000);
      idle.unref();
    }
  }
}
