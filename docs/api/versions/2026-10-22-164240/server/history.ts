import type { EvidenceBundle, HistoryItem, OutlineResult, RunDetail, RunResult } from '../shared/types.js';
import { assertEvidenceCurrent, captureEvidenceBinding, evidenceStatus, restoreEvidenceBinding, releaseExpiredMedia, type EvidenceBinding } from './knowledge.js';
import { outlineHistory, publicOutline, WorkflowError } from './outlines.js';
import { publicResult } from './pipeline.js';
import { getRunBundles } from './render/index.js';
import { HISTORY_TTL, stateStore, wasInterrupted } from './state-store.js';
import { unlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import { renderDirectory } from './render/path.js';

interface SavedRun { result: RunResult; canonicalEvidence: EvidenceBundle; outlineSnapshot?: OutlineResult; expiresAt: number; updatedAt: number; binding?: EvidenceBinding }
export function saveRun(result: RunResult, canonicalEvidence = result.evidence, outline?: OutlineResult) {
  const evidence = { ...canonicalEvidence, sources: canonicalEvidence.sources.map(({ text: _text, ...s }) => s) };
  const snapshot = outline ? publicOutline(outline) : undefined; if (snapshot) delete snapshot.history;
  stateStore().set<SavedRun>('runs', result.id, { result: publicResult(result), canonicalEvidence: evidence, outlineSnapshot: snapshot, expiresAt: Date.parse(result.createdAt) + HISTORY_TTL, updatedAt: Date.now(), binding: captureEvidenceBinding(canonicalEvidence) });
}
export function getSavedRun(id: string, requireCurrent = false): SavedRun {
  const saved = stateStore().get<SavedRun>('runs', id);
  if (!saved || saved.expiresAt <= Date.now()) throw new WorkflowError(410, '正文已超过七天留存期或不存在，请重新生成。');
  restoreEvidenceBinding(saved.result.evidence, saved.binding); restoreEvidenceBinding(saved.canonicalEvidence, saved.binding);
  if (saved.outlineSnapshot) restoreEvidenceBinding(saved.outlineSnapshot.evidence, saved.binding);
  if (requireCurrent) assertEvidenceCurrent(saved.canonicalEvidence);
  return saved;
}
export function runDetail(id: string): RunDetail {
  const saved = getSavedRun(id);
  return { result: saved.result, outlineSnapshot: saved.outlineSnapshot,
    history: { expiresAt: new Date(saved.expiresAt).toISOString(), evidenceStatus: evidenceStatus(saved.canonicalEvidence), ...(wasInterrupted(id) ? { interrupted: true } : {}) }, renderBundles: getRunBundles(id) };
}
export function historyItems(): HistoryItem[] {
  const runs = stateStore().entries<SavedRun>('runs').filter(([, e]) => e.expiresAt > Date.now()).map(([id, e]): HistoryItem => {
    restoreEvidenceBinding(e.canonicalEvidence, e.binding);
    return { kind: 'run', id, productName: e.result.product.name, audience: e.result.brief.audience, scene: e.result.brief.scene, platforms: e.result.brief.platforms,
      createdAt: e.result.createdAt, updatedAt: new Date(e.updatedAt).toISOString(), expiresAt: new Date(e.expiresAt).toISOString(), revision: e.result.revision, reviewStatus: e.result.review.status, evidenceStatus: evidenceStatus(e.canonicalEvidence), ...(wasInterrupted(id) ? { interrupted: true } : {}) };
  });
  return [...outlineHistory(), ...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function pruneHistory() {
  releaseExpiredMedia();
  const expired = ['outlines', 'runs'].flatMap(bucket => stateStore().entries<{ expiresAt: number }>(bucket).filter(([, e]) => e.expiresAt <= Date.now()).map(([id]) => ({ bucket, id })));
  const media = stateStore().entries<{ kind: string; expiresAt?: number }>('knowledgeAssets').filter(([, a]) => a.kind === 'ima' && (a.expiresAt || 0) <= Date.now()).map(([id]) => id);
  const groups = stateStore().entries<{ expiresAt: string }>('renderBundles').filter(([, b]) => Date.parse(b.expiresAt) <= Date.now()).map(([id]) => id);
  const expiredJobs = stateStore().entries<{ job: { expiresAt: string } }>('jobs').filter(([, r]) => r?.job && Date.parse(r.job.expiresAt) <= Date.now()).map(([id]) => id);
  const expiredStages = stateStore().entries<{ expiresAt: number }>('channelStages').filter(([, r]) => r.expiresAt <= Date.now()).map(([id]) => id);
  if (expired.length || media.length || groups.length || expiredJobs.length || expiredStages.length) stateStore().update(b => {
    for (const { bucket, id } of expired) { delete b[bucket]?.[id]; for (const [token, op] of Object.entries(b.operations || {})) if ((op as { id: string }).id === id) delete b.operations[token]; }
    for (const id of media) delete b.knowledgeAssets?.[id];
    for (const id of groups) { delete b.renderBundles?.[id]; delete b.renderPrivate?.[id]; for (const [key, a] of Object.entries(b.renderAssets || {})) if ((a as { group: string }).group === id) delete b.renderAssets[key]; }
    for (const id of expiredJobs) { delete b.jobs?.[id]; for (const [key, entry] of Object.entries(b.jobKeys || {})) if ((entry as { id: string }).id === id) delete b.jobKeys[key]; }
    for (const id of expiredStages) delete b.channelStages?.[id];
  });
  for (const id of media) if (/^[a-f0-9-]{36}$/.test(id)) { try { unlinkSync(path.join(stateStore().directory, 'media', id)); } catch { /* orphan sweep may retry later */ } }
  for (const id of groups) if (/^[a-f0-9-]{36}$/.test(id)) { try { rmSync(path.join(renderDirectory(), id), { recursive: true, force: true }); } catch { /* cache cleanup is retried by renderer */ } }
}
const sweep = setInterval(() => { try { pruneHistory(); } catch { /* preserve corrupt/unavailable history; foreground operations report the error */ } }, 60_000); sweep.unref();
