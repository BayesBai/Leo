import { ChannelDeliveryPanel } from './ChannelDeliveryPanel';
import { CanvaConnection } from './CanvaConnection';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, CheckCircle2, TriangleAlert, CircleX, Copy, Download, FileText, LoaderCircle, Plus, Settings, Square, History, BookOpen, X } from 'lucide-react';
import type { BackgroundJob, JobInput, RenderRequest, AppStatus, Brief, Draft, HistoryItem, HistoryMetadata, OutlineResult, Platform, PlatformOutline, Product, RenderBundle, RenderTemplate, RunDetail, RunResult, TaskOptions, TraceEntry } from '../shared/types';
import { api, mockLabel, ApiError } from './api';
import { TaskForm } from './TaskForm';
import { RenderPanel } from './RenderPanel';
import { ChannelComparison } from './ChannelComparison';
import { VirgoLanding } from './virgo/VirgoLanding';
import { WorkbenchBackground, WorkbenchBackgroundControl, useWorkbenchBackground } from './virgo/WorkbenchBackground';
import { focusWorkbenchMain } from './virgo/workbench-focus';
import { Button, Drawer } from './virgo/Controls';
import { OutlinePage } from './virgo/OutlinePage';
import { mergeJobBundles } from './job-state';
import { activeJob, jobSelectionKey, jobStatusLabel, jobTitle, pendingSubmissionKey, rememberJob, TaskCenter, useBackgroundJobs } from './BackgroundTasks';

const names: Record<Platform, string> = { wechat: '微信公众号', xiaohongshu: '小红书', moments: '朋友圈', poster: '门店海报' };
const steps = [{ id: 1, label: '填写需求' }, { id: 5, label: '确认方案' }, { id: 6, label: '成品交付' }];
const initialBrief: Brief = { productId: '', audience: '', scene: '开学季', goal: '到店体验', buyingStage: '对比选择', platforms: ['xiaohongshu'], instructions: '', mode: 'demo', knowledgeSource: 'local' };
const reviewName = { passed: '内容检查通过', needs_attention: '有待确认项', blocked: '审核阻断' };
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : '请求未完成，请重试。';
type Work = (label: string, task: (signal: AbortSignal) => Promise<void>) => Promise<void>;
const selectionKey = `zhixu:history-selection:${mockLabel || 'real'}`;
function moveTab(event: KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]:not(:disabled)') || [])];
  const index = tabs.indexOf(event.currentTarget); if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus(); tabs[next]?.click();
}
function remember(kind: HistoryItem['kind'], id: string) { try { localStorage.setItem(selectionKey, JSON.stringify({ kind, id })); } catch { /* History remains on the server when browser storage is unavailable. */ } }

export default function WorkflowApp() {
  const [step, setStep] = useState(1); const [brief, setBrief] = useState<Brief>(initialBrief);
  const [status, setStatus] = useState<AppStatus | null>(null); const [products, setProducts] = useState<Product[]>([]);
  const [options, setOptions] = useState<TaskOptions | null>(null); const [templates, setTemplates] = useState<RenderTemplate[]>([]);
  const [outline, setOutline] = useState<OutlineResult | null>(null); const [edits, setEdits] = useState<PlatformOutline[]>([]); const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null); const [history, setHistory] = useState<HistoryItem[]>([]);
  const [outlineReadOnly, setOutlineReadOnly] = useState(false); const [resultSnapshot, setResultSnapshot] = useState<OutlineResult>();
  const [resultHistory, setResultHistory] = useState<HistoryMetadata>(); const [renderBundles, setRenderBundles] = useState<RenderBundle[]>([]);
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [trace, setTrace] = useState<TraceEntry[]>([]); const [revision, setRevision] = useState(''); const [activePlatform, setActivePlatform] = useState<Platform>('xiaohongshu');
  const [titleIndexes, setTitleIndexes] = useState<Record<string, number>>({});
  const [deliveryBlocked, setDeliveryBlocked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true); const [errorStatus, setErrorStatus] = useState<number>();
  const [loadKey, setLoadKey] = useState(0); const autoMode = useRef(false); const restoreAttempted = useRef(false);
  const [showHome, setShowHome] = useState(() => window.location.hash !== '#workbench');
  const [returning, setReturning] = useState(false); const [leavingHome, setLeavingHome] = useState(false);
  const ambience = useWorkbenchBackground(!showHome && !leavingHome);
  const transitionTimer = useRef<number | undefined>(undefined);
  const [modal, setModal] = useState<'settings' | 'history' | 'menu' | 'evidence' | 'outlineSources' | 'tasks' | null>(null);
  const [mobileTasks, setMobileTasks] = useState(() => window.matchMedia('(max-width:760px)').matches);
  useEffect(() => { const media = window.matchMedia('(max-width:760px)'); const update = () => setMobileTasks(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const background = useBackgroundJobs();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectionNonce, setSelectionNonce] = useState(0);
  const selectedJobRef = useRef<string | null>(null);
  const selectedJob = background.jobs.find(job => job.id === selectedJobId);
  const selectionEpoch = useRef(0);
  const formIdentity = useRef(crypto.randomUUID());
  const appliedOutline = useRef(new Set<string>()); const validatedResults = useRef(new Set<string>()); const validatedOutlines = useRef(new Set<string>()); const historyRefreshed = useRef(new Set<string>()); const appliedResult = useRef('');
  const [submitting, setSubmitting] = useState(false);
  const [deliveryView, setDeliveryView] = useState<'copy' | 'visual'>('copy');
  const [evidenceTab, setEvidenceTab] = useState<'facts' | 'review' | 'strategy'>('review');
  const [focusFact, setFocusFact] = useState<string>();
  const outlineJobBusy = !!outline && background.jobs.some(job => activeJob(job) && (job.input.kind === 'outline-revise' || job.input.kind === 'generate') && job.input.outlineId === outline.id);

  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const request = new AbortController(); setLoading(true);
    void Promise.allSettled([
      api<AppStatus>('/api/status', 'GET', undefined, request.signal).then(data => { if (request.signal.aborted) return; setStatus(data); if (!autoMode.current) { autoMode.current = true; setBrief(b => ({ ...b, mode: data.model.configured ? 'live' : 'demo', knowledgeSource: data.model.configured && data.ima.verified ? 'ima' : 'local' })); } }),
      api<{ products: Product[] }>('/api/products', 'GET', undefined, request.signal).then(data => { if (request.signal.aborted) return; setProducts(data.products); setBrief(b => ({ ...b, productId: b.productId || data.products[0]?.id || '' })); }),
      api<TaskOptions>('/api/task-options', 'GET', undefined, request.signal).then(data => { if (!request.signal.aborted) setOptions(data); }),
      api<{ templates: RenderTemplate[] }>('/api/render-templates', 'GET', undefined, request.signal).then(data => { if (!request.signal.aborted) setTemplates(data.templates); }),
      api<{ items: HistoryItem[] }>('/api/history', 'GET', undefined, request.signal).then(data => { if (!request.signal.aborted) setHistory(data.items); }),
    ]).then(async responses => { if (request.signal.aborted) return; if (responses.some(r => r.status === 'rejected')) setError('部分服务信息未载入，请重新载入或检查接入设置。');
      if (!restoreAttempted.current && !controller.current) { restoreAttempted.current = true; try {
        const jobId = localStorage.getItem(jobSelectionKey);
        const pendingKey = localStorage.getItem(pendingSubmissionKey);
        let recovered: BackgroundJob | undefined;
        if (pendingKey) {
          recovered = (await api<{jobs:BackgroundJob[]}>(`/api/jobs?idempotencyKey=${encodeURIComponent(pendingKey)}`, 'GET', undefined, request.signal)).jobs[0];
          // An acknowledged empty key lookup proves no job was durably submitted.
          localStorage.removeItem(pendingSubmissionKey);
        }
        if (!recovered && jobId) { try { recovered = (await api<{job:BackgroundJob}>(`/api/jobs/${encodeURIComponent(jobId)}`, 'GET', undefined, request.signal)).job; } catch (reason) { if (!(reason instanceof ApiError) || ![404,410].includes(reason.status || 0)) throw reason; rememberJob(null); } }
        if (recovered && !request.signal.aborted) openJob(recovered);
        else { const saved: unknown = JSON.parse(localStorage.getItem(selectionKey) || 'null'); if (saved && typeof saved === 'object' && 'kind' in saved && 'id' in saved && (saved.kind === 'outline' || saved.kind === 'run') && typeof saved.id === 'string') await restoreSelection(saved.kind, saved.id, request.signal); } } catch (reason) { if (!request.signal.aborted) setMessage(`历史暂未恢复：${errorText(reason)} 可从历史记录重新载入。`); } }
      if (!request.signal.aborted) setLoading(false); });
    return () => { request.abort(); };
  }, [loadKey]);
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(''), 5000); return () => window.clearTimeout(timer); }, [message]);
  useEffect(() => { if (showHome) return; window.scrollTo({ top: 0 }); focusWorkbenchMain(document.getElementById('workbench-main')); }, [step]);
  function update<K extends keyof Brief>(key: K, value: Brief[K]) { detachJob(); formIdentity.current = crypto.randomUUID(); setBrief(b => ({ ...b, [key]: value })); setOutline(null); setEdits([]); setDirty(false); setError(''); setErrorStatus(undefined); }
  function acceptOutline(next: OutlineResult, readOnly = false) { setOutline(next); setEdits(structuredClone(next.platforms)); setDirty(false); setRevision(''); setOutlineReadOnly(readOnly || next.history?.evidenceStatus === 'refresh_required'); }
  async function refreshHistory(signal: AbortSignal) { try { const data = await api<{ items: HistoryItem[] }>('/api/history', 'GET', undefined, signal); if (!signal.aborted) setHistory(data.items); } catch { /* A failed list refresh must not discard a completed result. */ } }
  async function restoreSelection(kind: HistoryItem['kind'], id: string, signal: AbortSignal) {
    const epoch = ++selectionEpoch.current; detachJob(false);
    if (kind === 'outline') { const next = await api<OutlineResult>(`/api/outlines/${encodeURIComponent(id)}`, 'GET', undefined, signal); if (signal.aborted || epoch !== selectionEpoch.current) return; setBrief(next.brief); acceptOutline(next); setResult(null); setRenderBundles([]); setStep(5); }
    else { const detail = await api<RunDetail>(`/api/runs/${encodeURIComponent(id)}`, 'GET', undefined, signal); let latest: OutlineResult | undefined;
      if (detail.result.outline) { try { latest = await api<OutlineResult>(`/api/outlines/${encodeURIComponent(detail.result.outline.id)}`, 'GET', undefined, signal); } catch { signal.throwIfAborted(); } }
      if (signal.aborted || epoch !== selectionEpoch.current) return;
      const snapshot = detail.outlineSnapshot; const matches = latest && latest.id === detail.result.outline?.id && latest.version === detail.result.outline?.version;
      if (snapshot || matches) acceptOutline(snapshot || latest!, !matches || detail.history.evidenceStatus !== 'ready'); else { setOutline(null); setEdits([]); setDirty(false); }
      setBrief(detail.result.brief); setResult(detail.result); setResultSnapshot(snapshot); setResultHistory(detail.history); setRenderBundles(detail.renderBundles);
      setActivePlatform(detail.result.drafts[0].platform); setTitleIndexes(Object.fromEntries(detail.result.drafts.map(d => [d.id, detail.renderBundles.find(b => b.platform === d.platform && Date.parse(b.expiresAt) > Date.now())?.selectedTitleIndex || 0]))); setStep(6);
    }
    if (epoch === selectionEpoch.current) remember(kind, id);
  }
  const work: Work = async (label, task) => {
    if (controller.current) return;
    const epoch = selectionEpoch.current;
    const request = new AbortController(); controller.current = request; setBusy(label); setError(''); setErrorStatus(undefined);
    try { await task(request.signal); }
    catch (reason) { if (epoch !== selectionEpoch.current) return; if (!request.signal.aborted) { const code = reason && typeof reason === 'object' && 'status' in reason ? Number(reason.status) : undefined; setErrorStatus(code); setError(errorText(reason) + (reason instanceof ApiError && reason.fields.length ? ' '+reason.fields.map(field => field.question).join('；') : '') + (code === 409 ? ' 本地编辑已保留，请核对服务器上的最新版本。' : code === 410 ? ' 已有正文仍保留，请重新生成大纲或成品。' : code === 429 ? ' 请稍后重试，系统不会自动重复提交。' : '')); } else setMessage('任务已停止，已保存的大纲和正文仍保留。'); }
    finally { if (controller.current === request) { controller.current = null; setBusy(''); } }
  };
  function openSettings() { setModal('settings'); }
  function switchMode(mode: Brief['mode']) {
    if (brief.mode === mode && (mode !== 'demo' || brief.knowledgeSource === 'local')) return;
    guarded(() => { update('mode', mode); if (mode === 'demo') update('knowledgeSource', 'local'); setStep(1); setModal(null); });
  }
  function enterWorkbench() {
    if (leavingHome) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setLeavingHome(true); setShowHome(false); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#workbench`);
    transitionTimer.current = window.setTimeout(() => { setLeavingHome(false); document.getElementById('workbench-main')?.focus({ preventScroll: true }); }, reduced ? 100 : 600);
  }
  function home() { setReturning(true); setShowHome(true); setModal(null); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`); window.scrollTo({ top: 0 }); }
  function guarded(action: () => void) { if (dirty) setPendingAction(() => action); else action(); }
  useEffect(() => () => { if (transitionTimer.current !== undefined) window.clearTimeout(transitionTimer.current); }, []);
  useEffect(() => {
    const show = (event: Event) => { setFocusFact((event as CustomEvent<string>).detail); setEvidenceTab('facts'); setModal('evidence'); };
    window.addEventListener('zhixu:evidence', show); return () => window.removeEventListener('zhixu:evidence', show);
  }, []);

  function changeOutline(index: number, change: (p: PlatformOutline) => PlatformOutline) { if (outlineReadOnly) return; setEdits(current => current.map((p, i) => i === index ? change(p) : p)); setDirty(true); }
  function detachJob(advance = true) {
    if (advance) selectionEpoch.current++;
    selectedJobRef.current = null; setSelectedJobId(null); rememberJob(null);
    appliedResult.current = '';
  }
  function openJob(job: BackgroundJob) {
    setSelectionNonce(value => value + 1);
    if (!job.detailOmitted) background.retain(job);
    selectionEpoch.current++; validatedResults.current.delete(job.id); validatedOutlines.current.delete(job.id); selectedJobRef.current = job.id; setSelectedJobId(job.id); rememberJob(job.id);
    appliedResult.current = '';
    setError(''); setErrorStatus(undefined); setModal(null); setDirty(false); setRevision('');
    if (job.outline) { acceptOutline(job.outline, job.status === 'completed'); setBrief(job.outline.brief); }
    else if (job.input.kind === 'outline') { setBrief(job.input.brief); setOutline(null); setEdits([]); }
    setResult(job.result || null); setRenderBundles(job.renderBundles); setTitleIndexes({});
    if (job.result) { setResultSnapshot(job.outline); setResultHistory(job.outline?.history); }
    const first = job.result?.drafts[0]?.platform || job.channels[0]?.platform;
    if (first) setActivePlatform(first);
    if (job.input.kind === 'render') {
      void work('载入成品正文', async signal => {
        const detail = await api<RunDetail>(`/api/runs/${encodeURIComponent(job.input.kind === 'render' ? job.input.request.runId : '')}`, 'GET', undefined, signal);
        if (selectedJobRef.current !== job.id) return;
        setResult(detail.result); setBrief(detail.result.brief); setResultSnapshot(detail.outlineSnapshot); setResultHistory(detail.history); setRenderBundles(mergeJobBundles(detail.renderBundles, job.renderBundles));
      });
    }
    setStep(job.kind === 'generate' || job.kind === 'render' ? 6 : 5);
  }
  useEffect(() => {
    if (!selectedJob || selectedJobRef.current !== selectedJob.id) return;
    if (selectedJob.detailOmitted) { void background.loadJob(selectedJob.id).catch(reason => { if (selectedJobRef.current === selectedJob.id) setMessage(`任务详情暂未载入：${errorText(reason)} 可在任务中心重新打开。`); }); return; }
    const next = selectedJob.outline;
    const outlineKey = next ? `${selectedJob.id}:${next.id}:${next.version}:${next.status}` : '';
    if (next && !appliedOutline.current.has(outlineKey) && !dirty) {
      acceptOutline(next, selectedJob.status === 'completed'); setBrief(next.brief); appliedOutline.current.add(outlineKey);
    }
    if (selectedJob.result && appliedResult.current !== `${selectedJob.result.id}:${selectedJob.result.revision}`) {
      setResult(selectedJob.result); setResultSnapshot(next); setResultHistory(next?.history);
      appliedResult.current = `${selectedJob.result.id}:${selectedJob.result.revision}`;
    }
    setRenderBundles(current => mergeJobBundles(current, selectedJob.renderBundles));
    if (selectedJob.status === 'completed' && !historyRefreshed.current.has(selectedJob.id)) { historyRefreshed.current.add(selectedJob.id); void refreshHistory(new AbortController().signal); }
    if (selectedJob.status === 'completed' && next && !selectedJob.result && !validatedOutlines.current.has(selectedJob.id)) {
      validatedOutlines.current.add(selectedJob.id); const jobId = selectedJob.id;
      void api<OutlineResult>(`/api/outlines/${encodeURIComponent(next.id)}`).then(latest => { if (selectedJobRef.current === jobId) { acceptOutline(latest); setBrief(latest.brief); } }).catch(() => {});
    }
    if (selectedJob.result && !validatedResults.current.has(selectedJob.id)) {
      validatedResults.current.add(selectedJob.id); const jobId = selectedJob.id; const runId = selectedJob.result.id;
      setOutlineReadOnly(true);
      void (async () => {
        const detail = await api<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
        const snapshot = detail.outlineSnapshot || selectedJob.outline;
        let latest: OutlineResult | undefined;
        if (snapshot) { try { latest = await api<OutlineResult>(`/api/outlines/${encodeURIComponent(snapshot.id)}`); } catch { /* History can remain readable after the current outline expires. */ } }
        if (selectedJobRef.current !== jobId) return;
        setResultHistory(detail.history); setResultSnapshot(snapshot);
        if (snapshot) acceptOutline(snapshot, latest?.version !== snapshot.version || detail.history.evidenceStatus !== 'ready');
        setRenderBundles(current => mergeJobBundles(current, detail.renderBundles));
      })().catch(() => { /* Keep the immutable snapshot readable until a successful latest-version check. */ });
    }
  }, [selectedJob, selectionNonce]);
  useEffect(() => {
    if (!result) return;
    for (const job of background.jobs) if (job.detailOmitted && job.kind === 'render' && job.input.kind === 'render' && job.input.request.runId === result.id && job.input.request.revision === result.revision) void background.loadJob(job.id).catch(() => {});
    const incoming = background.jobs.flatMap(job => job.renderBundles).filter(bundle => bundle.runId === result.id && bundle.revision === result.revision);
    if (incoming.length) setRenderBundles(current => mergeJobBundles(current, incoming));
  }, [background.jobs, result?.id]);
  async function queue(input: JobInput, scope: string, select = true) {
    const epoch = selectionEpoch.current; setSubmitting(true); setError(''); setErrorStatus(undefined);
    try {
      const job = await background.enqueue(input, scope);
      if (select && epoch === selectionEpoch.current) openJob(job);
      else setMessage('任务已加入后台队列，可在任务中心查看。');
      return job;
    } catch (reason) { if (epoch === selectionEpoch.current) { setError(errorText(reason)); setErrorStatus(reason instanceof ApiError ? reason.status : undefined); } throw reason; }
    finally { setSubmitting(false); }
  }
  function makeOutline() { void queue({ kind: 'outline', brief: structuredClone(brief) }, `outline:${formIdentity.current}`).catch(() => {}); }
  function save() { if (!outline || outlineReadOnly || invalidImages || outlineJobBusy) return; const id = outline.id; const epoch = selectionEpoch.current; void work('保存大纲', async signal => { const platforms = edits.map(p => ({ ...p, sections: p.sections.map(s => ({ ...s, points: s.points.map(point => point.trim()).filter(Boolean) })) })); const next = await api<OutlineResult>(`/api/outlines/${id}`, 'PUT', { version: outline.version, platforms }, signal); if (!signal.aborted && epoch === selectionEpoch.current) { acceptOutline(next); remember('outline', next.id); setMessage('已保存为新版本，请重新确认。'); await refreshHistory(signal); } }); }
  function revise(platform: Platform) { if (!outline || outlineReadOnly || dirty || !revision.trim() || outlineJobBusy) return; void queue({ kind: 'outline-revise', outlineId: outline.id, version: outline.version, instructions: revision, platforms: [platform] }, `revise:${outline.id}:${outline.version}:${revision}:${platform}`).catch(() => {}); }
  function confirm() { if (!outline || outlineReadOnly || dirty || invalidImages || outlineJobBusy) return; const epoch = selectionEpoch.current; void work('确认当前大纲', async signal => { const next = await api<OutlineResult>(`/api/outlines/${outline.id}/confirm`, 'POST', { version: outline.version }, signal); if (!signal.aborted && epoch === selectionEpoch.current) { acceptOutline(next); remember('outline', next.id); setMessage('本版大纲已确认，可以加入生成队列。'); await refreshHistory(signal); } }); }
  function generate() {
    if (!outline || outlineReadOnly || outline.status !== 'confirmed' || dirty || invalidImages || outlineJobBusy) return;
    void queue({ kind: 'generate', outlineId: outline.id, version: outline.version }, `generate:${outline.id}:${outline.version}`).catch(() => {});
  }
  async function queueRender(request: RenderRequest) { return queue({ kind: 'render', request }, `render:${request.runId}:${request.revision}:${request.platform}:${request.selectedTitleIndex}:${request.templateId}:${request.deliveryId || 'run'}:${request.visualMode || 'local'}:${request.canvaSync ? 'sync' : 'render'}:${request.regenerateVisual ? 'regenerate' : 'reuse'}`, false); }
  function jobAction(job: BackgroundJob, action: 'cancel' | 'retry') { void background.action(job, action).catch(reason => setMessage(errorText(reason))); }
  function newTask() { detachJob(); formIdentity.current = crypto.randomUUID(); setOutline(null); setOutlineReadOnly(false); setDirty(false); setEdits([]); setResult(null); setResultSnapshot(undefined); setResultHistory(undefined); setRenderBundles([]); setTrace([]); setStep(1); setError(''); try { localStorage.removeItem(selectionKey); } catch { /* Browser storage is optional. */ } }
  function replan(source: Brief) { newTask(); setBrief(structuredClone(source)); setMessage('已带回原任务条件，请核对后点击生成大纲；不会自动调用模型。'); }
  function loadLatestOutline() { if (!outline) return; const epoch = selectionEpoch.current; void work('载入最新大纲', async signal => { const next = await api<OutlineResult>(`/api/outlines/${encodeURIComponent(outline.id)}`, 'GET', undefined, signal); if (!signal.aborted && epoch === selectionEpoch.current) { acceptOutline(next); setBrief(next.brief); remember('outline', next.id); setStep(5); } }); }
  function backToOutline() {
    if (!result) return;
    const epoch = selectionEpoch.current;
    if (!result.outline) { replan(result.brief); return; }
    void work('核对作品的大纲版本', async signal => { let latest: OutlineResult | undefined; try { latest = await api<OutlineResult>(`/api/outlines/${encodeURIComponent(result.outline!.id)}`, 'GET', undefined, signal); } catch { signal.throwIfAborted(); }
      if (signal.aborted || epoch !== selectionEpoch.current) return; const matches = latest?.id === result.outline!.id && latest.version === result.outline!.version;
      const snapshot = resultSnapshot || (outline?.id === result.outline!.id && outline.version === result.outline!.version ? outline : undefined);
      if (matches || snapshot) { acceptOutline(matches ? latest! : snapshot!, !matches || resultHistory?.evidenceStatus === 'refresh_required'); setStep(5); if (!matches) setMessage(`此作品的大纲 v${result.outline!.version}仅供阅读，可载入最新大纲或按原任务重新策划。`); }
      else replan(result.brief);
    });
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setMessage('已复制'); } catch { setError('剪贴板权限不可用，请使用下载。'); } }
  const liveReady = !!status?.model.configured && (brief.knowledgeSource === 'ima' ? !!status?.ima.verified : !!status?.local.available);
  const canPlan = brief.productId && brief.scene.trim() && brief.audience.trim() && brief.platforms.length && (brief.mode === 'demo' ? !!status?.local.available : liveReady);
  const draft = result?.drafts.find(d => d.platform === activePlatform);
  const draftDeliveryKey = result && draft ? `${result.id}:${result.revision}:${draft.platform}` : '';
  const blockingIssues = result?.review.issues.filter(issue => issue.severity === 'error') || [];
  const draftBlocked = deliveryBlocked[draftDeliveryKey] ?? (result?.review.status === 'blocked' && (!blockingIssues.length || blockingIssues.some(issue => !issue.platform || issue.platform === draft?.platform)));
  const displayedBrief = step === 6 && result ? result.brief : brief;
  const imageBounds = (platform: Platform) => options?.platforms.find(p => p.id === platform);
  const invalidImages = !options || edits.some(p => { const bounds = imageBounds(p.platform); return !bounds || p.imageIds.length < bounds.minImages || p.imageIds.length > bounds.maxImages || new Set(p.imageIds).size !== p.imageIds.length || p.imageIds.some(id => !outline?.evidence.images.some(image => image.id === id && image.productId === outline.product.id)); });

  const closeModal = () => { if (pendingAction) setPendingAction(null); else setModal(null); };
  const modalTitle = pendingAction ? '当前方案还有未保存修改' : ({ settings: '接入设置', history: '最近七天记录', menu: '菜单', evidence: '核验与来源', outlineSources: '方案依据与配图', tasks: '后台任务' } as const)[modal || 'menu'];
  const reviewIcon = result?.review.status === 'blocked' ? <CircleX size={20} /> : result?.review.status === 'needs_attention' ? <TriangleAlert size={20} /> : <CheckCircle2 size={20} />;
  return <div className="virgo-root">
    {(showHome || leavingHome) && <div className={leavingHome ? 'virgo-cover-exit' : ''} inert={leavingHome} aria-hidden={leavingHome || undefined}><VirgoLanding onStart={enterWorkbench} disabled={leavingHome} returning={returning} transitioning={leavingHome} /></div>}
    <div hidden={showHome} className={`virgo-workbench ${leavingHome ? 'workbench-enter' : ''}`} data-busy={!!busy}>
      <WorkbenchBackground background={ambience} />
      <div className="virgo-paper">
        <header className="workbench-header"><button className="wordmark" aria-label="Virgo，返回填写需求" disabled={false} onClick={() => guarded(() => setStep(1))}>Virgo</button><nav aria-label="工作台导航"><Button variant="ghost" className="desktop-task-action" onClick={() => guarded(newTask)}><Plus size={16} />新建任务</Button><Button variant="ghost" className="desktop-task-action" onClick={() => setModal('tasks')}>任务中心{background.jobs.filter(activeJob).length > 0 ? ` · ${background.jobs.filter(activeJob).length}` : ''}</Button><WorkbenchBackgroundControl background={ambience} /><Button variant="ghost" className="desktop-settings" disabled={false} onClick={openSettings}>接入设置</Button><Button variant="ghost" className="mobile-menu" disabled={false} onClick={() => setModal('menu')}>菜单</Button><Button variant="ghost" disabled={false} onClick={home}>首页</Button></nav></header>
        <nav className="workbench-steps" aria-label="创作步骤">{steps.map((item, i) => <Button key={item.id} variant="ghost" className={`${step === item.id ? 'current' : ''} ${step > item.id ? 'complete' : ''}`} aria-current={step === item.id ? 'step' : undefined} disabled={item.id === 5 && !outline && selectedJob?.kind !== 'outline' || item.id === 6 && !result && selectedJob?.kind !== 'generate'} onClick={() => guarded(() => { if (item.id === 5 && step === 6 && result) backToOutline(); else setStep(item.id); setError(''); setErrorStatus(undefined); })}><span className="sr-only">第{i + 1}步：</span>{item.label}</Button>)}</nav>
        <main id="workbench-main" tabIndex={-1} className="workbench-main" key={step}>
          {error && <div className="error" role="alert"><strong>这一步暂未完成</strong><p>{error}</p>{errorStatus === 409 && outline && <Button disabled={false} onClick={() => guarded(() => void work('载入最新方案', async signal => { const next = await api<OutlineResult>(`/api/outlines/${outline.id}`, 'GET', undefined, signal); if (!signal.aborted) acceptOutline(next); }))}>载入服务器方案（放弃未保存编辑）</Button>}{errorStatus === 410 && <Button disabled={false} onClick={() => { setStep(1); setError(''); }}>返回需求重新生成方案</Button>}{!errorStatus && <Button disabled={false} onClick={() => { setError(''); setLoadKey(k => k + 1); }}>重新载入工作台信息</Button>}</div>}
          {message && <div className="success" role="status">{message}</div>}
          {background.jobs.some(activeJob) && <div className="background-task-strip"><div><p><strong>{background.jobs.filter(activeJob).length} 个任务在后台处理中</strong></p><p className="caption">可以继续查看其他渠道、历史记录或新建任务。</p></div><Button onClick={() => setModal('tasks')}>查看任务中心</Button></div>}
          {selectedJob && !result && (step === 6 || step === 5 && !outline) && <PendingJob job={selectedJob} activePlatform={activePlatform} onPlatform={setActivePlatform} onAction={jobAction} actionPending={background.pending.includes(selectedJob.id)} onJob={background.retain} />}

          {step === 1 && <TaskForm brief={brief} products={products} options={options} status={status} busy={submitting} canPlan={!!canPlan} loading={loading} update={update} onGenerate={makeOutline} onSettings={openSettings} onHistory={() => setModal('history')} />}
          {step === 5 && outline && selectedJob?.error && <div className="error" role="alert"><p>{selectedJob.error.message}</p>{selectedJob.error.outcomeUnknown && <p>上游可能已产生消耗，重试可能再次计费。</p>}<Button disabled={background.pending.includes(selectedJob.id) || selectedJob.error.retryable === false} onClick={() => jobAction(selectedJob, 'retry')}>重试失败步骤</Button></div>}
          {step === 5 && outline && <OutlinePage outline={outline} edits={edits} dirty={dirty} readOnly={outlineReadOnly} busy={!!busy || submitting || outlineJobBusy} invalidImages={invalidImages} options={options} revision={revision} onRevision={setRevision} onChange={changeOutline} onSave={save} onConfirm={confirm} onGenerate={generate} onRevise={revise} onBack={() => guarded(() => setStep(1))} onLoadLatest={() => guarded(loadLatestOutline)} onReplan={() => guarded(() => replan(outline.brief))} onSources={() => setModal('outlineSources')} />}
          {step === 6 && result && draft && <>
            <div className="page-title"><h1>营销内容与成品</h1><p>{result.product.name} · {result.brief.scene} · {result.brief.audience}</p></div>
            <div className={`review-banner ${result.review.status}`} role="status">{reviewIcon}<div><strong>{reviewName[result.review.status]}</strong><p>{result.notice}</p></div></div>
            {resultHistory?.evidenceStatus === 'refresh_required' && <div className="warning status-note" role="status"><p>此历史正文的来源需要重新获取；可阅读原稿，不能继续排版。</p><Button disabled={false} onClick={() => replan(result.brief)}>按原任务重新策划</Button></div>}
            {resultHistory?.interrupted && <p className="warning">上次操作已中断，已保存内容仍保留。核对后可重新操作。</p>}
            <div className="delivery-meta"><span>大纲 v{result.outline?.version || '—'} · 正文 v{result.revision}{mockLabel ? ' · 纯模拟流程' : result.brief.mode === 'demo' ? ' · 本地规则演示' : ' · 模型创作'}</span><Button variant="ghost" disabled={false} onClick={() => guarded(newTask)}><Plus size={16} />新建任务</Button></div>
            <div className="channel-tabs" role="tablist" aria-label="成品渠道">{result.drafts.map(d => <Button key={d.platform} role="tab" tabIndex={activePlatform === d.platform ? 0 : -1} onKeyDown={moveTab} aria-selected={activePlatform === d.platform} className={activePlatform === d.platform ? 'selected' : ''} variant="ghost" disabled={false} onClick={() => setActivePlatform(d.platform)}>{names[d.platform]}</Button>)}</div>
            <div className="mobile-delivery-tabs" role="tablist" aria-label="交付视图"><Button role="tab" onKeyDown={moveTab} variant="ghost" aria-selected={deliveryView === 'copy'} className={deliveryView === 'copy' ? 'selected' : ''} disabled={false} onClick={() => setDeliveryView('copy')}>文案</Button><Button role="tab" onKeyDown={moveTab} variant="ghost" aria-selected={deliveryView === 'visual'} className={deliveryView === 'visual' ? 'selected' : ''} disabled={false} onClick={() => setDeliveryView('visual')}>视觉成品</Button></div>
            <div className="delivery-layout">
              <article className="delivery-copy" data-mobile-hidden={deliveryView !== 'copy'}><h2>文案</h2><h3>{draft.titles[titleIndexes[draft.id] || 0]}</h3><div className="title-choices">{draft.titles.map((title, i) => <Button key={i} variant="ghost" aria-pressed={(titleIndexes[draft.id] || 0) === i} className={(titleIndexes[draft.id] || 0) === i ? 'selected' : ''} disabled={false} title={title} onClick={() => setTitleIndexes(current => ({ ...current, [draft.id]: i }))}>标题 {i + 1}{(titleIndexes[draft.id] || 0) === i ? ' · 已选' : ''}</Button>)}</div><DraftContent draft={draft} result={result} />
                <p className="caption">{mockLabel ? '纯模拟示例 · 非真实产品参数、图片或生成结果' : result.brief.mode === 'demo' ? '本地规则演示 · 发布前请人工核实内容与来源' : '请在发布前核实来源、适用条件和图片。'}</p>
                <div className="copy-actions"><Button variant="primary" disabled={draftBlocked} onClick={() => void copy([draft.titles[titleIndexes[draft.id] || 0], draft.intro, ...draft.blocks.map(b => `${b.heading}\n${b.text}`), draft.cta, draft.tags.join(' ')].join('\n\n'))}><Copy size={16} />复制正文</Button><Button disabled={false} onClick={backToOutline}><FileText size={16} />返回方案调整</Button><Button variant="ghost" disabled={result.review.status === 'blocked'} onClick={() => downloadMarkdown(result)}><Download size={16} />下载方案说明</Button></div>
              </article>
              <div className="delivery-visual" data-mobile-hidden={deliveryView !== 'visual'}><RenderPanel key={`${result.id}:${draft.id}`} result={result} draft={draft} titleIndex={titleIndexes[draft.id] || 0} templates={templates} restoredBundles={renderBundles} parentBusy={false} jobs={background.jobs} onEnqueue={queueRender} onCancel={job => jobAction(job, 'cancel')} allowRender={resultHistory?.evidenceStatus !== 'refresh_required'} onJob={background.retain} onDelivery={delivery => { const key = `${delivery.runId}:${delivery.revision}:${delivery.platform}`; const blocked = delivery.review.status === 'blocked'; setDeliveryBlocked(current => current[key] === blocked ? current : { ...current, [key]: blocked }); }} onBundle={bundle => setRenderBundles(current => [bundle, ...current.filter(b => b.id !== bundle.id)])} /></div>
            </div>
            <Button variant="ghost" className="sources-toggle" onClick={() => { setEvidenceTab('review'); setFocusFact(undefined); setModal('evidence'); }}><BookOpen size={16} />核验与来源 · 事实原文 / 适用条件 / 来源图片</Button>
            <p className={draftBlocked ? 'warning blocked-message' : 'caption'}>{draftBlocked ? '本渠道存在阻断问题。请返回方案调整后，重新保存、确认与生成；其他通过渠道可独立使用。' : '方案与正文保留七天；来源和成品按各自有效期使用，请及时下载。'}</p>
            <ChannelComparison result={result} onSelect={platform => { setActivePlatform(platform); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }} />
          </>}
        </main>
        <footer className="workbench-footer"><p>Virgo · 拾穗 <span>AI 辅助创作 · 发布前请人工复核</span></p><p className="caption">{mockLabel ? `纯模拟开发 · ${mockLabel} · 不调用模型或 ima，不能用于真实发布。` : displayedBrief.mode === 'demo' ? '本地规则演示' : `模型创作 · ${displayedBrief.knowledgeSource === 'ima' ? 'ima' : '本地资料'}`}</p></footer>
      </div>
      {busy && <div className="busy-panel" role="status"><div className="busy-heading"><LoaderCircle className="spin" size={20} /><div><strong>{busy}</strong><p className="caption">正在处理实际任务阶段</p></div><Button onClick={() => controller.current?.abort()}><Square size={14} />停止</Button></div>{trace.length > 0 && <ol>{trace.map(t => <li key={t.step}><span>{t.status === 'running' ? '进行中' : t.status === 'done' ? '完成' : '停止'}</span><div>{t.label}<p className="caption">{t.detail}</p></div></li>)}</ol>}</div>}
      {modal === 'tasks' && !mobileTasks && <aside className="desktop-task-center" aria-label="任务中心"><div className="task-panel-close"><Button variant="ghost" className="icon-button" aria-label="关闭任务中心" onClick={() => setModal(null)}><X size={20} /></Button></div><TaskCenter jobs={background.jobs} selectedId={selectedJobId} connected={background.connected} loading={background.loading} error={background.error} pending={background.pending} onOpen={job => guarded(() => openJob(job))} onAction={jobAction} /></aside>}
      <Drawer open={!!pendingAction || !!modal && (modal !== 'tasks' || mobileTasks)} onClose={closeModal} title={modalTitle} className={pendingAction ? 'confirm-dialog' : ''}>
        {pendingAction ? <><p>继续操作会放弃当前未保存的修改。你也可以关闭此提示，先保存方案。</p><div className="dialog-actions"><Button onClick={() => setPendingAction(null)}>保留修改</Button><Button variant="primary" onClick={() => { const action = pendingAction; setPendingAction(null); action(); }}>放弃修改并继续</Button></div></> : <>
          {modal === 'tasks' && <TaskCenter compact jobs={background.jobs} selectedId={selectedJobId} connected={background.connected} loading={background.loading} error={background.error} pending={background.pending} onOpen={job => guarded(() => openJob(job))} onAction={jobAction} />}
          {modal === 'menu' && <div className="menu-actions"><Button variant="ghost" onClick={() => guarded(() => { newTask(); setModal(null); })}><Plus size={18} />新建任务</Button><Button variant="ghost" onClick={() => setModal('tasks')}>任务中心</Button><Button variant="ghost" onClick={openSettings}><Settings size={18} />接入设置</Button><Button variant="ghost" disabled={loading} onClick={() => setModal('history')}><History size={18} />最近七天记录</Button></div>}
          {modal === 'settings' && <><p className="caption">由开发者提前配置。日常创作直接从填写需求开始。</p><CanvaConnection /><ConnectionForm status={status} onStatus={setStatus} onError={setError} onMessage={setMessage} work={work} busy={!!busy} /><div className="mode-choice"><Button aria-pressed={brief.mode === 'demo'} className={brief.mode === 'demo' ? 'selected' : ''} disabled={false} onClick={() => switchMode('demo')}><span>本地规则演示<small>不调用模型，仍需获授权的产品资料</small></span></Button><Button aria-pressed={brief.mode === 'live'} className={brief.mode === 'live' ? 'selected' : ''} disabled={!status?.model.configured} onClick={() => switchMode('live')}><span>模型创作<small>真实策划、写作与独立审稿</small></span></Button></div>{brief.mode === 'live' && <label className="field">产品知识来源<select value={brief.knowledgeSource} disabled={false} onChange={e => { const next = e.target.value as Brief['knowledgeSource']; guarded(() => { update('knowledgeSource', next); setStep(1); setModal(null); }); }}><option value="local">本地资料</option><option value="ima" disabled={!status?.ima.verified}>ima 共享库{status?.ima.verified ? ' · 已验证' : ' · 请先验证'}</option></select></label>}<Button disabled={false} variant="primary" onClick={() => setModal(null)}>返回创作<ArrowRight size={16} /></Button></>}
          {modal === 'history' && <><p>方案与正文保留七天。来源与成品按各自有效期使用。</p><div className="history-list">{history.length ? history.map(item => <article className="history-item" key={`${item.kind}:${item.id}`}><h3>{item.productName}</h3><p>{item.audience} · {item.scene}</p><p className="caption">{item.platforms.map(p => names[p]).join(' / ')} · {item.kind === 'outline' ? `方案 v${item.version}` : `正文 v${item.revision}`}</p><p className="caption">{formatTime(item.updatedAt)}</p>{item.reviewStatus && <strong className={item.reviewStatus === 'blocked' ? 'blocked-message' : ''}>{reviewName[item.reviewStatus]}</strong>}{item.evidenceStatus === 'refresh_required' && <p className="caption">来源需重新获取。历史正文仍可阅读，过期成品不能继续下载。</p>}{item.interrupted && <p className="caption">上次操作已中断，已保存内容仍保留。不会自动重新调用模型。</p>}<Button disabled={loading} onClick={() => guarded(() => { setModal(null); void work('恢复历史记录', signal => restoreSelection(item.kind, item.id, signal)); })}>打开记录</Button></article>) : <div className="empty-state"><h3>还没有创作记录</h3><p>完成一次营销方案后，可以在这里继续查看。</p></div>}</div></>}
          {modal === 'evidence' && result && <EvidencePanel result={result} busy={!!busy} onOutline={() => { setModal(null); backToOutline(); }} onReplan={() => { setModal(null); replan(result.brief); }} initialTab={evidenceTab} focusFact={focusFact} />}
          {modal === 'outlineSources' && outline && <><p className="caption">{outline.product.name} · 方案 v{outline.version}</p><p className="status-note">方案确认代表表达方向已确定，正文仍需独立审核。</p>{outline.warnings.map((w, i) => <p className="warning" key={i}>{w}</p>)}{outline.evidence.facts.map((fact, i) => <section className="fact-card" key={fact.id}><span className="caption">依据 {i + 1} · {fact.status === 'supported' ? '原文支持' : '待确认'}</span><h3>{fact.statement}</h3><details><summary>原文与适用条件</summary><blockquote>{fact.quote}</blockquote>{fact.qualifiers.map((q, j) => <p key={j}>{q}</p>)}<small>{fact.sourceTitle}</small></details></section>)}<h3>同型号来源图片</h3><div className="source-images">{outline.evidence.images.map(img => <figure key={img.id}><img src={img.url} alt={img.name} /><figcaption>{img.name}</figcaption></figure>)}</div></>}
        </>}
      </Drawer>
    </div>
  </div>;
}

function PendingJob({ job, activePlatform, onPlatform, onAction, actionPending, onJob }: { job: BackgroundJob; activePlatform: Platform; onPlatform: (platform: Platform) => void; onAction: (job: BackgroundJob, action: 'cancel' | 'retry') => void; actionPending: boolean; onJob: (job: BackgroundJob) => void }) {
  const channel = job.channels.find(item => item.platform === activePlatform) || job.channels[0];
  const preview = channel?.preview; const bundle = preview?.bundle;
  const stages = { retrieve: '读取资料', outline: '策划方案', write: '写作', review: '独立审稿', repair: '定向返修', recheck: '复审', design:'设计简报',image:'生成视觉',compose:'分层制作',canva_import:'导入 Canva',canva_edit:'核对 Canva 图层',canva_export:'导出 Canva',render: '排版', publish: '渠道交付' };
  return <section className="job-waiting" aria-label="当前后台任务">
    <div className="page-title"><h1>{jobTitle(job)}</h1><p>{job.outline?.product.name || ''} · {jobStatusLabel[job.status]}</p></div>
    <div className="channel-tabs" role="tablist" aria-label="任务渠道">{job.channels.map(item => <Button key={item.platform} role="tab" variant="ghost" aria-selected={channel?.platform === item.platform} tabIndex={channel?.platform === item.platform ? 0 : -1} onKeyDown={moveTab} className={channel?.platform === item.platform ? 'selected' : ''} onClick={() => onPlatform(item.platform)}>{names[item.platform]} · {jobStatusLabel[item.status]}</Button>)}</div>
    <p className="job-preview-notice" role="status">{activeJob(job) ? '任务在后台继续执行，可以查看其他渠道、历史记录或新建任务。' : '已完成的阶段仍然保留。'} 每个渠道独立审稿与交付，其他渠道失败不影响已通过内容。</p>
    {channel && <p><strong>{names[channel.platform]}</strong> · {stages[channel.stage]} · {jobStatusLabel[channel.status]}</p>}
    {(channel?.error || (!job.error?.platform ? job.error : undefined)) && <div className="error" role="alert"><p>{(channel?.error || (!job.error?.platform ? job.error : undefined))!.message}</p>{(channel?.error || (!job.error?.platform ? job.error : undefined))!.outcomeUnknown && <p>上游可能已经产生消耗。重试只续跑失败步骤，仍可能再次计费。</p>}</div>}
    {channel?.delivery && <ChannelDeliveryPanel delivery={channel.delivery} onJob={onJob} />}
    {!channel?.delivery && preview && <article className="job-preview-copy"><h2>{preview.draft.titles[0]}</h2><p>{preview.draft.intro}</p>{preview.draft.blocks.map(block => <section key={block.id}><h3>{block.heading}</h3><p>{block.text}</p></section>)}<p>{preview.draft.cta}</p><p className="caption">渠道审核：{reviewName[preview.review.status]}</p></article>}
    {!channel?.delivery && bundle && Date.parse(bundle.expiresAt) > Date.now() && <div className="job-preview-artifacts">{bundle.artifacts.map(artifact => <figure key={artifact.id}>{artifact.format === 'wechat-richtext' ? <iframe src={artifact.previewUrl} title={`${artifact.name}成品预览`} sandbox="" /> : <img src={artifact.previewUrl} alt={`${artifact.name}`} loading="lazy" />}<figcaption>{artifact.name}</figcaption></figure>)}</div>}
    {!preview && <p className="caption">{activeJob(job) ? '这一渠道完成写作和独立审稿后，预览会出现在这里。' : '这一渠道尚未产生可用预览。'}</p>}
    <div className="task-item-actions">{activeJob(job) && <Button disabled={actionPending} onClick={() => onAction(job, 'cancel')}><Square size={14} />停止此任务</Button>}{['failed', 'interrupted'].includes(job.status) && job.error?.retryable !== false && <Button disabled={actionPending} onClick={() => onAction(job, 'retry')}>重试失败步骤{job.error?.outcomeUnknown ? '（可能再次计费）' : ''}</Button>}</div>
  </section>;
}

function formatTime(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '时间待确认'; }

function ConnectionForm({ status, onStatus, onError, onMessage, work, busy }: { status: AppStatus | null; onStatus: (s: AppStatus) => void; onError: (s: string) => void; onMessage: (s: string) => void; work: Work; busy: boolean }) {
  const [fields, setFields] = useState({ baseUrl: '', model: '', apiKey: '', imaClientId: '', imaApiKey: '', imaKbName: '' }); const [unsaved, setUnsaved] = useState(false);
  async function save(signal: AbortSignal) { const next = await api<AppStatus>('/api/connections/settings', 'POST', Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim())), signal); if (!signal.aborted) { onStatus(next); setFields({ baseUrl: '', model: '', apiKey: '', imaClientId: '', imaApiKey: '', imaKbName: '' }); setUnsaved(false); onMessage(mockLabel ? '纯模拟：未保存配置，未调用真实服务。' : '配置已保存在服务端内存；重启后恢复环境配置。'); } }
  function verify(model: boolean) { if (unsaved) { onError('请先保存配置，再验证连接。'); return; } void work(model ? '验证模型连接' : '验证 ima 共享库', async signal => { if (model) { const verification = await api<{ verified: boolean; message: string }>('/api/connections/model/verify', 'POST', {}, signal); if (!signal.aborted) onMessage(verification.message); } else { const next = await api<AppStatus>('/api/connections/verify', 'POST', {}, signal); if (!signal.aborted) { onStatus(next); onMessage(next.ima.message); } } }); }
  return <><div className="connection-status"><span className={status?.model.configured ? 'ok' : ''}>{status?.model.configured ? '● 模型已配置' : '○ 模型待配置'}</span><span className={status?.ima.verified ? 'ok' : ''}>{status?.ima.verified ? '● ima 已验证' : status?.ima.configured ? '○ ima 待验证' : '○ ima 待配置'}</span></div><details><summary>API、模型与 ima ID 设置</summary><form onSubmit={e => { e.preventDefault(); void work('保存接入配置', save); }} autoComplete="off"><fieldset disabled={busy} className="connection-fields">{([
    ['baseUrl', '模型 Base URL', status?.model.baseUrl || 'https://relay.nccnxta.cn/v1', false], ['model', '模型名称', status?.model.name || 'gpt-6.1-sol', false], ['apiKey', '模型 API Key', status?.model.configured ? '已配置；留空保留' : '填写 API Key', true], ['imaClientId', 'ima Client ID', status?.ima.configured ? '已配置；留空保留' : '填写 Client ID', true], ['imaApiKey', 'ima API Key', status?.ima.configured ? '已配置；留空保留' : '填写 API Key', true], ['imaKbName', 'ima 共享库名称', status?.ima.kbName || '填写库名', false],
  ] as const).map(([key, label, placeholder, secret]) => <label className="field" key={key}>{label}<input type={secret ? 'password' : 'text'} maxLength={secret ? 500 : 300} autoComplete="off" value={fields[key]} placeholder={placeholder} onChange={e => { setFields(current => ({ ...current, [key]: e.target.value })); setUnsaved(true); }} /></label>)}<p className="caption">密钥仅提交到本地后端，不进入浏览器存储或文档。空白保留已有设置。本 Demo 为本机单人工作台。</p><button type="submit" disabled={!unsaved || busy}>保存接入配置</button></fieldset></form></details><div className="row wrap connection-buttons"><button disabled={busy || !status?.model.configured || unsaved} onClick={() => verify(true)}>验证模型（会调用接口）</button><button disabled={busy || !status?.ima.configured || unsaved} onClick={() => verify(false)}>验证 ima</button></div></>;
}
function DraftContent({ draft, result }: { draft: Draft; result: RunResult }) {
  const pictures = (index: number) => draft.images.filter(p => p.afterBlock === index).map(p => { const image = result.evidence.images.find(i => i.id === p.imageId); return image && <figure className="draft-image" key={image.id}><img src={image.url} alt={image.name} /><figcaption>{p.caption || image.name}</figcaption></figure>; });
  return <div className="draft-body">{pictures(-1)}<p>{draft.intro}</p>{draft.blocks.map((block, i) => <section key={block.id}><h3>{block.heading}</h3><p>{block.text}</p><div className="citation-links">{block.factIds.map(id => <a key={id} href={`#evidence-${id}`} onClick={event => { event.preventDefault(); window.dispatchEvent(new CustomEvent('zhixu:evidence', { detail: id })); }}>依据 {result.evidence.facts.findIndex(f => f.id === id) + 1}</a>)}</div>{pictures(i)}</section>)}<p className="draft-cta">{draft.cta}</p><p className="tags">{draft.tags.map(t => `#${t.replace(/^#/, '')}`).join(' ')}</p></div>;
}
function EvidencePanel({ result, busy, onOutline, onReplan, initialTab = 'review', focusFact }: { result: RunResult; busy: boolean; onOutline: () => void; onReplan: () => void; initialTab?: 'facts' | 'review' | 'strategy'; focusFact?: string }) {
  const [tab, setTab] = useState<'facts' | 'review' | 'strategy'>(initialTab);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  useEffect(() => { if (!focusFact) return; setTab('facts'); const timer = window.setTimeout(() => document.getElementById(`evidence-${focusFact}`)?.scrollIntoView({ block: 'center' }), 100); return () => window.clearTimeout(timer); }, [focusFact]);
  useEffect(() => {
    const show = (event: Event) => { const id = (event as CustomEvent<string>).detail; setTab('facts'); window.setTimeout(() => document.getElementById(`evidence-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); };
    window.addEventListener('zhixu:evidence', show); return () => window.removeEventListener('zhixu:evidence', show);
  }, [result.id]);
  return <aside className="evidence-panel paper"><div className="evidence-tabs"><button className={tab === 'review' ? 'selected' : ''} onClick={() => setTab('review')}>审核</button><button className={tab === 'facts' ? 'selected' : ''} onClick={() => setTab('facts')}>依据</button><button className={tab === 'strategy' ? 'selected' : ''} onClick={() => setTab('strategy')}>策略</button></div><h3>{tab === 'review' ? '发布前，再确认一次。' : tab === 'facts' ? '每个卖点，都有出处。' : '为什么这样表达？'}</h3>{tab === 'review' && <>{result.review.status === 'blocked' && <p className="warning">存在审核阻断问题。各渠道按自己的审核结果开放复制与下载；请核对涉及渠道并修改方案。</p>}<p className="caption">{result.review.reviewedBy === 'rules' ? '规则检查，未进行独立模型审稿' : '规则检查 + 独立模型审稿'}</p>{result.review.checks.map((c, i) => <div className="review-item" key={i}><b>{c.status === 'pass' ? '✓' : '!'} {c.label}</b><p>{c.detail}</p></div>)}{result.review.issues.map(issue => <div className={`review-item issue-${issue.severity}`} key={issue.id}><b>{issue.severity === 'error' ? '需修正' : '待确认'}</b><p>{issue.message}</p><small>{issue.suggestion}</small>{issue.platform && <small>涉及渠道：{names[issue.platform]}</small>}{issue.target && <small>处理位置：{({ title: "标题", intro: "导语", heading: "段落标题", body: "正文", cta: "行动引导", tags: "话题", images: "配图", references: "依据引用", structure: "大纲结构", source: "资料来源" })[issue.target]}</small>}{(issue.resolution === "edit_outline" || !issue.resolution) && <button disabled={busy} onClick={onOutline}>返回方案修改</button>}{issue.resolution === "refresh_evidence" && <button disabled={busy} onClick={onReplan}>重新获取资料并策划</button>}{issue.resolution === "manual_review" && <small>请人工核对实际来源或销售版本；确认大纲不会消除此提示。</small>}{issue.resolution === "auto_text" && <small>生成流程可以修订这类问题；若仍存在，请返回方案调整后重新生成。</small>}</div>)}</>}
    <div hidden={tab !== 'facts'}>{result.evidence.facts.map((fact, i) => <section className="fact-card" id={`evidence-${fact.id}`} key={fact.id}><span>依据 {i + 1} · {fact.sourceMode === 'ima' ? 'ima' : '本地资料'} · {fact.status === 'supported' ? '原文支持' : '待确认'}</span><h4>{fact.statement}</h4><details><summary>原文与限制</summary><blockquote>{fact.quote}</blockquote>{fact.qualifiers.map((q, qi) => <p key={qi}>{q}</p>)}</details><small>{fact.sourceTitle}</small></section>)}<h3>同型号来源图片</h3><p className="caption">保留原图比例与来源名称；图片失效时，请重新获取资料。</p><div className="source-images">{result.evidence.images.map(image => <figure key={image.id}><img src={image.url} alt={image.name} loading="lazy" /><figcaption>{image.name}<br /><small>{image.sourceTitle} · {image.sourceMode === 'ima' ? 'ima' : '本地资料'}</small></figcaption></figure>)}</div>{!result.evidence.images.length && <p className="status-note">当前没有可用的来源图片，请返回需求重新获取资料。</p>}</div>{tab === 'strategy' && result.strategies.map(s => <section className="fact-card" key={s.platform}><span>{names[s.platform]}</span><h4>{s.angle}</h4><p>{s.painPoint}</p><p>{s.tone}</p><ol>{s.structure.map((item, i) => <li key={i}>{item}</li>)}</ol><p>{s.cta}</p></section>)}</aside>;
}
function downloadMarkdown(result: RunResult) {
  if (result.review.status === 'blocked') return;
  const lines = ['# Virgo · 营销内容方案', result.notice, '## 场景判断', `${result.product.name} / ${result.brief.scene} / ${result.brief.audience} / ${result.brief.goal}`, '## 知识库依据', ...result.evidence.facts.map((f, i) => `依据 ${i + 1}：${f.statement}\n限制：${f.qualifiers.join('；')}\n来源：${f.sourceTitle}`), '## 图文软文', ...result.drafts.map(d => `### ${names[d.platform]}\n${d.titles[0]}\n${d.intro}\n${d.blocks.map(b => `${b.heading}\n${b.text}`).join('\n\n')}\n${d.cta}`), '## 核验结果', reviewName[result.review.status], ...result.review.issues.map(i => `${i.message} ${i.suggestion}`)];
  let text = lines.join('\n\n'); for (const [id, label] of [...result.evidence.facts.map((f, i) => [f.id, `依据 ${i + 1}`]), ...result.evidence.images.map(i => [i.id, i.name]), ...result.evidence.sources.map(s => [s.id, s.title])].sort((a, b) => b[0].length - a[0].length)) text = text.split(id).join(label);
  text = text.replace(/https?:\/\/[^\s<>]+/g, '[链接已省略]'); const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'Virgo-方案说明.md'; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
