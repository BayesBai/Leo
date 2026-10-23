import type { RenderRequest } from '../shared/types';

export type DeliveryRenderOperation = 'local' | 'html' | 'canva' | 'sync' | 'regenerate' | 'html-regenerate';

/** One mapping serves direct delivery routes and the shared background job client. */
export function deliveryRenderOptions(operation: DeliveryRenderOperation): Pick<RenderRequest, 'visualMode' | 'canvaSync' | 'regenerateVisual'> {
  if (operation === 'sync') return { canvaSync: true };
  if (operation === 'html-regenerate') return { visualMode: 'html', regenerateVisual: true };
  if (operation === 'regenerate') return { visualMode: 'canva', regenerateVisual: true };
  return { visualMode: operation };
}
