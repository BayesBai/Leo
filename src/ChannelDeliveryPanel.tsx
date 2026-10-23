import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import type { BackgroundJob, ChannelDelivery, RenderArtifact, RenderRequest, RenderTemplate } from '../shared/types';
import { api, apiFetch, ApiError, mockLabel } from './api';
import { VideoDeliveryPanel } from './VideoDeliveryPanel';
import { deliveryRenderOptions, viewableDeliveryBundle, type DeliveryRenderOperation } from './delivery-render-request';
import { PosterApprovalPanel } from './PosterApprovalPanel';
import { ChannelReviewNotice } from './ChannelReviewNotice';
import './virgo/render-panel.css';
import './virgo/channel-delivery.css';

interface Props {
  delivery: ChannelDelivery;
  onUpdated?: (delivery: ChannelDelivery) => void;
  onJob?: (job: BackgroundJob) => void;
  onEnqueueRender?: (request: RenderRequest) => Promise<BackgroundJob | undefined>;
  titleIndex?: number;
  jobs?: BackgroundJob[];
  renderTemplates?: RenderTemplate[];
  showPublishingCopy?: boolean;
  showReview?: boolean;
}
const templates = { xiaohongshu: 'xhs-cream', wechat: 'wechat-editorial', moments: 'moments-square', poster: 'poster-paper' };
const PLATFORM_LABELS = { xiaohongshu: '小红书', wechat: '公众号', moments: '朋友圈', poster: '门店海报' };
const active = (job: BackgroundJob) => job.status === 'queued' || job.status === 'running';
export function ChannelDeliveryPanel({ delivery, onUpdated, onJob, onEnqueueRender, titleIndex, jobs, renderTemplates, showPublishingCopy = true, showReview = true }: Props) {
  const headingId = useId(); const identity = useRef(delivery.id); identity.current = delivery.id;
  const [current, setCurrent] = useState(delivery); const [job, setJob] = useState<BackgroundJob | null>(null);
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [expired, setExpired] = useState(false); const [copying, setCopying] = useState(false);
  const [templateId, setTemplateId] = useState(delivery.bundle?.templateId || templates[delivery.platform]);
  const requests = useRef(new Set<AbortController>()); const keys = useRef(new Map<string, string>()); const submittingNow = useRef(false);
  const callbacks = useRef({ onUpdated, onJob }); callbacks.current = { onUpdated, onJob };
  const busy = submitting || !!job && active(job);
  const blocked = current.review.status === 'blocked' || current.status === 'blocked';
  const selectedTitleIndex = titleIndex ?? current.bundle?.selectedTitleIndex ?? 0;
  const selectedTitle = current.draft.titles[selectedTitleIndex] || current.draft.titles[0];
  const copyText = current.copyText ? [selectedTitle, ...current.copyText.split('\n\n').slice(1)].join('\n\n') : '';
  const bundle = viewableDeliveryBundle(current, selectedTitleIndex, expired);
  const downloadable = !blocked && !!bundle && bundle.publication === 'released';
  const poster = current.platform === 'poster';
  const approval = current.posterApproval || bundle?.posterApproval;
  const approvalDisabledReason = blocked ? '本渠道存在内容阻断，请先修改并重新生成。' : current.evidenceStatus !== 'ready' ? '来源需要重新取证，当前海报暂不能确认。' : expired || !bundle || approval && (!Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= Date.now()) ? '本版海报已到期，请重新制作后核对。' : undefined;
  const htmlChannel = current.platform === 'xiaohongshu' || current.platform === 'wechat';
  const availableTemplates = renderTemplates?.filter(template => template.platform === current.platform) || [];
  const shownArtifacts = poster && bundle ? [bundle.artifacts.find(item => item.role === 'poster') || bundle.artifacts[0]].filter((item): item is RenderArtifact => !!item) : bundle?.artifacts || [];

  useEffect(() => { setCurrent(delivery); setError(''); setMessage(''); setJob(null); setExpired(false); setSubmitting(false); setCopying(false); submittingNow.current = false; }, [delivery.id, delivery.updatedAt, delivery.bundle?.id]);
  useEffect(() => { setTemplateId(delivery.bundle?.templateId || templates[delivery.platform]); }, [delivery.id, delivery.bundle?.templateId]);
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
          if (next.job.status === 'completed') setMessage(detail.delivery.posterApproval?.status === 'pending' ? '海报预览已生成，请核对下方三项后下载。' : '渠道成品已更新，可以使用已开放的预览和下载。');
          else { setMessage(''); setError(next.job.channels.find(channel => channel.platform === current.platform)?.error?.message || next.job.error?.message || '该步骤未完成，已保留成功结果。请在任务中心查看并续跑。'); }
        }
      } catch (reason) { if (!request.signal.aborted && identity.current === expected) { setError(reason instanceof Error ? reason.message : '任务状态暂时无法读取，后台仍会继续。'); timer = setTimeout(poll, 2500); } }
    };
    timer = setTimeout(poll, 700);
    return () => { clearTimeout(timer); request.abort(); };
  }, [job?.id, current.id]);

  async function submit(operation: DeliveryRenderOperation) {
    if (submittingNow.current || busy || current.evidenceStatus !== 'ready') return;
    submittingNow.current = true; setSubmitting(true); setError(''); setMessage(''); const expected = current.id;
    const scope = `${expected}:${operation}:${templateId}:${selectedTitleIndex}`; const key = keys.current.get(scope) || crypto.randomUUID(); keys.current.set(scope, key);
    try {
      let submitted: BackgroundJob | undefined;
      if (onEnqueueRender) submitted = await onEnqueueRender({ runId: current.runId, revision: current.revision, platform: current.platform,
        selectedTitleIndex, templateId, deliveryId: current.id,
        ...deliveryRenderOptions(operation) });
      else {
        try {
          const response = await api<{ job: BackgroundJob }>(`/api/deliveries/${encodeURIComponent(expected)}/rerender`, 'POST', { idempotencyKey: key, templateId, ...deliveryRenderOptions(operation) });
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
      if (identity.current === expected) { setJob(submitted); setMessage(poster ? '海报已加入后台制作队列。新图片完成后请核对文字、产品外观和事实。' : '已加入本渠道排版队列。已有正文和审稿结果会继续复用。'); }
    } catch (reason) { if (identity.current === expected) setError(reason instanceof Error ? reason.message : '任务未提交，请重试。'); }
    finally { submittingNow.current = false; if (identity.current === expected) setSubmitting(false); }
  }

  async function copy(rich = false) {
    if (blocked || copying || poster) return;
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

  return <section className="virgo-render-panel channel-delivery-panel" data-platform={current.platform} aria-labelledby={headingId} aria-busy={busy}>
    <div className="vr-heading"><h3 id={headingId}>{poster ? '门店海报' : current.platform === 'moments' ? '朋友圈文案与配图' : current.platform === 'wechat' ? '公众号排版与封面' : '小红书图片与封面'}</h3><span className="vr-version">{poster ? '设计' : '正文'} v{current.revision}</span></div>
    {showReview && <ChannelReviewNotice review={current.review} heading={poster && !blocked && approval?.status === 'pending' ? '内容检查已完成 · 海报待人工核对' : undefined} />}
    {current.platform === 'moments' && <p className="vr-caption">复制下面的文案，选取1–3张产品原图配发即可。</p>}
    {current.platform === 'wechat' && <p className="vr-caption">正文可复制为微信兼容富文本。粘贴到公众号后请检查配图；图片包可单独上传到微信素材库。</p>}
    {current.evidenceStatus !== 'ready' && <p className="vr-notice vr-notice-warning">来源需要重新取证。历史内容仍可阅读，现有有效成品可使用；新的制作暂不可用。</p>}
    {error && <p className="vr-notice vr-notice-error" role="alert">{error}</p>}
    {message && <p className="vr-notice vr-notice-success" role="status">{message}</p>}
    {showPublishingCopy && !poster && (current.platform === 'moments' ? <div className="vd-copy"><p>{copyText}</p></div> : <details className="vd-copy" open={!bundle}><summary>发布正文</summary><p>{copyText}</p></details>)}
    <div className="vr-main-actions">{showPublishingCopy && !poster && <button className="vr-button vr-button-primary" type="button" disabled={blocked || copying} onClick={() => void copy()}><Copy size={18} aria-hidden="true" />复制文案</button>}
      {current.platform === 'wechat' && <button className="vr-button vr-button-secondary" type="button" disabled={!downloadable || copying} onClick={() => void copy(true)}>复制公众号排版</button>}
      {poster && shownArtifacts[0]?.downloadUrl && <button className="vr-button vr-button-primary" type="button" disabled={!downloadable} onClick={() => void download(shownArtifacts[0].downloadUrl!, shownArtifacts[0].name)}><Download size={18} aria-hidden="true" />下载海报</button>}
      {bundle?.zipUrl && <button className="vr-button vr-button-secondary" type="button" disabled={!downloadable} onClick={() => void download(bundle.zipUrl!, `${PLATFORM_LABELS[current.platform]}-成品与来源.zip`)}><Download size={18} aria-hidden="true" />{poster ? '下载海报与来源' : current.platform === 'moments' ? '打包下载配图与文案' : '下载本渠道成品'}</button>}
    </div>
    {shownArtifacts.length ? <div className={`vd-artifacts${poster ? ' vd-artifacts-poster' : ''}`}>{shownArtifacts.map(artifact)}</div>
      : <p className="vr-notice">{current.bundle && current.bundle.selectedTitleIndex !== selectedTitleIndex ? '已选择新的标题，请重新排版以更新画面文字。' : expired || current.bundle ? '临时成品已到期。历史内容仍保留，请主动重新制作。' : poster ? '设计内容已准备好，生成一张可核对的海报。' : current.platform === 'moments' ? '文案已就绪，整理配图可取得精选产品原图。' : '正文已就绪，可继续生成本渠道视觉成品。'}</p>}
    {poster && approval && <PosterApprovalPanel key={`${approval.bundleId}:${approval.sha256}`} approval={approval} deliveryId={current.id} disabledReason={approvalDisabledReason} onUpdated={next => { setCurrent(next); callbacks.current.onUpdated?.(next); setError(''); setMessage('本版海报核对已保存，正式下载已开放。'); }} />}
    {htmlChannel && availableTemplates.length > 1 && <label className="vd-template-choice">下次排版风格<select value={templateId} disabled={busy} onChange={event => setTemplateId(event.target.value)}>{availableTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>}
    <div className="vr-render-actions">
      {!poster && <button className="vr-button vr-button-secondary" type="button" disabled={busy || current.evidenceStatus !== 'ready'} onClick={() => void submit(htmlChannel ? 'html' : 'local')}>{busy ? <LoaderCircle className="vr-spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}{busy ? '后台处理中' : current.platform === 'moments' ? '重新整理配图' : '重新排版'}</button>}
      {htmlChannel && <button className="vr-text-button" type="button" disabled={busy || blocked || current.evidenceStatus !== 'ready'} onClick={() => void submit('html-regenerate')}>重新生成背景并排版（可能再次计费）</button>}
      {poster && <button className="vr-button vr-button-primary" type="button" disabled={busy || blocked || current.evidenceStatus !== 'ready' || current.brief.mode !== 'live' && !mockLabel} onClick={() => void submit(bundle ? 'poster-regenerate' : 'poster-image')}>{busy ? <LoaderCircle className="vr-spin" size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" />}{busy ? '后台制作中' : bundle ? '重新生成海报（可能再次计费）' : '生成海报（会调用生图服务）'}</button>}
    </div>
    {htmlChannel && <p className="vr-caption">重新排版使用 HTML 制作源，复用现有正文、有效背景与产品素材，无需连接外部编辑器。{current.brief.mode === 'demo' ? '本地演示始终使用本地背景，不调用生图服务。' : '背景过期时普通重排不会自动重新生图；“重新生成背景并排版”会调用生图服务。'}成品包包含设计配置和 HTML 源文件。</p>}
    {poster && <p className="vr-caption">{current.brief.mode === 'demo' && !mockLabel ? '本地规则演示不会调用生图。请切换模型创作并配置生图服务后制作新海报。' : '生图服务一次生成整张海报。预览不加水印；画面文字、产品外观与事实核对完成后才开放下载。'}</p>}
    {htmlChannel && <VideoDeliveryPanel delivery={current} jobs={jobs} titleIndex={selectedTitleIndex} onJob={onJob} onUpdated={next => { setCurrent(next); callbacks.current.onUpdated?.(next); }} />}
    {!!current.review.issues.length && <details className="vr-warnings"><summary>本渠道审核记录（{current.review.issues.length}）</summary>{current.review.issues.map(issue => <p key={issue.id}>{issue.message}{issue.suggestion ? ` ${issue.suggestion}` : ''}</p>)}</details>}
  </section>;
}
