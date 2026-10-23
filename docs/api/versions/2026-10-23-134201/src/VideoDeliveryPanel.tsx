import { useEffect, useId, useRef, useState } from 'react';
import { Download, Film, LoaderCircle, RotateCcw, Square } from 'lucide-react';
import type { BackgroundJob, ChannelDelivery } from '../shared/types';
import { api, apiFetch, submitJob } from './api';
import { activeJob, jobStatusLabel, pendingSubmissionKey, stageLabels } from './BackgroundTasks';

const noJobs: BackgroundJob[] = [];

/** Video is a sibling rendition: its work and errors never replace or lock the static delivery. */
export function VideoDeliveryPanel({ delivery, jobs = noJobs, titleIndex, onUpdated, onJob }: {
  delivery: ChannelDelivery; jobs?: BackgroundJob[]; titleIndex: number;
  onUpdated: (delivery: ChannelDelivery) => void; onJob?: (job: BackgroundJob) => void;
}) {
  const headingId = useId();
  const identity = useRef(delivery.id); identity.current = delivery.id;
  const callbacks = useRef({ onUpdated, onJob }); callbacks.current = { onUpdated, onJob };
  const [localJob, setLocalJob] = useState<BackgroundJob>();
  const [pending, setPending] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [expired, setExpired] = useState(false);
  const pendingNow = useRef(false); const key = useRef<string | undefined>(undefined);
  const related = [...(localJob ? [localJob] : []), ...jobs].filter(job => job.input.kind === 'video' && job.input.deliveryId === delivery.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.updatedAt.localeCompare(a.updatedAt));
  const job = related[0]; const channel = job?.channels.find(item => item.platform === delivery.platform);
  const blocked = delivery.review.status === 'blocked' || delivery.status === 'blocked';
  const videoBundle = !expired && delivery.videoBundle && delivery.videoBundle.selectedTitleIndex === titleIndex
    && Date.parse(delivery.videoBundle.expiresAt) > Date.now() ? delivery.videoBundle : undefined;
  const video = videoBundle?.artifacts.find(artifact => artifact.format === 'mp4');
  const cover = videoBundle?.artifacts.find(artifact => artifact.role === 'cover');
  const errorDetail = channel?.error || job?.error;
  const titleChanged = titleIndex !== (delivery.bundle?.selectedTitleIndex ?? 0);
  const staticReady = !!delivery.bundle && delivery.bundle.publication === 'released' && Date.parse(delivery.bundle.expiresAt) > Date.now();
  const unavailable = blocked || delivery.evidenceStatus !== 'ready' || titleChanged || !staticReady;
  const downloadable = !blocked && videoBundle?.publication === 'released';

  useEffect(() => {
    setLocalJob(undefined); setError(''); setMessage(''); setPending(false); pendingNow.current = false; key.current = undefined;
    const request = new AbortController(); const expected = delivery.id;
    void api<{ jobs: BackgroundJob[] }>('/api/jobs', 'GET', undefined, request.signal).then(response => {
      if (identity.current !== expected || request.signal.aborted) return;
      const found = response.jobs.filter(item => item.input.kind === 'video' && item.input.deliveryId === expected).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (found) setLocalJob(found);
    }).catch(() => { /* The shared task subscription remains the primary source. */ });
    return () => request.abort();
  }, [delivery.id]);

  useEffect(() => {
    setExpired(false); if (!delivery.videoBundle) return;
    const remaining = Date.parse(delivery.videoBundle.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) { setExpired(true); return; }
    const timer = window.setTimeout(() => setExpired(true), Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [delivery.videoBundle?.id, delivery.videoBundle?.expiresAt]);

  useEffect(() => {
    if (!job || !activeJob(job) && !job.detailOmitted) return;
    const request = new AbortController(); const expected = delivery.id; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = (await api<{ job: BackgroundJob }>(`/api/jobs/${encodeURIComponent(job.id)}`, 'GET', undefined, request.signal)).job;
        if (identity.current !== expected || request.signal.aborted) return;
        setLocalJob(next); callbacks.current.onJob?.(next);
        if (activeJob(next)) timer = setTimeout(poll, 1000);
        else {
          const updated = (await api<{ delivery: ChannelDelivery }>(`/api/deliveries/${encodeURIComponent(expected)}`, 'GET', undefined, request.signal)).delivery;
          if (identity.current !== expected || request.signal.aborted) return;
          callbacks.current.onUpdated(updated);
          if (next.status === 'completed') setMessage('短视频已完成，原图文成品继续保留。');
        }
      } catch (reason) {
        if (!request.signal.aborted && identity.current === expected) { setError(reason instanceof Error ? reason.message : '视频任务状态暂不可用，后台仍会继续。'); timer = setTimeout(poll, 2500); }
      }
    };
    timer = setTimeout(poll, 400);
    return () => { clearTimeout(timer); request.abort(); };
  }, [job?.id, job?.status, job?.detailOmitted, delivery.id]);

  async function operate(action: 'submit' | 'cancel' | 'retry') {
    if (pendingNow.current || action === 'submit' && (unavailable || job && activeJob(job))) return;
    pendingNow.current = true; setPending(true); setError(''); setMessage(''); const expected = delivery.id;
    try {
      let next: BackgroundJob;
      if (action === 'submit') {
        const idempotencyKey = key.current || crypto.randomUUID(); key.current = idempotencyKey;
        try { localStorage.setItem(pendingSubmissionKey, idempotencyKey); } catch { /* Only an opaque key, never content or credentials. */ }
        next = await submitJob({ kind: 'video', deliveryId: expected, idempotencyKey });
        try { if (localStorage.getItem(pendingSubmissionKey) === idempotencyKey) localStorage.removeItem(pendingSubmissionKey); } catch { /* Optional recovery storage. */ }
        key.current = undefined;
      } else {
        if (!job) return;
        next = (await api<{ job: BackgroundJob }>(`/api/jobs/${encodeURIComponent(job.id)}/${action}`, 'POST', {})).job;
      }
      callbacks.current.onJob?.(next);
      if (identity.current !== expected) return;
      setLocalJob(next); setMessage(action === 'cancel' ? '已停止视频制作，图文仍可使用。' : '视频已加入后台队列，可以继续复制、下载图文或切换渠道。');
    } catch (reason) { if (identity.current === expected) setError(reason instanceof Error ? reason.message : '视频任务未提交，请重试。'); }
    finally { if (identity.current === expected) { pendingNow.current = false; setPending(false); } }
  }

  async function download(url: string, name: string) {
    if (!downloadable) return; const expected = delivery.id; setError('');
    try {
      const response = await apiFetch(url); if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.message || '视频已到期，请主动重新生成。'); }
      const bytes = await response.blob(); if (identity.current !== expected) return;
      const objectUrl = URL.createObjectURL(bytes); const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (reason) { if (identity.current === expected) setError(reason instanceof Error ? reason.message : '下载失败，请重试。'); }
  }

  return <section className="vd-video" aria-labelledby={headingId}>
    <div className="vd-video-heading"><h4 id={headingId}><Film size={18} aria-hidden="true" />渠道短视频</h4><span className="vr-caption">20 秒 · 竖屏 · 无声</span></div>
    <p className="vr-caption">按需制作，复用已审核文案与产品原图。视频与图文分别保存，制作期间仍可使用图文。</p>
    {error && <p className="vr-notice vr-notice-error" role="alert">{error}</p>}
    {message && <p className="vr-notice vr-notice-success" role="status">{message}</p>}
    {job && <div className="vd-video-status" role="status"><p>{channel ? stageLabels[channel.stage] : '视频制作'} · {jobStatusLabel[job.status]}</p>
      {channel?.progress && <><progress max={channel.progress.totalFrames} value={channel.progress.completedFrames} aria-label="视频帧渲染进度" /><span className="vr-caption">{channel.progress.completedFrames} / {channel.progress.totalFrames} 帧</span></>}
      {errorDetail && <p className="vr-notice vr-notice-error">{errorDetail.message}{errorDetail.diagnosticId && `（诊断号 ${errorDetail.diagnosticId}）`}{errorDetail.outcomeUnknown && ' 上次执行结果不确定，请核对任务后主动重试。'}</p>}
    </div>}
    {video && <figure className="vd-video-preview"><video controls playsInline preload="metadata" src={video.previewUrl} poster={cover?.previewUrl} aria-label="渠道短视频预览" controlsList={!downloadable ? 'nodownload' : undefined} /><figcaption className="vr-artifact-caption"><strong>{video.name}</strong><span>{video.width} × {video.height} · {video.durationSeconds ?? 20} 秒 · {video.fps ?? 30}fps</span></figcaption></figure>}
    {!video && delivery.videoBundle && <p className="vr-notice">{delivery.videoBundle.selectedTitleIndex !== titleIndex ? '当前标题与视频版本不同，请先重新排版，再制作对应视频。' : '临时视频已到期，图文及历史正文仍保留。重新制作由你主动触发。'}</p>}
    {titleChanged && <p className="vr-caption">已选择新标题，请先重新排版以确认本渠道视频版本。</p>}
    {!staticReady && <p className="vr-caption">请先取得有效图文成品，再生成对应版本的视频；图文过期时需要主动重新排版。</p>}
    <div className="vr-secondary-actions">
      <button className="vr-button vr-button-secondary" type="button" disabled={pending || unavailable || !!job && activeJob(job)} onClick={() => void operate('submit')}>{pending ? <LoaderCircle className="vr-spin" size={17} aria-hidden="true" /> : <Film size={17} aria-hidden="true" />}{video ? '重新制作视频' : '生成视频'}</button>
      {job && activeJob(job) && <button className="vr-text-button" type="button" disabled={pending} onClick={() => void operate('cancel')}><Square size={15} aria-hidden="true" />停止视频制作</button>}
      {job && ['failed', 'interrupted'].includes(job.status) && errorDetail?.retryable !== false && <button className="vr-text-button" type="button" disabled={pending || unavailable} onClick={() => void operate('retry')}><RotateCcw size={15} aria-hidden="true" />重试视频步骤</button>}
      {video?.downloadUrl && <button className="vr-button vr-button-secondary" type="button" disabled={!downloadable} onClick={() => void download(video.downloadUrl!, video.name)}><Download size={17} aria-hidden="true" />下载 MP4</button>}
      {cover?.downloadUrl && <button className="vr-text-button" type="button" disabled={!downloadable} onClick={() => void download(cover.downloadUrl!, cover.name)}>下载视频封面</button>}
      {videoBundle?.zipUrl && <button className="vr-text-button" type="button" disabled={!downloadable} onClick={() => void download(videoBundle.zipUrl!, '渠道短视频与源文件.zip')}>下载视频与源文件</button>}
    </div>
  </section>;
}
