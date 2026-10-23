import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Download, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import type { BackgroundJob, ChannelDelivery, RenderArtifact, RenderRequest } from '../shared/types';
import { api, apiFetch, ApiError } from './api';
import './virgo/render-panel.css';
import './virgo/channel-delivery.css';

interface Props {
  delivery: ChannelDelivery;
  onUpdated?: (delivery: ChannelDelivery) => void;
  onJob?: (job: BackgroundJob) => void;
  onEnqueueRender?: (request: RenderRequest) => Promise<BackgroundJob | undefined>;
  titleIndex?: number;
}
const templates = { xiaohongshu: 'xhs-cream', wechat: 'wechat-editorial', moments: 'moments-square', poster: 'poster-paper' };
const PLATFORM_LABELS = { xiaohongshu: '小红书', wechat: '公众号', moments: '朋友圈', poster: '门店海报' };
const active = (job: BackgroundJob) => job.status === 'queued' || job.status === 'running';
function canvaUrl(raw: string): string | undefined {
  try { const url = new URL(raw); if (url.protocol === 'https:' && ['www.canva.com', 'canva.com'].includes(url.hostname) && !url.username && !url.password) return url.toString(); } catch { /* unsafe links are not shown */ }
}

export function ChannelDeliveryPanel({ delivery, onUpdated, onJob, onEnqueueRender, titleIndex }: Props) {
  const headingId = useId(); const identity = useRef(delivery.id); identity.current = delivery.id;
  const [current, setCurrent] = useState(delivery); const [job, setJob] = useState<BackgroundJob | null>(null);
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [expired, setExpired] = useState(false); const [copying, setCopying] = useState(false);
  const requests = useRef(new Set<AbortController>()); const keys = useRef(new Map<string, string>()); const submittingNow = useRef(false);
  const callbacks = useRef({ onUpdated, onJob }); callbacks.current = { onUpdated, onJob };
  const busy = submitting || !!job && active(job);
  const blocked = current.review.status === 'blocked' || current.status === 'blocked';
  const selectedTitleIndex = titleIndex ?? current.bundle?.selectedTitleIndex ?? 0;
  const selectedTitle = current.draft.titles[selectedTitleIndex] || current.draft.titles[0];
  const copyText = current.copyText ? [selectedTitle, ...current.copyText.split('\n\n').slice(1)].join('\n\n') : '';
  const bundle = !expired && current.bundle && current.bundle.selectedTitleIndex === selectedTitleIndex && Date.parse(current.bundle.expiresAt) > Date.now() ? current.bundle : undefined;
  const downloadable = !blocked && !!bundle && bundle.publication === 'released';
  const designs = current.externalDesigns || bundle?.externalDesigns || [];

  useEffect(() => { setCurrent(delivery); setError(''); setMessage(''); setJob(null); setExpired(false); setSubmitting(false); setCopying(false); submittingNow.current = false; }, [delivery.id, delivery.updatedAt, delivery.bundle?.id]);
  useEffect(() => () => { for (const request of requests.current) request.abort(); requests.current.clear(); }, [delivery.id]);
  useEffect(() => {
    if (!current.bundle) return;
    const remaining = Date.parse(current.bundle.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) { setExpired(true); return; }
    const timer = window.setTimeout(() => setExpired(true), Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [current.bundle]);
  useEffect(() => {
    if (!job || !active(job)) return;
    const request = new AbortController(); const expected = current.id; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<{ job: BackgroundJob }>(`/api/jobs/${encodeURIComponent(job.id)}`, 'GET', undefined, request.signal);
        if (identity.current !== expected) return;
        setJob(next.job); callbacks.current.onJob?.(next.job);
        if (active(next.job)) timer = setTimeout(poll, 1000);
        else {
          const detail = await api<{ delivery: ChannelDelivery }>(`/api/deliveries/${encodeURIComponent(expected)}`, 'GET', undefined, request.signal);
          if (identity.current !== expected) return;
          setCurrent(detail.delivery); setExpired(false); callbacks.current.onUpdated?.(detail.delivery);
          if (next.job.status === 'completed') setMessage('渠道成品已更新，可以预览和下载。');
          else setError(next.job.channels.find(channel => channel.platform === current.platform)?.error?.message || next.job.error?.message || '该步骤未完成，已保留成功结果。请在任务中心查看并续跑。');
        }
      } catch (reason) { if (!request.signal.aborted && identity.current === expected) { setError(reason instanceof Error ? reason.message : '任务状态暂时无法读取，后台仍会继续。'); timer = setTimeout(poll, 2500); } }
    };
    timer = setTimeout(poll, 700);
    return () => { clearTimeout(timer); request.abort(); };
  }, [job?.id, current.id]);

  async function submit(operation: 'local' | 'canva' | 'sync' | 'regenerate') {
    if (submittingNow.current || busy || current.evidenceStatus !== 'ready') return;
    submittingNow.current = true; setSubmitting(true); setError(''); setMessage(''); const expected = current.id;
    const scope = `${expected}:${operation}`; const key = keys.current.get(scope) || crypto.randomUUID(); keys.current.set(scope, key);
    try {
      let submitted: BackgroundJob | undefined;
      if (onEnqueueRender) submitted = await onEnqueueRender({ runId: current.runId, revision: current.revision, platform: current.platform,
        selectedTitleIndex, templateId: bundle?.templateId || current.bundle?.templateId || templates[current.platform], deliveryId: current.id,
        ...(operation === 'sync' ? { canvaSync: true } : { visualMode: operation === 'regenerate' ? 'canva' : operation, ...(operation === 'regenerate' ? { regenerateVisual: true } : {}) }) });
      else {
        try {
          const path = operation === 'sync' ? 'canva/sync' : 'rerender';
          const response = await api<{ job: BackgroundJob }>(`/api/deliveries/${encodeURIComponent(expected)}/${path}`, 'POST', { idempotencyKey: key, ...(operation === 'sync' ? {} : { visualMode: operation === 'regenerate' ? 'canva' : operation, ...(operation === 'regenerate' ? { regenerateVisual: true } : {}) }) });
          submitted = response.job;
        } catch (reason) {
          if (!(reason instanceof ApiError) || !['network', 'protocol', 'incomplete'].includes(reason.kind)) throw reason;
          const response = await api<{ jobs: BackgroundJob[] }>(`/api/jobs?idempotencyKey=${encodeURIComponent(key)}`).catch(() => undefined);
          submitted = response?.jobs[0];
          if (!submitted) throw new Error('提交结果暂不确定。请先在任务中心核对；再次点击会查询或复用同一任务，不会盲目重复提交。');
        }
      }
      if (!submitted) throw new Error('任务未提交，请查看工作台提示。');
      keys.current.delete(scope); callbacks.current.onJob?.(submitted);
      if (identity.current === expected) { setJob(submitted); setMessage(operation === 'sync' ? '已加入 Canva 同步队列，后台会核对文字和产品素材变化。' : '已加入本渠道排版队列。已有正文和审稿结果会继续复用。'); }
    } catch (reason) { if (identity.current === expected) setError(reason instanceof Error ? reason.message : '任务未提交，请重试。'); }
    finally { submittingNow.current = false; if (identity.current === expected) setSubmitting(false); }
  }

  async function copy(rich = false) {
    if (blocked || copying) return;
    const request = new AbortController(); requests.current.add(request); const expected = current.id; setCopying(true); setError('');
    try {
      if (!navigator.clipboard) throw new Error('当前浏览器不支持剪贴板，请下载成品后使用。');
      if (rich) {
        const article = bundle?.artifacts.find(artifact => artifact.format === 'wechat-richtext');
        if (!article || !downloadable || typeof ClipboardItem === 'undefined') throw new Error('富文本暂不可复制，请先生成有效的公众号成品。');
        const html = apiFetch(article.previewUrl, { signal: request.signal }).then(async response => {
          if (!response.ok) throw new Error('公众号正文读取失败，成品可能已到期。请重新排版。');
          const parsed = new DOMParser().parseFromString(await response.text(), 'text/html'); return new Blob([parsed.body.innerHTML], { type: 'text/html' });
        });
        void html.catch(() => {});
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': new Blob([copyText], { type: 'text/plain' }) })]);
      } else await navigator.clipboard.writeText(copyText);
      if (identity.current === expected) setMessage(rich ? '公众号排版已复制。粘贴到微信后，请检查图片和换行。' : '本渠道文案已复制。');
    } catch (reason) { if (!request.signal.aborted && identity.current === expected) setError(reason instanceof Error ? reason.message : '复制失败，请检查剪贴板权限。'); }
    finally { requests.current.delete(request); if (identity.current === expected) setCopying(false); }
  }

  async function download(url: string, name: string) {
    if (!downloadable) return;
    const request = new AbortController(); requests.current.add(request); const expected = current.id; setError('');
    try {
      const response = await apiFetch(url, { signal: request.signal });
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(typeof detail.message === 'string' ? detail.message : '下载失败。成品可能已到期，请重新排版。'); }
      const blob = await response.blob(); if (request.signal.aborted || identity.current !== expected) return;
      const objectUrl = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = name;
      document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setMessage('已开始下载，请在浏览器下载列表中查看。');
    } catch (reason) { if (!request.signal.aborted && identity.current === expected) setError(reason instanceof Error ? reason.message : '下载失败，请重试。'); }
    finally { requests.current.delete(request); }
  }

  function artifact(item: RenderArtifact) {
    return <figure className={`vr-artifact${item.format === 'wechat-richtext' ? ' vr-artifact-article' : ''}`} key={item.id}>
      {item.format === 'wechat-richtext' ? <iframe title={`${PLATFORM_LABELS[current.platform]}正文排版`} src={item.previewUrl} sandbox="" />
        : <a className="vd-image-link" href={item.previewUrl} target="_blank" rel="noreferrer" aria-label={`打开${item.name}完整图片`}><img src={item.previewUrl} alt={item.name} width={item.width} height={item.height} loading="lazy" /></a>}
      <figcaption className="vr-artifact-caption"><strong>{item.name}</strong>{item.width && item.height && <span>{item.width} × {item.height}</span>}
        {item.downloadUrl && <button className="vr-text-button" disabled={!downloadable} onClick={() => void download(item.downloadUrl!, item.name)}><Download size={16} aria-hidden="true" />下载{item.format === 'original' ? '原图' : item.format === 'wechat-richtext' ? '文章' : '图片'}</button>}</figcaption>
    </figure>;
  }

  return <section className="virgo-render-panel channel-delivery-panel" aria-labelledby={headingId} aria-busy={busy}>
    <div className="vr-heading"><h3 id={headingId}>{PLATFORM_LABELS[current.platform]}交付</h3><span className="vr-version">正文 v{current.revision}</span></div>
    {blocked ? <p className="vr-notice vr-notice-error" role="status">本渠道存在阻断问题，正式复制与下载暂未开放。其他已通过渠道可以独立使用。</p>
      : <p className="vr-caption"><Check size={16} aria-hidden="true" /> 本渠道已完成独立审稿，可以直接使用文案。{current.platform === 'moments' ? '配图保留产品原图。' : ''}</p>}
    {current.review.status === 'needs_attention' && <p className="vr-notice vr-notice-warning">本渠道仍有待确认事项，请查看下方审核记录后使用。</p>}
    {current.evidenceStatus !== 'ready' && <p className="vr-notice vr-notice-warning">来源需要重新取证。历史正文仍可阅读，现有有效成品可使用；新的排版与同步暂不可用。</p>}
    {error && <p className="vr-notice vr-notice-error" role="alert">{error}</p>}
    {message && <p className="vr-notice vr-notice-success" role="status">{message}</p>}
    <details className="vd-copy" open={!bundle}><summary>发布文案</summary><p>{copyText}</p></details>
    <div className="vr-main-actions"><button className="vr-button vr-button-primary" type="button" disabled={blocked || copying} onClick={() => void copy()}><Copy size={18} aria-hidden="true" />复制文案</button>
      {current.platform === 'wechat' && <button className="vr-button vr-button-secondary" type="button" disabled={!downloadable || copying} onClick={() => void copy(true)}>复制公众号排版</button>}
      {bundle?.zipUrl && <button className="vr-button vr-button-secondary" type="button" disabled={!downloadable} onClick={() => void download(bundle.zipUrl!, `${PLATFORM_LABELS[current.platform]}-成品与来源.zip`)}><Download size={18} aria-hidden="true" />下载本渠道成品</button>}
    </div>
    {bundle?.artifacts.length ? <div className="vd-artifacts">{bundle.artifacts.map(artifact)}</div>
      : <p className="vr-notice">{current.bundle && current.bundle.selectedTitleIndex !== selectedTitleIndex ? '已选择新的标题，请重新排版以更新画面文字。' : expired || current.bundle ? '临时成品已到期。历史正文仍保留，请主动重新排版。' : current.platform === 'moments' ? '文案已就绪，重新排版可整理精选产品原图。' : '正文已就绪，可继续生成本渠道视觉成品。'}</p>}
    <div className="vr-render-actions">
      <button className="vr-button vr-button-secondary" type="button" disabled={busy || current.evidenceStatus !== 'ready'} onClick={() => void submit('local')}>{busy ? <LoaderCircle className="vr-spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}{busy ? '后台处理中' : '重新排版'}</button>
      {current.platform !== 'moments' && <button className="vr-button vr-button-primary" type="button" disabled={busy || blocked || current.evidenceStatus !== 'ready'} onClick={() => void submit('canva')}>使用 AI 视觉与 Canva</button>}
      {current.platform !== 'moments' && <button className="vr-text-button" type="button" disabled={busy || blocked || current.evidenceStatus !== 'ready'} onClick={() => void submit('regenerate')}>重新生图（可能再次计费）</button>}
    </div>
    {current.platform !== 'moments' && <p className="vr-caption">重新排版复用现有文案；AI 视觉与 Canva 优先复用已有素材。“重新生图”会提交新的付费请求，需要已配置生图密钥并授权 Canva。</p>}
    {!!designs.length && <div className="vd-canva"><h4>可编辑设计</h4><div className="vr-secondary-actions">{designs.map((design, index) => { const url = canvaUrl(design.editUrl); return url && <a className="vr-button vr-button-secondary" key={design.id} href={url} target="_blank" rel="noreferrer"><ExternalLink size={17} aria-hidden="true" />在 Canva 编辑{designs.length > 1 ? ` ${index + 1}` : ''}</a>; })}
      <button className="vr-text-button" type="button" disabled={busy || !designs.length || current.evidenceStatus !== 'ready'} onClick={() => void submit('sync')}><RefreshCw size={16} aria-hidden="true" />同步编辑结果</button></div><p className="vr-caption">版式调整可复用审核；文字或产品素材变化后会重新检查本渠道。</p></div>}
    {!!current.review.issues.length && <details className="vr-warnings"><summary>本渠道审核记录（{current.review.issues.length}）</summary>{current.review.issues.map(issue => <p key={issue.id}>{issue.message}{issue.suggestion ? ` ${issue.suggestion}` : ''}</p>)}</details>}
  </section>;
}
