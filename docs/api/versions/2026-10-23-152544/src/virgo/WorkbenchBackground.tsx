import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { createAmbientPlayback, type AmbientPlaybackState } from './ambient-playback';

const desktopMotionQuery = '(min-width: 761px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
const touchQuery = '(any-pointer: coarse)';
const canUseVideo = () => window.matchMedia(desktopMotionQuery).matches && !window.matchMedia(touchQuery).matches;

export function useWorkbenchBackground(active: boolean) {
  const [eligible, setEligible] = useState(canUseVideo);
  const [entered, setEntered] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [userPaused, setUserPaused] = useState(false);
  const [playback, setPlayback] = useState<AmbientPlaybackState>({ hasFrame: false, blocked: false });
  const video = useRef<HTMLVideoElement | null>(null);
  const controller = useRef<ReturnType<typeof createAmbientPlayback> | null>(null);
  const enabled = eligible && entered;

  useEffect(() => {
    const desktop = window.matchMedia(desktopMotionQuery);
    const touch = window.matchMedia(touchQuery);
    const update = () => setEligible(desktop.matches && !touch.matches);
    desktop.addEventListener('change', update);
    touch.addEventListener('change', update);
    update();
    return () => { desktop.removeEventListener('change', update); touch.removeEventListener('change', update); };
  }, []);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => { if (active && eligible) setEntered(true); }, [active, eligible]);

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    const previous = video.current;
    video.current = element;
    if (previous && previous !== element) queueMicrotask(() => {
      // React StrictMode may detach and reattach the same element synchronously.
      if (video.current !== previous) { previous.pause(); previous.removeAttribute('src'); previous.load(); }
    });
  }, []);
  useEffect(() => {
    if (!enabled) { setPlayback({ hasFrame: false, blocked: false }); return; }
    if (!video.current) return;
    const next = createAmbientPlayback(video.current, setPlayback);
    controller.current = next;
    return () => { next.destroy(); if (controller.current === next) controller.current = null; };
  }, [enabled]);
  useEffect(() => { controller.current?.update({ active, visible, userPaused }); }, [active, visible, userPaused, enabled]);

  function toggle() {
    if (userPaused || playback.blocked) {
      setUserPaused(false);
      controller.current?.resume({ active, visible, userPaused: false });
    } else {
      setUserPaused(true);
      controller.current?.update({ active, visible, userPaused: true });
    }
  }

  return { enabled, eligible, attachVideo, revealed: enabled && playback.hasFrame && !playback.blocked, paused: userPaused || playback.blocked, blocked: playback.blocked, toggle };
}

type Background = ReturnType<typeof useWorkbenchBackground>;

export function WorkbenchBackground({ background }: { background: Background }) {
  if (!background.enabled) return null;
  return <video ref={background.attachVideo} className="workbench-background-video" data-revealed={background.revealed}
    src="/virgo/wheat-workbench-loop.mp4" poster="/virgo/wheat-workbench-poster.webp"
    muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} />;
}

export function WorkbenchBackgroundControl({ background }: { background: Background }) {
  if (!background.eligible) return null;
  return <button type="button" className="ghost workbench-background-control" aria-pressed={background.paused}
    onClick={background.toggle} title={background.blocked ? '背景未能播放，当前显示静帧。点击重试。' : undefined}>
    {background.paused ? <Play size={16} /> : <Pause size={16} />}{background.paused ? '恢复背景' : '暂停背景'}
  </button>;
}
