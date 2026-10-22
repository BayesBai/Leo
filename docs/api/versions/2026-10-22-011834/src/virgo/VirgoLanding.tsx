import { useEffect, useId, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import './landing.css';

gsap.registerPlugin(useGSAP);

export interface VirgoLandingProps {
  onStart: () => void;
  disabled?: boolean;
  returning?: boolean;
  transitioning?: boolean;
}

type LandingDialog = 'story' | 'flow' | 'menu' | null;
const motionPreferenceKey = 'virgo:landing:motion-paused';
let openingCompleted = false;

function savedMotionPreference() {
  try { return localStorage.getItem(motionPreferenceKey) === 'true'; }
  catch { return false; }
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The approved A3/A4 cover. Artwork and controls deliberately live on separate layers. */
export function VirgoLanding({ onStart, disabled = false, returning = false, transitioning = false }: VirgoLandingProps) {
  const root = useRef<HTMLElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const backgroundDepth = useRef<HTMLDivElement>(null);
  const figureDepth = useRef<HTMLDivElement>(null);
  const foregroundDepth = useRef<HTMLDivElement>(null);
  const botanicals = useRef<HTMLDivElement>(null);
  const dialogElement = useRef<HTMLDialogElement>(null);
  const playedOpening = useRef(false);
  const dialogTitleId = useId();
  const [paused, setPaused] = useState(() => returning || savedMotionPreference());
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [dialog, setDialog] = useState<LandingDialog>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const resize = () => {
      // The 1440 × 1000 artboard scales as one scene, preserving every artwork ratio.
      const { width, height } = element.getBoundingClientRect();
      const scale = Math.max(width / 1440, height / 1000);
      element.style.setProperty('--virgo-scene-scale', String(scale));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (returning) setPaused(true);
  }, [returning]);

  useEffect(() => {
    const element = dialogElement.current;
    if (!dialog || !element) return;
    if (!element.open) element.showModal();
    else element.querySelector<HTMLButtonElement>('[data-dialog-close]')?.focus();
  }, [dialog]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(min-width: 761px) and (prefers-reduced-motion: no-preference)', () => {
      if (paused) playedOpening.current = true;
      if (returning || paused || openingCompleted || playedOpening.current) return;
      const timeline = gsap.timeline({
        defaults: { ease: 'power2.out' },
        onComplete: () => {
          openingCompleted = true;
          playedOpening.current = true;
        },
      });
      timeline
        .fromTo('.virgo-landing__background-enter', { opacity: 0.65, y: 4 }, { opacity: 1, y: 0, duration: 1 }, 0)
        .fromTo('.virgo-landing__figure-enter', { opacity: 0.2, y: 6 }, { opacity: 1, y: 0, duration: 0.8 }, 0.2)
        .fromTo('.virgo-landing__foreground-enter', { opacity: 0.45, y: 4 }, { opacity: 1, y: 0, duration: 0.8 }, 0.12)
        .fromTo('.virgo-landing__intro-text', { opacity: 0.72, y: 4 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.08 }, 0.08);
      // The navigation and CTA are never part of a hidden or delayed entrance.
      const visibility = () => {
        if (document.hidden) timeline.pause();
        else timeline.resume();
      };
      document.addEventListener('visibilitychange', visibility);
      if (document.hidden) timeline.pause();
      return () => document.removeEventListener('visibilitychange', visibility);
    }, root);
    return () => media.revert();
  }, { scope: root, dependencies: [returning, paused], revertOnUpdate: true });

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(min-width: 761px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)', () => {
      if (paused || transitioning || dialog || !root.current || !botanicals.current) return;
      const element = root.current;
      const targets = [backgroundDepth.current, figureDepth.current, foregroundDepth.current];
      if (targets.some((target) => !target)) return;
      gsap.set(backgroundDepth.current, { scale: 1.004 });
      const layers = targets.map((target, index) => ({
        range: [2, 6, 10][index],
        x: gsap.quickTo(target, 'x', { duration: 0.65, ease: 'power3.out' }),
        y: gsap.quickTo(target, 'y', { duration: 0.65, ease: 'power3.out' }),
      }));
      const breeze = gsap.timeline({ repeat: -1, defaults: { ease: 'sine.inOut' } })
        .to(botanicals.current, { rotation: 0.18, x: 1.2, duration: 2 })
        .to(botanicals.current, { rotation: -0.18, x: -1.2, duration: 4 })
        .to(botanicals.current, { rotation: 0, x: 0, duration: 2 });
      let bounds = element.getBoundingClientRect();
      const resize = () => { bounds = element.getBoundingClientRect(); };
      const follow = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse' || document.hidden) return;
        const x = gsap.utils.clamp(-1, 1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2);
        const y = gsap.utils.clamp(-1, 1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2);
        for (const layer of layers) { layer.x(x * layer.range); layer.y(y * layer.range); }
      };
      const reset = () => { for (const layer of layers) { layer.x(0); layer.y(0); } };
      const visibility = () => {
        if (document.hidden) {
          breeze.pause();
          for (const layer of layers) { layer.x.tween.pause(); layer.y.tween.pause(); }
        } else {
          breeze.resume();
          reset();
        }
      };
      if (document.hidden) breeze.pause();
      element.addEventListener('pointermove', follow);
      element.addEventListener('pointerleave', reset);
      window.addEventListener('resize', resize);
      document.addEventListener('visibilitychange', visibility);
      return () => {
        element.removeEventListener('pointermove', follow);
        element.removeEventListener('pointerleave', reset);
        window.removeEventListener('resize', resize);
        document.removeEventListener('visibilitychange', visibility);
      };
    }, root);
    return () => media.revert();
  }, { scope: root, dependencies: [paused, transitioning, dialog], revertOnUpdate: true });

  useGSAP(() => {
    if (!transitioning) return;
    gsap.to(root.current, {
      autoAlpha: 0,
      duration: reducedMotion ? 0.08 : 0.35,
      ease: 'none',
    });
  }, { scope: root, dependencies: [transitioning, reducedMotion], revertOnUpdate: true });

  function toggleMotion() {
    setPaused((previous) => {
      const next = !previous;
      try { localStorage.setItem(motionPreferenceKey, String(next)); } catch { /* Current-page controls still work. */ }
      return next;
    });
  }

  function closeDialog() { dialogElement.current?.close(); }
  function start() {
    if (disabled) return;
    closeDialog();
    onStart();
  }

  return (
    <section className="virgo-landing" ref={root} aria-label="Virgo 拾穗" data-transitioning={transitioning || undefined}>
      <div className="virgo-landing__scene" ref={scene} aria-hidden="true">
        <div className="virgo-landing__background-depth" ref={backgroundDepth}>
          <div className="virgo-landing__background-enter">
            <img className="virgo-landing__background" src="/virgo/garden-gate-background.webp" alt="" fetchPriority="high" draggable={false} />
          </div>
        </div>
        <div className="virgo-landing__reading-shade" />
        <div className="virgo-landing__top-shade" />
        <div className="virgo-landing__figure-depth" ref={figureDepth}>
          <div className="virgo-landing__figure-enter">
            <div className="virgo-landing__contact-shadow"><img src="/virgo/contact-shadow.svg" alt="" width="366" height="54" draggable={false} /></div>
            <img className="virgo-landing__figure" src="/virgo/figure-no-wings.webp" alt="" width="1086" height="1448" draggable={false} />
          </div>
        </div>
        <div className="virgo-landing__foreground-depth" ref={foregroundDepth}>
          <div className="virgo-landing__foreground-enter">
            <div className="virgo-landing__botanicals" ref={botanicals}><img src="/virgo/foreground-botanicals.webp" alt="" width="1536" height="1024" draggable={false} /></div>
          </div>
        </div>
        <div className="virgo-landing__bottom-shade" />
      </div>

      <div className="virgo-landing__interface">
        <header className="virgo-landing__header">
          <div className="virgo-landing__brand" aria-label="Virgo">
            <img src="/virgo/wheat-light.svg" alt="" width="24" height="24" />
            <span>Virgo</span>
          </div>
          <nav className="virgo-landing__navigation" aria-label="封面导航">
            <button type="button" onClick={() => setDialog('story')}>品牌故事</button>
            <button type="button" onClick={() => setDialog('flow')}>创作流程</button>
            <button type="button" onClick={start} disabled={disabled}>开始创作</button>
          </nav>
          <button className="virgo-landing__menu-button" type="button" aria-haspopup="dialog" onClick={() => setDialog('menu')}>菜单</button>
        </header>

        <main className="virgo-landing__hero">
          <p className="virgo-landing__wordmark virgo-landing__intro-text" aria-hidden="true">Virgo</p>
          <h1 className="virgo-landing__slogan virgo-landing__intro-text"><span>把好产品，</span><span>讲得恰如其分。</span></h1>
          <p className="virgo-landing__description virgo-landing__intro-text"><span>为门店日常推广，整理思路、推敲文案，</span><span>准备各个渠道的内容。</span></p>
          <button className="virgo-landing__start" type="button" onClick={start} disabled={disabled}>开始创作</button>
        </main>

        <button className="virgo-landing__motion-toggle" type="button" onClick={toggleMotion} aria-pressed={paused || reducedMotion} disabled={reducedMotion} title={reducedMotion ? '已根据系统偏好减少动态' : undefined}>
          {reducedMotion ? '减少动态' : paused ? '恢复动景' : '暂停动景'}
        </button>
        <footer className="virgo-landing__footer">Virgo · 拾穗</footer>
      </div>

      <dialog className="virgo-landing__dialog" ref={dialogElement} aria-labelledby={dialogTitleId} onClose={() => setDialog(null)} onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
        <div className="virgo-landing__dialog-body">
          <h2 id={dialogTitleId}>{dialog === 'story' ? '温柔的秩序。' : dialog === 'flow' ? '从一个好问题开始。' : 'Virgo · 拾穗'}</h2>
          {dialog === 'story' && <div className="virgo-landing__story">
            <p>Virgo 相信，好的表达来自细致的理解。</p>
            <p>手持麦穗的仙女，把散落的资料耐心收拢，让不同的人得到适合自己的表达。</p>
            <p>她替忙碌的门店人员梳理思路、推敲措辞，让日常推广变得轻盈、体面、有分寸。</p>
          </div>}
          {dialog === 'flow' && <div className="virgo-landing__flow">
            <div><h3>填写需求</h3><p>选择产品、客户与渠道。</p></div>
            <div><h3>确认方案</h3><p>先把表达方向说定，再生成正文。</p></div>
            <div><h3>获取成品</h3><p>查看审核与来源，准备各渠道内容。</p></div>
          </div>}
          {dialog === 'menu' && <nav className="virgo-landing__menu-links" aria-label="封面菜单">
            <button type="button" onClick={() => setDialog('story')}>品牌故事</button>
            <button type="button" onClick={() => setDialog('flow')}>创作流程</button>
            <button type="button" onClick={start} disabled={disabled}>开始创作</button>
          </nav>}
          <div className="virgo-landing__dialog-actions">
            <button type="button" onClick={closeDialog} autoFocus data-dialog-close>返回画面</button>
            {dialog === 'flow' && <button type="button" className="virgo-landing__dialog-start" onClick={start} disabled={disabled}>开始创作</button>}
          </div>
        </div>
      </dialog>
    </section>
  );
}

export default VirgoLanding;
