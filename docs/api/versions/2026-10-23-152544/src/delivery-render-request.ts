import type { ChannelDelivery, RenderRequest } from '../shared/types';

/** A poster has no title picker; keep its saved image visible under its original title version. */
export function viewableDeliveryBundle(delivery: ChannelDelivery, titleIndex: number, expired = false, now = Date.now()) {
  const bundle = delivery.bundle;
  return !expired && bundle && (delivery.platform === 'poster' || bundle.selectedTitleIndex === titleIndex) && Date.parse(bundle.expiresAt) > now ? bundle : undefined;
}

export type DeliveryRenderOperation = 'local' | 'html' | 'html-regenerate' | 'poster-image' | 'poster-regenerate';

/** One mapping serves direct delivery routes and the shared background job client. */
export function deliveryRenderOptions(operation: DeliveryRenderOperation): Pick<RenderRequest, 'visualMode' | 'canvaSync' | 'regenerateVisual'> {
  if (operation === 'html-regenerate') return { visualMode: 'html', regenerateVisual: true };
  if (operation === 'poster-regenerate') return { visualMode: 'poster-image', regenerateVisual: true };
  return { visualMode: operation };
}
