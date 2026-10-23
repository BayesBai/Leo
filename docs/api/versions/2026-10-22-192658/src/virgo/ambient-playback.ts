export interface AmbientPlaybackIntent {
  active: boolean;
  visible: boolean;
  userPaused: boolean;
}

export interface AmbientPlaybackState { hasFrame: boolean; blocked: boolean }

type AmbientMedia = Pick<HTMLVideoElement, 'play' | 'pause' | 'load' | 'addEventListener' | 'removeEventListener'>;
const owners = new WeakMap<AmbientMedia, symbol>();

/** Keeps browser playback promises subordinate to the current page and user intent. */
export function createAmbientPlayback(media: AmbientMedia, report: (state: AmbientPlaybackState) => void) {
  const owner = Symbol('ambient-playback');
  owners.set(media, owner);
  let intent: AmbientPlaybackIntent = { active: false, visible: false, userPaused: false };
  let state: AmbientPlaybackState = { hasFrame: false, blocked: false };
  let disposed = false;
  let attempt = 0;
  let pending = false;
  let running = false;
  let mediaFailed = false;
  const ownsMedia = () => owners.get(media) === owner;
  const wantsPlayback = () => intent.active && intent.visible && !intent.userPaused;
  function publish(next: AmbientPlaybackState) {
    state = next;
    if (!disposed && ownsMedia()) report(next);
  }
  function stop() {
    attempt++;
    pending = false;
    running = false;
    if (ownsMedia()) media.pause();
  }
  function fail(token: number) {
    if (disposed || !ownsMedia() || token !== attempt || !wantsPlayback()) return;
    pending = false;
    running = false;
    media.pause();
    publish({ hasFrame: false, blocked: true });
  }
  function play() {
    if (disposed || !ownsMedia() || !wantsPlayback() || state.blocked || pending || running) return;
    const token = ++attempt;
    pending = true;
    try {
      void Promise.resolve(media.play()).then(() => {
        if (!ownsMedia()) return;
        if (disposed || !wantsPlayback()) { media.pause(); return; }
        if (token !== attempt) return;
        pending = false;
        // Only the browser's playing event reveals the video, not Promise resolution.
      }, () => fail(token));
    } catch { fail(token); }
  }
  const playing = () => {
    if (disposed || !ownsMedia() || !wantsPlayback() || state.blocked) { if (ownsMedia()) media.pause(); return; }
    pending = false;
    running = true;
    mediaFailed = false;
    publish({ hasFrame: true, blocked: false });
  };
  const error = () => {
    if (disposed || !ownsMedia()) return;
    stop();
    mediaFailed = true;
    publish({ hasFrame: false, blocked: true });
  };
  media.addEventListener('playing', playing);
  media.addEventListener('error', error);
  publish(state);
  return {
    update(next: AmbientPlaybackIntent) {
      intent = next;
      if (!wantsPlayback()) stop();
      else play();
    },
    resume(next: AmbientPlaybackIntent) {
      if (disposed || !ownsMedia()) return;
      intent = next;
      publish({ ...state, blocked: false });
      if (mediaFailed) { mediaFailed = false; media.load(); }
      // Called synchronously by the button handler to retain user activation.
      play();
    },
    destroy() {
      disposed = true;
      stop();
      media.removeEventListener('playing', playing);
      media.removeEventListener('error', error);
    },
  };
}
