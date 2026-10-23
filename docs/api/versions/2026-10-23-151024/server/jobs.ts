import type { BackgroundJob, EvidenceBundle, JobInput, JobStage, JobSubmit, OutlineResult, Platform, PlatformOutline, RenderRequest, RunResult } from '../shared/types.js';
import { JobQueue, digest, jobError, type JobContext, type StoredJob } from './job-store.js';
import { stateStore } from './state-store.js';
import { modelConfig, snapshotModelConfig, withModelExecution } from './model.js';
import { assertEvidenceCurrent, captureEvidenceBinding, restoreEvidenceBinding, type EvidenceBinding } from './knowledge.js';
import { confirmedOutline, createOutline, getOutline, outlineRevisionPlatforms, publicOutline, reviseOutline, validateOutline, WorkflowError } from './outlines.js';
import { assembleChannelRun, channelPipelineSignature, parseBrief, publicResult, reusableEvidence, runChannelPipeline, type ChannelCheckpoint } from './pipeline.js';
import { getSavedRun, saveRun } from './history.js';
import { saveDelivery, deliveryRenderSource, updateDeliveryBundle, hydrateJobDeliveries, deliveryDetail } from './deliveries.js';
import { renderVisualDelivery } from './visual-workflow.js';
import { renderPosterDelivery } from './poster-workflow.js';
import { assertCurrentRenderRequest, externalDesignPaused } from './integrations/paused.js';
import { getRunBundles, renderRun, renderTemplates, validateRender } from './render/index.js';
import { executeVideoJob, videoSource } from './video-workflow.js';
import { videoScriptFingerprint } from './video-script.js';

const configurationHash = () => withModelExecution({ config: undefined }, () => digest({ ...modelConfig(), credential: process.env.LLM_API_KEY || '' }));
function currentEvidence(outline: OutlineResult, binding?: EvidenceBinding) {
  if (binding) restoreEvidenceBinding(outline.evidence, binding);
  assertEvidenceCurrent(outline.evidence);
  if (!reusableEvidence(outline.evidence)) throw new WorkflowError(410, '此任务的资料已过期，请重新取证并创建新大纲；历史内容仍可阅读。');
  validateOutline(outline.platforms, outline.brief, outline.evidence);
}
function outlineIdentityCurrent(record: StoredJob, insideRevision = false) {
  const input = record.job.input;
  if (input.kind === 'outline-revise' && insideRevision) {
    const saved = stateStore().get<{ outline: OutlineResult; expiresAt: number }>('outlines', input.outlineId);
    if (!saved || saved.expiresAt <= Date.now()) throw new WorkflowError(410, '原大纲已过期，请重新策划。');
    if (saved.outline.version !== input.version) throw new WorkflowError(409, '排队任务的大纲版本已变化，未派发模型请求。');
    return;
  }
  if (input.kind === 'generate' || input.kind === 'outline-revise') getOutline(input.outlineId, input.version);
}
function templateRequest(record: StoredJob, platform: Platform): RenderRequest {
  const input = record.job.input;
  const selected = input.kind === 'generate' ? input.renders?.find(r => r.platform === platform) : undefined;
  return { runId: record.runId, revision: 1, platform, selectedTitleIndex: selected?.selectedTitleIndex || 0, templateId: selected?.templateId || renderTemplates.find(t => t.platform === platform)!.id,
    ...((record.rendererMode==='html'||record.rendererMode==='html-v2')&&['wechat','xiaohongshu'].includes(platform)?{visualMode:'html' as const}:{}),
    ...(record.rendererMode==='html-v2'&&platform==='poster'?{visualMode:'poster-image' as const}:{}) };
}
function channelResult(record: StoredJob, cp: ChannelCheckpoint): RunResult {
  const outline = record.snapshot!;
  return { id: record.runId, createdAt: record.job.createdAt, revision: 1, brief: { ...outline.brief, platforms: [cp.platform] }, product: outline.product, evidence: outline.evidence,
    drafts: [cp.draft!], strategies: [], review: cp.review!, trace: [], notice: '审核中，仅供预览。全部所选渠道终审后统一开放正式导出。', outline: { id: outline.id, version: outline.version } };
}
async function executeJob(record: StoredJob, ctx: JobContext) {
  const { job } = record; const input = job.input;
  if(input.kind==='video'){await executeVideoJob(record,ctx,{configurationHash});return;}
  if(input.kind==='render')assertCurrentRenderRequest(input.request);
  const config = snapshotModelConfig();
  await withModelExecution({ jobId: job.id, config, onCall: ctx.call, beforeDispatch: () => {
    ctx.signal.throwIfAborted();
    if (record.configHash !== configurationHash()) throw new WorkflowError(409, '任务绑定的接入配置已改变，未派发模型请求。');
    outlineIdentityCurrent(record, true);
    const evidence = record.snapshot?.evidence || record.checkpoints.evidence as EvidenceBundle | undefined;
    if (evidence) {
      assertEvidenceCurrent(evidence);
      if (!reusableEvidence(evidence)) throw new WorkflowError(410, '等待模型槽位时资料已过期，未派发请求；请重新取证。');
    }
  } }, async () => {
    if (input.kind === 'outline' || input.kind === 'outline-revise') {
      outlineIdentityCurrent(record);
      const priorEvidence = record.checkpoints.evidence as EvidenceBundle | undefined;
      if (priorEvidence) {
        if (record.binding) restoreEvidenceBinding(priorEvidence, record.binding as EvidenceBinding);
        assertEvidenceCurrent(priorEvidence);
        if (!reusableEvidence(priorEvidence)) throw new WorkflowError(410, '排队任务的资料已过期，请重新策划。');
      }
      const options = {
        evidence: priorEvidence,
        channels: (record.checkpoints.outlines || {}) as Partial<Record<Platform, PlatformOutline>>,
        ...(input.kind === 'outline-revise' ? { platforms: input.platforms } : {}),
        onEvidence(evidence: EvidenceBundle) { record.checkpoints.evidence = evidence; record.binding = captureEvidenceBinding(evidence); ctx.save(); },
        onStage(platform: Platform) { const channel = job.channels.find(c => c.platform === platform); if (channel) { channel.status = 'running'; channel.stage = 'outline'; delete channel.error; ctx.save(); } },
        onChannel(platform: Platform, result: PlatformOutline) {
          record.checkpoints.outlines ||= {};
          (record.checkpoints.outlines as Partial<Record<Platform, PlatformOutline>>)[platform] = result;
          const channel = job.channels.find(c => c.platform === platform); if (channel) { channel.status = 'completed'; delete channel.error; }
          ctx.acknowledge('outline', platform); ctx.save();
        },
      };
      try {
        const outline = input.kind === 'outline' ? await createOutline(parseBrief(input.brief), ctx.signal, options)
          : await reviseOutline(input.outlineId, input.version, input.instructions, ctx.signal, options);
        job.outline = publicOutline(outline); for (const channel of job.channels) { channel.status = 'completed'; delete channel.error; ctx.acknowledge('outline', channel.platform); } ctx.save();
      } catch (error) {
        const failedPlatforms = new Set(job.calls.filter(c => c.outcome === 'failed' || c.outcome === 'unknown').map(c => c.platform));
        for (const channel of job.channels) if (channel.status !== 'completed') { channel.status = 'failed'; channel.error = jobError(error, 'outline', channel.platform); if (failedPlatforms.size && !failedPlatforms.has(channel.platform)) channel.error.message = '同轮大纲尚未完成，已保留成功渠道；重试仅继续未完成渠道。'; }
        ctx.save(); throw error;
      }
      return;
    }
    if (input.kind === 'render') {
      const saved = { result: input.request.deliveryId ? deliveryRenderSource(input.request.deliveryId) : getSavedRun(input.request.runId, true).result };
      if (saved.result.revision !== input.request.revision) throw new WorkflowError(409, '正文版本不一致，请载入最新记录。');
      const channel = job.channels[0]; channel.status = 'running'; channel.stage = 'render'; ctx.save();
      const bundle = input.request.visualMode==='poster-image' ? await renderPosterDelivery(saved.result,input.request,record,ctx) : input.request.visualMode==='html' ? await renderVisualDelivery(saved.result, input.request, record, ctx) : await renderRun(saved.result, input.request, ctx.signal, { expiresAt: input.request.deliveryId ? getRunBundles(saved.result.id).filter(b=>b.platform===input.request.platform).sort((a,b)=>Date.parse(a.expiresAt)-Date.parse(b.expiresAt))[0]?.expiresAt : undefined });
      if (input.request.deliveryId) { channel.deliveryId = input.request.deliveryId; channel.delivery = updateDeliveryBundle(input.request.deliveryId, bundle); }
      job.renderBundles = [bundle]; channel.status = 'completed'; ctx.save(); return;
    }
    outlineIdentityCurrent(record);
    const outline = record.snapshot!; currentEvidence(outline, record.binding as EvidenceBinding | undefined);
    await Promise.all(job.channels.map(async channel => {
      if (channel.status === 'completed') return;
      try {
        const plannedRequest=templateRequest(record,channel.platform);
        if(outline.brief.mode==='live'&&channel.platform!=='moments'&&!plannedRequest.visualMode)throw externalDesignPaused();
        channel.status = 'running'; delete channel.error; ctx.save();
        const signature = channelPipelineSignature(outline, channel.platform);
        const cacheKey = digest({ signature, config: record.configHash, binding: record.binding });
        let checkpoint = record.checkpoints[channel.platform] as ChannelCheckpoint | undefined;
        if (!checkpoint) {
          const cached = stateStore().get<{ checkpoint: ChannelCheckpoint; expiresAt: number }>('channelStages', cacheKey);
          if (cached && cached.expiresAt > Date.now()) checkpoint = cached.checkpoint;
        }
        const completed = await withModelExecution({ platform: channel.platform }, () => runChannelPipeline(outline, channel.platform, {
          signal: ctx.signal, checkpoint,
          onStage(stage) { channel.stage = stage; channel.status = 'running'; ctx.save(); },
          onCheckpoint(next) {
            record.checkpoints[channel.platform] = next;
            if (next.draft) ctx.acknowledge('write', channel.platform);
            if (next.review && !next.repairAttempted) ctx.acknowledge('review', channel.platform);
            if (next.repairAttempted) ctx.acknowledge('repair', channel.platform);
            if (next.rechecked) ctx.acknowledge('recheck', channel.platform);
            if (next.draft && next.review && next.completed) channel.preview = { draft: next.draft, review: next.review };
            ctx.save();
            if (next.completed) stateStore().set('channelStages', cacheKey, { checkpoint: next, expiresAt: Date.parse(job.expiresAt) });
          },
        }));
        record.checkpoints[channel.platform] = completed;
        // Reused checkpoints can also acknowledge markers migrated from an older queue version.
        ctx.acknowledge('write', channel.platform); ctx.acknowledge('review', channel.platform);
        if (completed.repairAttempted) ctx.acknowledge('repair', channel.platform);
        if (completed.rechecked) ctx.acknowledge('recheck', channel.platform);
        channel.preview = { draft: completed.draft!, review: completed.review!, bundle: channel.preview?.bundle };
        channel.stage = 'render'; ctx.save(); currentEvidence(outline, record.binding as EvidenceBinding | undefined);
        const delivery = saveDelivery({ runId: record.runId, jobId: job.id, outline, draft: completed.draft!, review: completed.review! });
        channel.deliveryId = delivery.id; channel.delivery = delivery; ctx.save();
        const request = { ...templateRequest(record, channel.platform), deliveryId: delivery.id };
        const source = deliveryRenderSource(delivery.id);
        const bundle = request.visualMode==='poster-image'
          ? await renderPosterDelivery(source,request,record,ctx)
          : request.visualMode==='html' ? await renderVisualDelivery(source, request, record, ctx)
          : await renderRun(source, request, ctx.signal);
        channel.delivery = updateDeliveryBundle(delivery.id, bundle);
        channel.preview.bundle = bundle; job.renderBundles = [...job.renderBundles.filter(b => b.platform !== channel.platform), bundle];
        channel.status = 'completed'; ctx.save();
      } catch (error) {
        if (ctx.signal.aborted) return;
        channel.status = 'failed'; channel.error = jobError(error, channel.stage, channel.platform); ctx.save();
      }
    }));
    ctx.signal.throwIfAborted();
    const checkpoints = job.channels.map(c => record.checkpoints[c.platform] as ChannelCheckpoint | undefined);
    if (checkpoints.every((c): c is ChannelCheckpoint => !!c?.completed)) {
      currentEvidence(outline, record.binding as EvidenceBinding | undefined);
      const result = assembleChannelRun(outline, checkpoints, record.runId);
      // A complete run exists only after every selected channel has a final review.
      if (!job.result) { saveRun(result, outline.evidence, outline); job.result = publicResult(result); ctx.save(); }
      // Independent deliveries retain each channel's own review and export gate.
      job.renderBundles = job.channels.flatMap(channel => channel.preview?.bundle ? [channel.preview.bundle] : []);
      ctx.save();
    }
  });
}
let singleton: JobQueue | undefined;
export function jobs() {
  if (!singleton) { singleton = new JobQueue(stateStore(), executeJob, configurationHash); singleton.start(); }
  return singleton;
}
export function submitJob(submission: JobSubmit): BackgroundJob {
  const { idempotencyKey, ...rawInput } = submission;
  const input = rawInput as JobInput;
  if(input.kind==='render')assertCurrentRenderRequest(input.request);
  const queue = jobs();
  if (input.kind === 'outline') input.brief = parseBrief(input.brief);
  const existing = queue.findSubmission(idempotencyKey, input); if (existing) return existing;
  const config = modelConfig(); const model = { name: config.name, baseUrl: config.baseUrl };
  if (input.kind === 'outline') { input.brief = parseBrief(input.brief); return queue.submit(idempotencyKey, input, model, input.brief.platforms); }
  if(input.kind==='video') {
    const {delivery,source,fingerprint,expiresAt}=videoSource(input.deliveryId),textFingerprint=videoScriptFingerprint(source);
    const retained=queue.recoverVideoSubmission(idempotencyKey,input,textFingerprint,fingerprint);if(retained)return retained;
    return queue.submit(idempotencyKey,input,model,[delivery.platform],{checkpoints:{videoMode:'script-v2',videoTextFingerprint:textFingerprint,videoSource:{fingerprint,expiresAt,retrySequence:0}}});
  }
  if (input.kind === 'render') {
    const source = input.request.deliveryId ? deliveryRenderSource(input.request.deliveryId) : getSavedRun(input.request.runId, true).result; validateRender(source, input.request);
    return queue.submit(idempotencyKey, input, model, [input.request.platform]);
  }
  if (queue.hasOutlineUse(input.outlineId)) throw new WorkflowError(409, '此大纲已有待完成任务，请先查看该任务或显式停止。');
  const outline = input.kind === 'generate' ? confirmedOutline(input.outlineId, input.version) : getOutline(input.outlineId, input.version);
  currentEvidence(outline, captureEvidenceBinding(outline.evidence));
  if (input.kind === 'generate' && input.renders) {
    if (new Set(input.renders.map(r => r.platform)).size !== input.renders.length || input.renders.length !== outline.brief.platforms.length || input.renders.some(r => !outline.brief.platforms.includes(r.platform) || !renderTemplates.some(t => t.platform === r.platform && t.id === r.templateId))) throw new WorkflowError(400, '排版渠道须与大纲一一对应，模板须属于相同渠道。');
    if (input.renders.some(r => r.selectedTitleIndex !== 0)) throw new WorkflowError(400, '确认大纲仅有一个固定标题，生成排版的标题序号必须为 0；未派发模型请求。');
  }
  if (input.kind === 'outline-revise' && input.platforms?.some(p => !outline.brief.platforms.includes(p))) throw new WorkflowError(400, '修改渠道必须来自此大纲。');
  const platforms = input.kind === 'outline-revise' ? outlineRevisionPlatforms(input.instructions, outline.brief.platforms, input.platforms) : outline.brief.platforms;
  const submitted = queue.submit(idempotencyKey, input, model, platforms, { snapshot: publicOutline(outline), binding: captureEvidenceBinding(outline.evidence),...(input.kind==='generate'?{rendererMode:'html-v2' as const}:{}) });
  // The immutable snapshot is public immediately, even before a worker starts.
  return { ...submitted, outline: publicOutline(outline) };
}
