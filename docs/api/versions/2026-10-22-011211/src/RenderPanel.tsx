import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Download, Image as ImageIcon, LoaderCircle, Maximize2, RefreshCw, X } from 'lucide-react';
import type { Draft, RenderArtifact, RenderBundle, RenderTemplate, RunResult } from '../shared/types';
import { api, apiFetch, ApiError, mockLabel } from './api';
import './virgo/render-panel.css';

const emptyBundles: RenderBundle[] = [];
type RenderPanelProps = {
  result: RunResult;
  draft: Draft;
  titleIndex: number;
  templates: RenderTemplate[];
  restoredBundles?: RenderBundle[];
  allowRender?: boolean;
  parentBusy?: boolean;
  onBundle?: (bundle: RenderBundle) => void;
  onBusyChange?: (busy: boolean) => void;
};

export function RenderPanel({ result, draft, titleIndex, templates, restoredBundles = emptyBundles, allowRender = true, parentBusy = false, onBundle, onBusyChange }: RenderPanelProps) {
  const available = templates.filter(item => item.platform === draft.platform);
  const restored = restoredBundles.find(item => item.runId === result.id && item.revision === result.revision && item.platform === draft.platform && item.selectedTitleIndex === titleIndex && item.reviewStatus === result.review.status && Date.parse(item.expiresAt) > Date.now());
  const [template, setTemplate] = useState(restored?.templateId || available[0]?.id || '');
  const [bundle, setBundle] = useState<RenderBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [artifactIndex, setArtifactIndex] = useState(0);
  const [zoom, setZoom] = useState<RenderArtifact | null>(null);
  const controller = useRef<AbortController | null>(null);
  const assetRequests = useRef(new Set<AbortController>());
  const busyCallback = useRef(onBusyChange);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogClose = useRef<HTMLButtonElement>(null);
  const zoomTrigger = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const dialogHeadingId = useId();
  const dialogDescriptionId = useId();
  const identity = `${result.id}:${result.revision}:${draft.platform}:${titleIndex}:${template}:${result.review.status}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  const matches = (item: RenderBundle) => item.runId === result.id && item.revision === result.revision && item.platform === draft.platform && item.selectedTitleIndex === titleIndex && item.templateId === template && item.reviewStatus === result.review.status && Date.parse(item.expiresAt) > Date.now();
  const visibleBundle = bundle && matches(bundle) ? bundle : null;
  const artifacts = visibleBundle?.artifacts || [];
  const activeArtifact = artifacts[Math.min(artifactIndex, Math.max(0, artifacts.length - 1))];
  const blocked = result.review.status === 'blocked' || visibleBundle?.reviewStatus === 'blocked';
  const exportDisabled = blocked || busy || parentBusy || !visibleBundle;

  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => { busyCallback.current?.(busy); }, [busy]);
  useEffect(() => () => busyCallback.current?.(false), []);
  useEffect(() => {
    setTemplate(current => templates.some(item => item.platform === draft.platform && item.id === current) ? current : templates.find(item => item.platform === draft.platform)?.id || '');
  }, [draft.platform, templates]);
  useEffect(() => {
    setError(''); setMessage(''); setArtifactIndex(0); setZoom(null); setBusy(false);
    return () => {
      controller.current?.abort(); controller.current = null;
      for (const request of assetRequests.current) request.abort();
      assetRequests.current.clear();
    };
  }, [identity]);
  useEffect(() => {
    setBundle(current => current && matches(current) ? current : restoredBundles.find(matches) || null);
  }, [identity, restoredBundles]);
  useEffect(() => {
    if (!bundle) return;
    const remaining = Date.parse(bundle.expiresAt) - Date.now();
    const expire = () => { setBundle(null); setZoom(null); setMessage('成品已过期，正文仍保留。请重新生成成品。'); };
    if (!Number.isFinite(remaining) || remaining <= 0) { expire(); return; }
    const timer = window.setTimeout(expire, Math.min(remaining, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [bundle]);
  useEffect(() => {
    if (!zoom || !dialog.current) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    dialogClose.current?.focus();
    return () => {
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
      const target = zoomTrigger.current?.isConnected ? zoomTrigger.current : heading.current;
      target?.focus({ preventScroll: true });
    };
  }, [zoom]);

  function openZoom(artifact: RenderArtifact, trigger: HTMLElement) {
    zoomTrigger.current = trigger;
    setZoom(artifact);
  }

  function stopRender() {
    controller.current?.abort(); controller.current = null; setBusy(false);
    setMessage(visibleBundle ? '已停止排版，仍可查看上一次成品。' : '已停止排版，可以重新生成。');
  }

  async function render() {
    if (parentBusy || !allowRender || !template || controller.current && !controller.current.signal.aborted) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await api<RenderBundle>('/api/render', 'POST', { runId: result.id, revision: result.revision, platform: draft.platform, selectedTitleIndex: titleIndex, templateId: template }, request.signal);
      if (response.runId !== result.id || response.revision !== result.revision || response.platform !== draft.platform || response.selectedTitleIndex !== titleIndex || response.templateId !== template) throw new Error('成品与当前正文或模板不一致，请重新排版。');
      if (!request.signal.aborted && currentIdentity.current === identity) {
        setBundle(response); setArtifactIndex(0); onBundle?.(response);
        setMessage('成品已生成，请检查文字、图片与审核提示后使用。');
      }
    } catch (reason) {
      if (!request.signal.aborted && currentIdentity.current === identity) setError(reason instanceof ApiError && reason.status === 410 ? '当前来源或正文已过期。正文仍可阅读，请返回任务重新策划后再生成成品。' : reason instanceof Error ? reason.message : '排版未完成，请重试。');
    } finally {
      if (controller.current === request) { controller.current = null; setBusy(false); }
    }
  }

  function expireAssets() {
    setBundle(null); setZoom(null); setError('');
    setMessage('成品已过期，正文仍保留。请重新生成成品。');
  }

  async function copy(rich: boolean) {
    if (!visibleBundle || exportDisabled) return;
    const request = new AbortController(); assetRequests.current.add(request); setError(''); setMessage('');
    try {
      if (!navigator.clipboard || rich && typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持此剪贴板格式，请下载文章或整组成品。');
      if (rich) {
        const article = visibleBundle.artifacts.find(item => item.format === 'wechat-richtext'); if (!article) return;
        // Begin the write in the user gesture, resolving the HTML through the shared transport.
        const html = apiFetch(article.previewUrl, { signal: request.signal }).then(async response => {
          if (response.status === 410) throw new ApiError('文章已过期，请重新生成成品。', 'expired', 410);
          if (!response.ok) throw new Error('文章读取失败，请重试或下载成品。');
          const document = new DOMParser().parseFromString(await response.text(), 'text/html');
          return new Blob([document.body.innerHTML], { type: 'text/html' });
        });
        // Permission rejection can happen before the browser observes the promised HTML blob.
        void html.catch(() => {});
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': new Blob([visibleBundle.copyText], { type: 'text/plain' }) })]);
        if (!request.signal.aborted && currentIdentity.current === identity) setMessage('排版已复制。微信图片仍需逐张上传或替换，请粘贴后检查。');
      } else {
        await navigator.clipboard.writeText(visibleBundle.copyText);
        if (!request.signal.aborted && currentIdentity.current === identity) setMessage('标题、正文和话题已复制。');
      }
    } catch (reason) {
      if (!request.signal.aborted && currentIdentity.current === identity) {
        if (reason instanceof ApiError && reason.status === 410) expireAssets();
        else setError(reason instanceof Error ? reason.message : '剪贴板不可用，请下载成品包。');
      }
    } finally { request.abort(); assetRequests.current.delete(request); }
  }

  async function download(url: string, name: string) {
    if (!visibleBundle || exportDisabled) return;
    const request = new AbortController(); assetRequests.current.add(request); setError(''); setMessage('');
    try {
      const response = await apiFetch(url, { signal: request.signal });
      if (response.status === 410) throw new ApiError('成品已过期。', 'expired', 410);
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(typeof detail.message === 'string' ? detail.message : '文件下载失败，请重试。'); }
      const blob = await response.blob(); if (request.signal.aborted || currentIdentity.current !== identity) return;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = name;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setMessage('已开始下载，请在浏览器下载列表中查看。');
    } catch (reason) {
      if (!request.signal.aborted && currentIdentity.current === identity) {
        if (reason instanceof ApiError && reason.status === 410) expireAssets();
        else setError(reason instanceof Error ? reason.message : '下载失败，请重试。');
      }
    } finally { assetRequests.current.delete(request); }
  }

  const downloadUrl = visibleBundle?.zipUrl || activeArtifact?.downloadUrl;
  const downloadName = visibleBundle?.zipUrl ? 'Virgo-成品与来源.zip' : activeArtifact?.name || 'Virgo-成品';

  return <section className="virgo-render-panel" aria-labelledby={headingId} aria-busy={busy}>
    <div className="vr-heading"><h3 id={headingId} ref={heading} tabIndex={-1}>视觉成品</h3>{visibleBundle && <span className="vr-version">正文 v{visibleBundle.revision}</span>}</div>
    <fieldset className="vr-templates" disabled={busy || parentBusy}>
      <legend className="vr-sr-only">选择成品模板</legend>
      {available.map(item => <label className={`vr-template${template === item.id ? ' vr-template-selected' : ''}`} key={item.id}>
        <input type="radio" name={`${headingId}-template`} value={item.id} checked={template === item.id} onChange={() => setTemplate(item.id)} />
        <span><strong>{item.name}</strong><small>{item.width} × {item.height}</small></span>
        {template === item.id && <Check size={18} aria-hidden="true" />}
      </label>)}
    </fieldset>
    {!available.length && <p className="vr-notice">此渠道暂无可用模板，请检查服务连接后重试。</p>}
    {!allowRender && <p className="vr-notice vr-notice-warning" role="status">历史来源需要重新获取，暂时不能生成新成品。未到期的已有成品仍可查看与使用。</p>}
    {blocked && <p className="vr-notice vr-notice-error" role="status">审核阻断：仅提供带标记预览，复制和下载已关闭。请返回大纲修改后重新生成。</p>}
    {result.review.status === 'needs_attention' && <p className="vr-notice vr-notice-warning">有待确认项。请核实审核提示，再决定是否使用成品。</p>}
    {error && <p className="vr-notice vr-notice-error" role="alert">{error}</p>}
    {message && <p className="vr-notice vr-notice-success" role="status">{message}</p>}

    {activeArtifact ? <div className="vr-output">
      <figure className={`vr-artifact${activeArtifact.format === 'wechat-richtext' ? ' vr-artifact-article' : ''}`}>
        {activeArtifact.format === 'wechat-richtext'
          ? <iframe title={`${activeArtifact.name}排版预览`} src={activeArtifact.previewUrl} sandbox="" />
          : <button className="vr-preview" type="button" aria-label={`放大查看${activeArtifact.name}`} onClick={event => openZoom(activeArtifact, event.currentTarget)}><img src={activeArtifact.previewUrl} alt={activeArtifact.name} width={activeArtifact.width} height={activeArtifact.height} onError={() => setError('成品预览未能加载。如果成品已到期，请重新生成。')} /></button>}
        <figcaption className="vr-artifact-caption"><strong>{activeArtifact.name}</strong><span>{artifacts.length > 1 ? `${artifactIndex + 1} / ${artifacts.length} 份成品` : '1 份成品'}{activeArtifact.width && activeArtifact.height ? ` · ${activeArtifact.width} × ${activeArtifact.height}` : ' · 公众号排版'}</span></figcaption>
      </figure>
      {artifacts.length > 1 && <nav className="vr-pagination" aria-label="浏览成品">
        <button className="vr-button vr-button-secondary" type="button" disabled={parentBusy || artifactIndex === 0} onClick={() => setArtifactIndex(current => Math.max(0, current - 1))}><ArrowLeft size={18} aria-hidden="true" />上一份</button>
        <button className="vr-button vr-button-primary" type="button" disabled={parentBusy || artifactIndex >= artifacts.length - 1} onClick={() => setArtifactIndex(current => Math.min(artifacts.length - 1, current + 1))}>下一份<ArrowRight size={18} aria-hidden="true" /></button>
      </nav>}
      <div className="vr-main-actions">
        <button className="vr-button vr-button-secondary" type="button" disabled={parentBusy} onClick={event => openZoom(activeArtifact, event.currentTarget)}><Maximize2 size={18} aria-hidden="true" />放大查看</button>
        <button className="vr-button vr-button-primary" type="button" disabled={exportDisabled || !downloadUrl} onClick={() => downloadUrl && void download(downloadUrl, downloadName)}><Download size={18} aria-hidden="true" />下载成品{visibleBundle?.zipUrl && <span className="vr-sr-only">整组 ZIP，含来源与审核</span>}</button>
      </div>
      <div className="vr-secondary-actions">
        <button className="vr-text-button" type="button" disabled={exportDisabled} onClick={() => void copy(false)}><Copy size={16} aria-hidden="true" />复制文案</button>
        {draft.platform === 'wechat' && <button className="vr-text-button" type="button" disabled={exportDisabled || !artifacts.some(item => item.format === 'wechat-richtext')} onClick={() => void copy(true)}><Copy size={16} aria-hidden="true" />复制公众号排版</button>}
        {visibleBundle?.zipUrl && <button className="vr-text-button" type="button" disabled={exportDisabled || !activeArtifact.downloadUrl} onClick={() => activeArtifact.downloadUrl && void download(activeArtifact.downloadUrl, activeArtifact.name)}><Download size={16} aria-hidden="true" />下载此文件</button>}
      </div>
      <p className="vr-caption">所选标题 {visibleBundle!.selectedTitleIndex + 1} · 成品保留至 {new Date(visibleBundle!.expiresAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}。{mockLabel ? '纯模拟预览，不调用模型或 ima，不能用于真实发布。' : '请在发布前核对产品信息、图片与审核提示。'}</p>
      <details className="vr-warnings"><summary>素材、审核与发布提示（{visibleBundle!.warnings.length}）</summary>{visibleBundle!.warnings.length ? visibleBundle!.warnings.map((warning, index) => <p key={index}>{warning}</p>) : <p>当前成品没有额外提示，发布前仍需核对内容。</p>}</details>
    </div> : <div className="vr-empty"><ImageIcon size={32} strokeWidth={1.3} aria-hidden="true" /><p>{busy ? '正在把文案排成成品' : visibleBundle ? '本次没有返回可预览的文件' : '文案准备好了，选一个排版吧'}</p><span>{busy ? '完成后会显示在这里，也可以停止排版。' : '成品将使用当前标题与已审核的正文。'}</span></div>}

    <div className="vr-render-actions">
      <button className={`vr-button ${visibleBundle ? 'vr-button-secondary' : 'vr-button-primary'}`} type="button" onClick={() => void render()} disabled={parentBusy || busy || !template || !allowRender}>{busy ? <LoaderCircle className="vr-spin" size={18} aria-hidden="true" /> : visibleBundle ? <RefreshCw size={18} aria-hidden="true" /> : <ImageIcon size={18} aria-hidden="true" />}{busy ? '正在排版' : visibleBundle ? '重新生成成品' : blocked ? '生成带标记预览' : '生成成品'}</button>
      {busy && <button className="vr-button vr-button-secondary" type="button" onClick={stopRender}>停止排版</button>}
    </div>

    <dialog ref={dialog} className="vr-dialog" aria-labelledby={dialogHeadingId} aria-describedby={dialogDescriptionId} onCancel={event => { event.preventDefault(); setZoom(null); }} onClose={() => setZoom(null)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setZoom(null);
    }}>
      <header className="vr-dialog-header"><div><h3 id={dialogHeadingId}>{zoom?.name || '成品完整预览'}</h3><p id={dialogDescriptionId}>{blocked ? '审核阻断，仅供查看带标记预览。' : '查看成品细节，按 Escape 或关闭按钮返回。'}</p></div><button ref={dialogClose} className="vr-dialog-close" type="button" aria-label="关闭大图" onClick={() => setZoom(null)}><X size={22} /></button></header>
      <div className="vr-dialog-content">{zoom && (zoom.format === 'wechat-richtext' ? <iframe title={`${zoom.name}完整排版预览`} src={zoom.previewUrl} sandbox="" /> : <img src={zoom.previewUrl} alt={zoom.name} />)}</div>
    </dialog>
  </section>;
}
