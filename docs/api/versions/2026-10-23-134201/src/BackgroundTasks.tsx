import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleX, Clock3, LoaderCircle, Square, RotateCcw, ArrowRight } from 'lucide-react';
import type { BackgroundJob, JobInput, JobStage, JobStatus, Platform, RenderBundle } from '../shared/types';
import { api, mockLabel, submitJob, subscribeJobs } from './api';
import { Button } from './virgo/Controls';
import './virgo/background-tasks.css';
import { mergeJobSnapshot } from './job-state';

export const jobSelectionKey = `zhixu:job-selection:${mockLabel || 'real'}`;
export const pendingSubmissionKey = `zhixu:job-pending:${mockLabel || 'real'}`;
export const activeJob = (job: BackgroundJob) => job.status === 'queued' || job.status === 'running';
export const jobStatusLabel: Record<JobStatus, string> = { queued: '等待执行', running: '正在处理', failed: '有步骤失败', interrupted: '执行已中断', cancelled: '已停止', completed: '已完成' };
export const stageLabels: Record<JobStage, string> = { retrieve: '读取资料', outline: '策划方案', write: '写作', review: '独立审稿', repair: '定向返修', recheck: '复审', design:'设计简报',image:'生成视觉',compose:'分层制作',canva_import:'导入 Canva',canva_edit:'核对 Canva 图层',canva_export:'导出 Canva',render: '排版', publish: '渠道交付', storyboard: '编排视频分镜', video_render: '渲染视频画面', video_encode: '编码视频' };
const platformLabels: Record<Platform, string> = { xiaohongshu: '小红书', wechat: '公众号', moments: '朋友圈', poster: '门店海报' };
export const jobTitle = (job: BackgroundJob) => ({ outline: '策划营销方案', 'outline-revise': 'AI 调整方案', generate: '写作、审稿与排版', render: '生成视觉成品', video: '制作渠道短视频' })[job.kind];
export function rememberJob(id: string | null) { try { if (id) localStorage.setItem(jobSelectionKey, id); else localStorage.removeItem(jobSelectionKey); } catch { /* Backend state remains available. */ } }


export function useBackgroundJobs() {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [connected, setConnected] = useState(false); const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string[]>([]); const [error, setError] = useState('');
  const submissions = useRef(new Map<string, Promise<BackgroundJob>>());
  const submissionKeys = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const detailRequests = useRef(new Map<string, Promise<BackgroundJob>>());
  useEffect(() => {
    mounted.current = true; const controller = new AbortController(); const { signal } = controller;
    const wait = (ms: number) => new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, ms); signal.addEventListener('abort', done, { once: true });
    });
    void (async () => {
      let failures = 0;
      while (!signal.aborted) {
        try {
          const response = await api<{ jobs: BackgroundJob[] }>('/api/jobs', 'GET', undefined, signal);
          if (signal.aborted) return; setJobs(current => mergeJobSnapshot(current, response.jobs)); setLoading(false);
          await subscribeJobs(signal, snapshot => { if (!signal.aborted) { setJobs(current => mergeJobSnapshot(current, snapshot)); setConnected(true); setError(''); failures = 0; } });
        } catch {
          if (signal.aborted) return; setConnected(false); setLoading(false); setError('任务连接暂时中断，正在重连。后台继续执行，请勿重复提交。');
          failures++; await wait(Math.min(10_000, 1000 * failures));
        }
      }
    })();
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  function retain(job: BackgroundJob) { if (mounted.current) setJobs(current => { const saved = current.find(item => item.id === job.id); return saved && saved.updatedAt > job.updatedAt ? current : [job, ...current.filter(item => item.id !== job.id)]; }); return job; }
  function loadJob(id: string) {
    const pending = detailRequests.current.get(id); if (pending) return pending;
    const request = api<{ job: BackgroundJob }>(`/api/jobs/${encodeURIComponent(id)}`).then(response => retain(response.job)).finally(() => detailRequests.current.delete(id));
    detailRequests.current.set(id, request); return request;
  }
  function enqueue(input: JobInput, scope: string) {
    const existing = submissions.current.get(scope); if (existing) return existing;
    const idempotencyKey = submissionKeys.current.get(scope) || crypto.randomUUID();
    submissionKeys.current.set(scope, idempotencyKey);
    try { localStorage.setItem(pendingSubmissionKey, idempotencyKey); } catch { /* No input or credential is stored in the browser. */ }
    const operation = submitJob({ ...input, idempotencyKey }).then(job => {
      try { if (localStorage.getItem(pendingSubmissionKey) === idempotencyKey) localStorage.removeItem(pendingSubmissionKey); } catch { /* Optional browser storage. */ }
      submissionKeys.current.delete(scope); return retain(job);
    }).finally(() => { submissions.current.delete(scope); });
    submissions.current.set(scope, operation); return operation;
  }
  async function action(job: BackgroundJob, kind: 'cancel' | 'retry') {
    setPending(current => [...current, job.id]);
    try { return retain((await api<{ job: BackgroundJob }>(`/api/jobs/${encodeURIComponent(job.id)}/${kind}`, 'POST', {})).job); }
    finally { if (mounted.current) setPending(current => current.filter(id => id !== job.id)); }
  }
  return { jobs, connected, loading, error, enqueue, action, pending, loadJob, retain };
}

export function TaskCenter({ jobs, selectedId, connected, loading, error, pending, onOpen, onAction, compact = false }: {
  jobs: BackgroundJob[]; selectedId: string | null; connected: boolean; loading: boolean; error: string; pending: string[];
  onOpen: (job: BackgroundJob) => void; onAction: (job: BackgroundJob, action: 'cancel' | 'retry') => void; compact?: boolean;
}) {
  const ordered = [...jobs].sort((a, b) => Number(activeJob(b)) - Number(activeJob(a)) || b.createdAt.localeCompare(a.createdAt));
  return <section className={`task-center${compact ? ' task-center-compact' : ''}`} aria-label="后台任务">
    <div className="task-center-heading">{!compact && <h2>后台任务</h2>}<span className="caption">{loading ? '正在读取' : connected ? '状态已连接' : '正在重新连接'}</span></div>
    <p className="caption">可以切换渠道、查看历史或新建任务。关闭页面不会停止后台执行。</p>
    {error && <p className="task-connection-warning" role="status">{error}</p>}
    {!ordered.length && !loading && <div className="empty-state"><h3>队列里还没有任务</h3><p>提交方案或成品后，可以在这里查看进度。</p></div>}
    <ol className="task-list">{ordered.map(job => <li className={`task-item task-${job.status}`} key={job.id} aria-current={selectedId === job.id ? 'true' : undefined}>
      <div className="task-item-heading">{job.status === 'running' ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : job.status === 'queued' ? <Clock3 size={18} aria-hidden="true" /> : job.status === 'completed' ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleX size={18} aria-hidden="true" />}<strong>{jobTitle(job)}</strong><span>{jobStatusLabel[job.status]}</span></div>
      <p>{job.outline?.product.name || job.result?.product.name || job.summary?.productName || (job.input.kind === 'outline' ? job.input.brief.audience : '')} {job.outline?.brief.scene || job.summary?.scene || ''}</p>
      <ul className="task-channel-list">{job.channels.map(channel => <li key={channel.platform}><span>{platformLabels[channel.platform]}</span><span>{stageLabels[channel.stage]} · {jobStatusLabel[channel.status]}{channel.progress && ` · ${channel.progress.completedFrames}/${channel.progress.totalFrames} 帧`}</span></li>)}</ul>
      {job.error && <p className="task-error" role="status">{job.error.platform ? `${platformLabels[job.error.platform]} · ${stageLabels[job.error.stage]}：` : ''}{job.error.message}{job.error.diagnosticId && `（诊断号 ${job.error.diagnosticId}）`}{job.error.outcomeUnknown && ' 上游可能已产生消耗；主动重试可能再次计费。'}</p>}
      <div className="task-item-actions"><Button variant="ghost" onClick={() => onOpen(job)}>查看任务<ArrowRight size={15} /></Button>{activeJob(job) && <Button disabled={pending.includes(job.id)} onClick={() => onAction(job, 'cancel')}><Square size={14} />停止此任务</Button>}{['failed', 'interrupted'].includes(job.status) && job.error?.retryable !== false && <Button disabled={pending.includes(job.id)} onClick={() => onAction(job, 'retry')}><RotateCcw size={15} />重试失败步骤{job.error?.outcomeUnknown ? '（可能再次计费）' : ''}</Button>}</div>
    </li>)}</ol>
  </section>;
}
