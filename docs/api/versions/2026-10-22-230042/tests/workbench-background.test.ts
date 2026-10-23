import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { WorkbenchBackground, WorkbenchBackgroundControl, useWorkbenchBackground } from '../src/virgo/WorkbenchBackground.js';
import { focusWorkbenchMain } from '../src/virgo/workbench-focus.js';

function Harness({ active, step = 1 }: { active: boolean; step?: number }) {
  const background = useWorkbenchBackground(active);
  React.useEffect(() => { if (active) focusWorkbenchMain(document.getElementById('workbench-main')); }, [step]);
  return React.createElement('div', null,
    React.createElement(WorkbenchBackground, { background }),
    React.createElement(WorkbenchBackgroundControl, { background }),
    React.createElement('main', { id: 'workbench-main', tabIndex: -1, key: step }, String(step)));
}

async function environment(eligible: boolean, run: (env: {
  document: Document;
  render: (active: boolean, step?: number) => Promise<void>;
  media: (desktop: boolean, touch: boolean) => Promise<void>;
  reduce: (reduced: boolean) => Promise<void>;
  visibility: (hidden: boolean) => Promise<void>;
  plays: HTMLVideoElement[];
}) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const originals = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let desktop = eligible; let touch = false; let hidden = false; let reduced = false;
  const queries = new Map<string, EventTarget>();
  dom.window.matchMedia = (query: string) => {
    if (!queries.has(query)) {
      const result = new dom.window.EventTarget();
      Object.defineProperty(result, 'matches', { get: () => query.includes('any-pointer') ? touch : desktop && (!query.includes('prefers-reduced-motion: no-preference') || !reduced) });
      queries.set(query, result);
    }
    return queries.get(query) as MediaQueryList;
  };
  Object.defineProperty(dom.window.document, 'hidden', { get: () => hidden });
  const plays: HTMLVideoElement[] = [];
  dom.window.HTMLMediaElement.prototype.play = function () {
    plays.push(this as HTMLVideoElement);
    this.dispatchEvent(new dom.window.Event('playing'));
    return Promise.resolve();
  };
  dom.window.HTMLMediaElement.prototype.pause = function () {};
  dom.window.HTMLMediaElement.prototype.load = function () {};
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await run({
      document: dom.window.document,
      plays,
      render: async (active, step) => { await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Harness, { active, step }))); }); },
      media: async (nextDesktop, nextTouch) => { await act(async () => { desktop = nextDesktop; touch = nextTouch; queries.forEach(query => query.dispatchEvent(new dom.window.Event('change'))); }); },
      reduce: async next => { await act(async () => { reduced = next; queries.forEach(query => query.dispatchEvent(new dom.window.Event('change'))); }); },
      visibility: async next => { await act(async () => { hidden = next; dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange')); }); },
    });
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    keys.forEach((key, i) => { const descriptor = originals[i]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
  }
}

test('workbench keeps one video across keyed steps and homepage visits, preserving user pause', async () => {
  await environment(true, async ({ document, render, plays, visibility }) => {
    await render(false);
    assert.equal(document.querySelector('video'), null, 'cover entry does not attach a video source');
    await render(true);
    const video = document.querySelector('video')!;
    assert.ok(video);
    assert.equal(video.getAttribute('preload'), 'none');
    assert.equal(video.muted, true);
    assert.equal(video.loop, true);
    assert.equal(video.playsInline, true);
    assert.equal(video.dataset.revealed, 'true');
    const initialPlays = plays.length;
    video.currentTime = 4.25;
    await render(true, 5); await render(true, 6);
    assert.equal(document.querySelector('video'), video);
    assert.equal(plays.length, initialPlays);
    await render(false, 6); await render(true, 6);
    assert.equal(document.querySelector('video'), video);
    assert.equal(video.currentTime, 4.25);
    assert.equal(plays.length, initialPlays + 1);
    await act(async () => { document.querySelector('button')!.click(); });
    assert.equal(document.querySelector('button')!.textContent, '恢复背景');
    const pausedPlays = plays.length;
    await visibility(true); await render(false, 6); await visibility(false); await render(true, 1);
    assert.equal(plays.length, pausedPlays, 'automatic return respects manual pause');
    await act(async () => { document.querySelector('button')!.click(); });
    assert.equal(plays.length, pausedPlays + 1);
  });
});

test('ineligible devices never attach MP4; losing motion eligibility releases the media source', async () => {
  await environment(false, async ({ document, render, media, reduce, plays }) => {
    await render(true);
    assert.equal(document.querySelector('video'), null);
    assert.equal(document.querySelector('button'), null);
    assert.equal(plays.length, 0);
    await media(true, true);
    assert.equal(document.querySelector('video'), null, 'fine pointer plus touch still uses the static frame');
    await media(true, false);
    const video = document.querySelector('video')!;
    assert.ok(video?.src.endsWith('/virgo/wheat-workbench-loop.mp4'));
    await act(async () => { document.querySelector('button')!.click(); });
    const manuallyPaused = plays.length;
    await media(false, false);
    assert.equal(document.querySelector('video'), null);
    assert.equal(video.getAttribute('src'), null, 'detached media releases the network resource');
    assert.equal(document.querySelector('button'), null);
    await media(true, false);
    assert.notEqual(document.querySelector('video'), video);
    assert.equal(document.querySelector('button')!.textContent, '恢复背景');
    assert.equal(plays.length, manuallyPaused, 'device changes do not discard user pause');
    await act(async () => { document.querySelector('button')!.click(); });
    const beforeReduce = document.querySelector('video')!;
    await reduce(true);
    assert.equal(document.querySelector('video'), null);
    assert.equal(beforeReduce.getAttribute('src'), null);
    assert.equal(document.querySelector('button'), null);
    await reduce(false);
    assert.ok(document.querySelector('video'));
  });
});

test('visibility changes pause automatically and errors require an explicit recovery action', async () => {
  await environment(true, async ({ document, render, plays, visibility }) => {
    await render(true);
    const before = plays.length;
    await visibility(true); await visibility(false);
    assert.equal(plays.length, before + 1);
    const video = document.querySelector('video')!;
    await act(async () => { video.dispatchEvent(new window.Event('error')); });
    assert.equal(video.dataset.revealed, 'false');
    assert.equal(document.querySelector('button')!.textContent, '恢复背景');
    const failedPlays = plays.length;
    await render(false); await render(true);
    assert.equal(plays.length, failedPlays, 'navigation does not repeatedly retry a failed resource');
    await act(async () => { document.querySelector('button')!.click(); });
    assert.equal(plays.length, failedPlays + 1);
    assert.equal(video.dataset.revealed, 'true');
  });
});

test('an asynchronous step change preserves background-control focus and keeps normal main focus behavior', async () => {
  await environment(true, async ({ document, render }) => {
    await render(true);
    assert.equal(document.activeElement, document.querySelector('main'));
    const control = document.querySelector('button')!;
    control.focus();
    await render(true, 5);
    assert.equal(document.activeElement, control, 'background completion cannot steal a keyboard interaction');
    await act(async () => { control.click(); });
    assert.equal(control.textContent, '恢复背景');
    document.querySelector('main')!.focus();
    const previousMain = document.activeElement;
    await render(true, 6);
    assert.equal(document.activeElement, document.querySelector('main'), 'ordinary transitions still focus the new reading area');
    assert.notEqual(document.activeElement, previousMain);
  });
});
