import type { BackgroundJob, RenderBundle } from '../shared/types';

/** Terminal events are compact. A current full detail can be retained only for that exact revision. */
export function mergeJobSnapshot(current: BackgroundJob[], snapshot: BackgroundJob[]) {
  const known = new Map(current.map(job => [job.id, job]));
  return snapshot.map(job => {
    const saved = known.get(job.id);
    if (saved && saved.updatedAt > job.updatedAt) return saved;
    return job.detailOmitted && saved && !saved.detailOmitted && saved.updatedAt === job.updatedAt && saved.status === job.status ? saved : job;
  });
}

const bundleIdentity = (bundle: RenderBundle) => `${bundle.runId}:${bundle.revision}:${bundle.platform}:${bundle.selectedTitleIndex}:${bundle.templateId}:${bundle.reviewStatus}:${bundle.kind || 'static'}`;
/** A published rendition supersedes the pending rendition of the same immutable render input. */
export function mergeJobBundles(current: RenderBundle[], incoming: RenderBundle[]) {
  const entries = new Map<string, RenderBundle>();
  for (const bundle of [...current, ...incoming]) {
    const key = bundleIdentity(bundle); const previous = entries.get(key);
    if (previous && previous.publication !== 'preview' && bundle.publication === 'preview' && Date.parse(previous.expiresAt) > Date.now()) continue;
    entries.set(key, bundle);
  }
  return [...entries.values()];
}
