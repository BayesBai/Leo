import { randomUUID } from 'node:crypto';
import type { BackgroundJob, ChannelDelivery, Draft, OutlineResult, Platform, RenderBundle, ReviewReport, RunResult } from '../shared/types.js';
import { stateStore, HISTORY_TTL } from './state-store.js';
import { captureEvidenceBinding, evidenceStatus, restoreEvidenceBinding, assertEvidenceCurrent, type EvidenceBinding } from './knowledge.js';
import { WorkflowError, publicOutline } from './outlines.js';
import { getRunBundles, copyDraft, readable } from './render/index.js';
import { reusableEvidence } from './pipeline.js';
interface SavedDelivery { delivery: ChannelDelivery; snapshot: OutlineResult; binding?: EvidenceBinding }
export function saveDelivery(input: { runId: string; jobId?: string; outline: OutlineResult; draft: Draft; review: ReviewReport; createdAt?: string }): ChannelDelivery {
  const old = stateStore().entries<SavedDelivery>('deliveries').map(([, s]) => s).find(s => s.delivery.runId === input.runId && s.delivery.platform === input.draft.platform && s.delivery.revision === 1);
  if (old) return deliveryDetail(old.delivery.id);
  const createdAt = input.createdAt || new Date().toISOString();
  const result = { evidence: input.outline.evidence, product: input.outline.product } as RunResult;
  const delivery: ChannelDelivery = { id: randomUUID(), runId: input.runId, jobId: input.jobId, platform: input.draft.platform, revision: 1,
    createdAt, updatedAt: createdAt, expiresAt: new Date(Date.parse(createdAt) + HISTORY_TTL).toISOString(), product: input.outline.product,
    brief: { ...input.outline.brief, platforms: [input.draft.platform] }, draft: input.draft, review: input.review,
    outline: { id: input.outline.id, version: input.outline.version }, status: input.review.status === 'blocked' ? 'blocked' : 'visual_pending',
    copyText: input.draft.platform === 'poster' || input.review.status === 'blocked' ? '' : readable(copyDraft(input.draft, input.draft.titles[0]), result), evidenceStatus: evidenceStatus(input.outline.evidence) };
  stateStore().set<SavedDelivery>('deliveries', delivery.id, { delivery, snapshot: publicOutline(input.outline), binding: captureEvidenceBinding(input.outline.evidence) });
  return delivery;
}
export function deliveryDetail(id: string): ChannelDelivery {
  const saved = savedDelivery(id);
  const valid = getRunBundles(saved.delivery.runId, true).filter(b => b.platform === saved.delivery.platform && b.deliveryId === id && (b.rendererVersion || 0) >= 3);
  const bundle = valid.find(b => b.kind !== 'video' && b.id === saved.delivery.bundle?.id) || valid.filter(b => b.kind !== 'video').sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt))[0];
  const videoBundle = valid.find(b => b.kind === 'video' && b.id === saved.delivery.videoBundle?.id) || valid.filter(b => b.kind === 'video').sort((a,b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt))[0];
  return { ...saved.delivery, copyText:saved.delivery.platform==='poster'?'':saved.delivery.copyText, posterApproval:bundle?.posterApproval || saved.delivery.posterApproval, evidenceStatus: evidenceStatus(saved.snapshot.evidence), bundle, videoBundle,
    status: saved.delivery.review.status === 'blocked' ? 'blocked' : bundle?.publication === 'released' ? 'ready' : 'visual_pending' };
}
function savedDelivery(id: string) {
  const saved = stateStore().get<SavedDelivery>('deliveries', id);
  if (!saved || Date.parse(saved.delivery.expiresAt) <= Date.now()) throw new WorkflowError(410, '渠道交付已超过七天留存期或不存在。');
  restoreEvidenceBinding(saved.snapshot.evidence, saved.binding); return saved;
}
export function deliveryRenderSource(id: string, requireCurrent = true): RunResult {
  const { delivery: d, snapshot } = savedDelivery(id);
  if (requireCurrent) { assertEvidenceCurrent(snapshot.evidence); if (!reusableEvidence(snapshot.evidence)) throw new WorkflowError(410, '来源已过期，请重新取证。已保存的渠道正文仍可阅读。'); }
  return { id: d.runId, createdAt: d.createdAt, brief: d.brief, product: d.product, evidence: snapshot.evidence, drafts: [d.draft], review: d.review, strategies: [], trace: [], revision: d.revision, outline: d.outline, notice: '本渠道独立审核与交付。' };
}
export function updateDeliveryBundle(id: string, bundle: RenderBundle): ChannelDelivery {
  const saved = savedDelivery(id);
  if(bundle.posterApproval&&saved.delivery.bundle?.posterApproval&&bundle.id!==saved.delivery.bundle.id){
    // A resumed older job may still own a successful candidate checkpoint. It
    // can return that artifact without replacing a more recent poster choice.
    const order=stateStore().entries<RenderBundle>('renderBundles').filter(([,value])=>value.deliveryId===id&&!!value.posterApproval).map(([key])=>key);
    if(order.indexOf(saved.delivery.bundle.id)>order.indexOf(bundle.id))return deliveryDetail(id);
  }
  if (bundle.kind === 'video') saved.delivery.videoBundle = bundle;
  else { saved.delivery.bundle = bundle; saved.delivery.externalDesigns = bundle.externalDesigns; saved.delivery.posterApproval=bundle.posterApproval; }
  saved.delivery.updatedAt = new Date().toISOString(); stateStore().set('deliveries', id, saved); return deliveryDetail(id);
}
export function revokeDelivery(id: string) {
  const saved = savedDelivery(id); saved.delivery.review = { ...saved.delivery.review, status: 'blocked', issues: [...saved.delivery.review.issues,
    { id: 'canva-content-changed', severity: 'error', category: 'source', message: 'Canva 中的文字或产品素材发生变化，请重新核对并审稿。', suggestion: '返回已确认大纲创建新版本后重新生成。', platform: saved.delivery.platform, resolution: 'edit_outline' }] };
  saved.delivery.copyText = ''; saved.delivery.status = 'blocked';saved.delivery.updatedAt=new Date().toISOString(); stateStore().set('deliveries', id, saved);
  // A missing sibling file must not hide the surviving MP4/ZIP from revocation.
  const ids = stateStore().entries<RenderBundle>('renderBundles').map(([,bundle])=>bundle).filter(b => b.deliveryId === id || b.runId===saved.delivery.runId&&b.platform===saved.delivery.platform).map(b => b.id);
  stateStore().update(b => { for (const [key, a] of Object.entries(b.renderAssets || {})) if (ids.includes((a as {group:string}).group)) b.renderAssets[key] = { ...(a as object), exportable: false }; for (const bid of ids) { const item = b.renderBundles?.[bid] as RenderBundle; if(item) b.renderBundles[bid] = {...item,publication:'blocked',copyText:'',zipUrl:undefined,artifacts:item.artifacts.map(({downloadUrl: _d,...a})=>a)}; } });
  return deliveryDetail(id);
}
export function deliveriesForRun(runId: string) { return stateStore().entries<SavedDelivery>('deliveries').filter(([,s])=>s.delivery.runId===runId && Date.parse(s.delivery.expiresAt)>Date.now()).map(([id])=>deliveryDetail(id)); }
/** Lazy compatibility migration is read-only with respect to old job outputs and never pays a model. */
export function hydrateJobDeliveries(job: BackgroundJob): BackgroundJob {
  for (const channel of job.channels) {
    let d = stateStore().entries<SavedDelivery>('deliveries').find(([,s])=>s.delivery.jobId===job.id && s.delivery.platform===channel.platform);
    if (!d && !job.deliveryVersion && job.outline && channel.preview?.draft && channel.preview.review) {
      const created = saveDelivery({runId: channel.preview.bundle?.runId || job.result?.id || job.id,jobId:job.id,outline:job.outline,draft:channel.preview.draft,review:channel.preview.review,createdAt:job.createdAt});
      d = [created.id, savedDelivery(created.id)];
    }
    if(d) { channel.deliveryId=d[0]; if(job.detailOmitted)continue;channel.delivery=deliveryDetail(d[0]); if(channel.preview && channel.delivery.bundle) channel.preview.bundle=channel.delivery.bundle; }
  }
  return job;
}
export function allDeliveries() { return stateStore().entries<SavedDelivery>('deliveries').filter(([,s])=>Date.parse(s.delivery.expiresAt)>Date.now()).map(([id])=>deliveryDetail(id)); }

export function updateDeliveryDesigns(id:string,designs:NonNullable<ChannelDelivery["externalDesigns"]>){const saved=savedDelivery(id);saved.delivery.externalDesigns=designs;saved.delivery.updatedAt=new Date().toISOString();stateStore().set("deliveries",id,saved);return deliveryDetail(id);}
