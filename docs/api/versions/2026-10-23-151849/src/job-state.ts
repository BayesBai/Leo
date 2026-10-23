import type { BackgroundJob, RenderBundle } from '../shared/types';

export const pausedExternalDesign = (job: BackgroundJob) => job.error?.code === 'EXTERNAL_DESIGN_PAUSED' || job.input.kind === 'render' && (job.input.request.visualMode === 'canva' || job.input.request.canvaSync)
  || job.channels.some(channel => channel.stage.startsWith('canva_')) || /canva/i.test(job.error?.message || '');
export const oldVideoNeedsNewJob = (job: BackgroundJob) => job.kind === 'video' && job.error?.code === 'VIDEO_COPY_TOO_LONG' && !job.videoScript && !job.channels.some(channel => channel.videoScript);
export const newVideoWorkflow = (job: BackgroundJob) => job.kind === 'video' && (!!job.videoScript || job.channels.some(channel => !!channel.videoScript || ['video_script','video_review','video_repair','video_recheck'].includes(channel.stage)) || job.calls.some(call => ['video_script','video_review','video_repair','video_recheck'].includes(call.stage)));
export const videoNeedsRecovery = (job: BackgroundJob) => job.kind === 'video' && (['failed', 'interrupted'].includes(job.status) || job.status === 'cancelled' && newVideoWorkflow(job)) && !oldVideoNeedsNewJob(job);
export const canRetryJob = (job: BackgroundJob) => (['failed', 'interrupted'].includes(job.status) || job.status === 'cancelled' && newVideoWorkflow(job)) && job.error?.retryable !== false && !pausedExternalDesign(job) && !oldVideoNeedsNewJob(job);
export const visibleJobError = (job: BackgroundJob) => pausedExternalDesign(job) ? '旧外部设计流程已搁置。已保存内容仍可查看，请使用当前制作流程重新生成。' : job.error?.message;

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
