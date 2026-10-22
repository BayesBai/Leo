import type { EvidenceBundle, Platform } from '../shared/types.js';

export const IMAGE_POLICIES: Record<Platform, { name: string; min: number; max: number }> = {
  wechat: { name: '公众号', min: 2, max: 4 },
  xiaohongshu: { name: '小红书', min: 3, max: 6 },
  moments: { name: '朋友圈', min: 1, max: 3 },
  poster: { name: '门店海报', min: 1, max: 1 },
};

export class ImagePolicyError extends Error {
  readonly status = 422;
}

export function assertChannelImageCount(platform: Platform, count: number) {
  const policy = IMAGE_POLICIES[platform];
  if (count < policy.min || count > policy.max) throw new ImagePolicyError(`${policy.name}需要 ${policy.min}–${policy.max} 张不同的同型号原图，当前 ${count} 张；请调整配图后重新保存确认。`);
}

/** Reject impossible channel requests before paying for a model outline or writer. */
export function assertEvidenceImageAvailability(platforms: Platform[], evidence: EvidenceBundle) {
  const count = new Set(evidence.images.filter(image => image.productId === evidence.product.id && image.sourceMode === evidence.sourceMode && !!image.url).map(image => image.id)).size;
  for (const platform of platforms) {
    const policy = IMAGE_POLICIES[platform];
    if (count < policy.min) throw new ImagePolicyError(`${policy.name}至少需要 ${policy.min} 张不同的同型号原图，当前仅取得 ${count} 张；请补足该型号素材或调整渠道后重新生成。`);
  }
}
