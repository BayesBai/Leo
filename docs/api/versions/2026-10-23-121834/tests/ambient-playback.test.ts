import test from 'node:test';
import assert from 'node:assert/strict';
import { createAmbientPlayback, type AmbientPlaybackIntent, type AmbientPlaybackState } from '../src/virgo/ambient-playback.js';

const visible: AmbientPlaybackIntent = { active: true, visible: true, userPaused: false };
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

class Media extends EventTarget {
  requests: { resolve: () => void; reject: (error: Error) => void }[] = [];
  pauses = 0;
  loads = 0;
  currentTime = 3.25;
  play() { return new Promise<void>((resolve, reject) => { this.requests.push({ resolve, reject }); }); }
  pause() { this.pauses++; }
  load() { this.loads++; }
  fire(name: string) { this.dispatchEvent(new Event(name)); }
}

function setup() {
  const media = new Media(); const states: AmbientPlaybackState[] = [];
  const controller = createAmbientPlayback(media, state => states.push(state));
  return { media, states, controller };
}

test('ambience starts only for an active visible page and reveals a real playing frame', async () => {
  const { media, states, controller } = setup();
  assert.equal(media.requests.length, 0);
  controller.update({ ...visible, active: false });
  controller.update({ ...visible, visible: false });
  assert.equal(media.requests.length, 0);
  controller.update(visible); controller.update(visible);
  assert.equal(media.requests.length, 1, 'rerenders do not issue another pending play');
  media.requests[0].resolve(); await settle();
  assert.equal(states.at(-1)?.hasFrame, false, 'a fulfilled play promise alone is not a decoded frame');
  media.fire('playing');
  assert.deepEqual(states.at(-1), { hasFrame: true, blocked: false });
  controller.update(visible);
  assert.equal(media.requests.length, 1, 'step updates keep the playing element');
  controller.destroy();
});

test('manual pause survives hiding and returning while automatic pause preserves the playback point', () => {
  const { media, states, controller } = setup();
  controller.update(visible); media.fire('playing');
  controller.update({ ...visible, visible: false }); controller.update(visible);
  assert.equal(media.requests.length, 2);
  media.fire('playing');
  controller.update({ ...visible, userPaused: true });
  controller.update({ ...visible, active: false, userPaused: true });
  controller.update({ ...visible, userPaused: true });
  assert.equal(media.requests.length, 2, 'returning does not override the user');
  assert.equal(media.currentTime, 3.25);
  assert.equal(states.at(-1)?.hasFrame, true, 'manual pause keeps the last frame');
  assert.equal(media.loads, 0);
  controller.destroy();
});

test('a late play fulfillment cannot restart a background after the page has hidden', async () => {
  const { media, states, controller } = setup();
  controller.update(visible);
  controller.update({ ...visible, visible: false });
  const before = media.pauses;
  media.requests[0].resolve(); await settle();
  assert.equal(media.pauses, before + 1);
  media.fire('playing');
  assert.equal(states.at(-1)?.hasFrame, false);
  controller.destroy();
});

test('autoplay denial falls back without route-triggered retries; manual resume plays synchronously', async () => {
  const { media, states, controller } = setup();
  controller.update(visible);
  media.requests[0].reject(new Error('NotAllowedError')); await settle();
  assert.deepEqual(states.at(-1), { hasFrame: false, blocked: true });
  controller.update({ ...visible, visible: false }); controller.update(visible); controller.update(visible);
  assert.equal(media.requests.length, 1);
  controller.resume(visible);
  assert.equal(media.requests.length, 2, 'play happens inside the user gesture, before a new render');
  assert.equal(media.loads, 0, 'policy denial does not redownload the file');
  media.fire('playing');
  assert.equal(states.at(-1)?.blocked, false);
  controller.destroy();
});

test('media failure keeps the static fallback until one explicit reload and retry', () => {
  const { media, states, controller } = setup();
  controller.update(visible); media.fire('playing'); media.fire('error');
  assert.deepEqual(states.at(-1), { hasFrame: false, blocked: true });
  controller.update(visible); controller.update({ ...visible, active: false }); controller.update(visible);
  assert.equal(media.requests.length, 1); assert.equal(media.loads, 0);
  controller.resume(visible);
  assert.equal(media.loads, 1); assert.equal(media.requests.length, 2);
  controller.destroy();
});

test('an aborted attempt rejection cannot mark a later user-initiated playback as blocked', async () => {
  const { media, states, controller } = setup();
  controller.update(visible);
  controller.update({ ...visible, userPaused: true });
  controller.resume(visible); media.fire('playing');
  media.requests[0].reject(new Error('AbortError')); await settle();
  assert.deepEqual(states.at(-1), { hasFrame: true, blocked: false });
  controller.destroy();
});

test('StrictMode cleanup cannot let an obsolete controller pause its replacement', async () => {
  const { media, controller } = setup();
  controller.update(visible); controller.destroy();
  const states: AmbientPlaybackState[] = [];
  const replacement = createAmbientPlayback(media, state => states.push(state));
  replacement.update(visible); media.fire('playing');
  const before = media.pauses;
  media.requests[0].resolve(); await settle();
  assert.equal(media.pauses, before);
  assert.deepEqual(states.at(-1), { hasFrame: true, blocked: false });
  replacement.destroy();
});

test('a late play event after teardown is paused without publishing into an unmounted component', async () => {
  const { media, states, controller } = setup();
  controller.update(visible); controller.destroy();
  const before = states.length; const pauses = media.pauses;
  media.requests[0].resolve(); await settle(); media.fire('playing');
  assert.equal(media.pauses, pauses + 1);
  assert.equal(states.length, before);
});
