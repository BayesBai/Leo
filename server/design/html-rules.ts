import { DESIGN_SKILL_HASHES } from './rules.js';

/** Project adaptations of the pinned skills; no third-party scripts or publishing run. */
export const HTML_DESIGN_VERSION = 'virgo-html-1.0.0';
export const HTML_DESIGN_RULES = Object.freeze({
  page: { width: 1080, height: 1440, safeMargin: 64, minBodyPx: 32, minHeadingPx: 42, minCoverPx: 66 },
  wechat: { bodyPx: 17, lineHeight: 1.95, paragraphGap: 24, maxWidth: 680 },
  video: { width: 1080, height: 1920, fps: 30, seconds: 20, transitionSeconds: .65, safeMargin: 80 },
  motion: { ease: 'power2.out', properties: ['x', 'y', 'scale', 'autoAlpha'], maxScale: 1.035, deterministic: true },
  quality: ['one focal point per page', 'retain exact copy and conditions', 'contain original product images', 'no clipping or unreadable type', 'stable palette and safe margins', 'no audit labels in artwork'],
});
export const HTML_SKILL_HASHES = Object.freeze(Object.fromEntries(Object.entries(DESIGN_SKILL_HASHES).filter(([name]) => /^(premium-animations|ui-animation|gsap-skills|html-animation)\//.test(name))));
export function htmlDesignMetadata(platform: 'wechat' | 'xiaohongshu', templateId: string) {
  return { version: HTML_DESIGN_VERSION, platform, templateId, rules: HTML_DESIGN_RULES, skillHashes: HTML_SKILL_HASHES };
}
