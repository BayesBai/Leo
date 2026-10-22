import { useEffect, useRef, useState } from 'react';
import { Download, Copy, Image as ImageIcon, LoaderCircle, X } from 'lucide-react';
import type { Draft, RenderBundle, RenderTemplate, RunResult } from '../shared/types';
import { api, apiFetch } from './api';

const emptyBundles: RenderBundle[] = [];
export function RenderPanel({ result, draft, titleIndex, templates, restoredBundles = emptyBundles, allowRender = true, onBundle }: { result: RunResult; draft: Draft; titleIndex: number; templates: RenderTemplate[]; restoredBundles?: RenderBundle[]; allowRender?: boolean; onBundle?: (bundle: RenderBundle) => void }) {
  const available = templates.filter(t => t.platform === draft.platform);
  const restored = restoredBundles.find(b => b.runId === result.id && b.revision === result.revision && b.platform === draft.platform && b.selectedTitleIndex === titleIndex && Date.parse(b.expiresAt) > Date.now());
  const [template, setTemplate] = useState(restored?.templateId || available[0]?.id || '');
  const [bundle, setBundle] = useState<RenderBundle | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const assetRequests = useRef(new Set<AbortController>());
  const identity = `${result.id}:${result.revision}:${titleIndex}:${template}`;
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  useEffect(() => { setTemplate(current => templates.some(t => t.platform === draft.platform && t.id === current) ? current : templates.find(t => t.platform === draft.platform)?.id || ''); }, [draft.platform, templates]);
  useEffect(() => { setBundle(restoredBundles.find(b => b.runId === result.id && b.revision === result.revision && b.platform === draft.platform && b.selectedTitleIndex === titleIndex && b.templateId === template && b.reviewStatus === result.review.status && Date.parse(b.expiresAt) > Date.now()) || null); setError(''); setMessage(''); setZoom(null); return () => { controller.current?.abort(); for (const request of assetRequests.current) request.abort(); assetRequests.current.clear(); }; }, [identity, restoredBundles]);
  useEffect(() => {
    if (!bundle) return;
    const remaining = Date.parse(bundle.expiresAt) - Date.now();
    const expire = () => { setBundle(null); setZoom(null); setMessage('成品已过期，正文仍保留，请重新生成成品。'); };
    if (!Number.isFinite(remaining) || remaining <= 0) { expire(); return; }
    const timer = window.setTimeout(expire, Math.min(remaining, 2_147_483_647)); return () => window.clearTimeout(timer);
  }, [bundle]);
  useEffect(() => { if (!zoom) return; const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setZoom(null); }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [zoom]);
  async function render() {
    if (!allowRender || controller.current && !controller.current.signal.aborted) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); setMessage(''); setBundle(null);
    try {
      const response = await api<RenderBundle>('/api/render', 'POST', { runId: result.id, revision: result.revision, platform: draft.platform, selectedTitleIndex: titleIndex, templateId: template }, request.signal);
      if (response.runId !== result.id || response.revision !== result.revision || response.platform !== draft.platform || response.selectedTitleIndex !== titleIndex || response.templateId !== template) throw new Error('成品与当前正文或模板不一致，请重新排版。');
      if (!request.signal.aborted && currentIdentity.current === identity) { setBundle(response); onBundle?.(response); }
    } catch (reason) { if (!request.signal.aborted && currentIdentity.current === identity) setError(reason instanceof Error ? reason.message : '排版未完成。'); }
    finally { if (controller.current === request) { controller.current = null; setBusy(false); } }
  }
  async function copy(rich: boolean) {
    if (!bundle || bundle.reviewStatus === 'blocked') return;
    const request = new AbortController(); assetRequests.current.add(request); setError(''); setMessage('');
    try {
      if (!navigator.clipboard || rich && typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持此剪贴板格式，请下载文章或整组成品。');
      if (rich) {
        const article = bundle.artifacts.find(a => a.format === 'wechat-richtext'); if (!article) return;
        // Start the write in the user gesture; resolve the HTML asynchronously for browser clipboard policies.
        const html = apiFetch(article.previewUrl, { signal: request.signal }).then(async response => {
          if (!response.ok) throw new Error('文章已过期，请重新排版。');
          const document = new DOMParser().parseFromString(await response.text(), 'text/html');
          return new Blob([document.body.innerHTML], { type: 'text/html' });
        });
        // A permission failure can reject write before it observes the promised HTML blob.
        void html.catch(() => {});
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': new Blob([bundle.copyText], { type: 'text/plain' }) })]);
        if (!request.signal.aborted && currentIdentity.current === identity) setMessage('排版已复制；微信图片仍需逐张上传或替换，请粘贴后检查。');
      } else { await navigator.clipboard.writeText(bundle.copyText); if (!request.signal.aborted && currentIdentity.current === identity) setMessage('标题、正文和话题已复制。'); }
    } catch (reason) { if (!request.signal.aborted && currentIdentity.current === identity) setError(reason instanceof Error ? reason.message : '剪贴板不可用，请下载成品包。'); }
    finally { request.abort(); assetRequests.current.delete(request); }
  }
  async function download(event: React.MouseEvent<HTMLAnchorElement>, url: string, name: string) {
    event.preventDefault(); if (!bundle || bundle.reviewStatus === 'blocked') return;
    const request = new AbortController(); assetRequests.current.add(request); setError('');
    try {
      const response = await apiFetch(url, { signal: request.signal });
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.message || '文件下载失败，请重新排版。'); }
      const blob = await response.blob(); if (request.signal.aborted || currentIdentity.current !== identity) return;
      const objectUrl = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = name; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (reason) { if (!request.signal.aborted && currentIdentity.current === identity) setError(reason instanceof Error ? reason.message : '下载失败。'); }
    finally { assetRequests.current.delete(request); }
  }
  return <section className="render-panel">
    <div className="section-line"><div><h3>把文案变成成品</h3></div><ImageIcon size={22} /></div>
    <div className="render-actions"><select aria-label="成品模板" value={template} disabled={busy} onChange={e => setTemplate(e.target.value)}>{available.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <button className="primary" onClick={() => void render()} disabled={busy || !template || !allowRender}>{busy ? <LoaderCircle className="spin" size={16} /> : <ImageIcon size={16} />}{busy ? '正在排版' : bundle ? '重新生成成品' : '生成成品'}</button>
      {busy && <button onClick={() => { controller.current?.abort(); setBusy(false); }}>停止排版</button>}</div>
    {!allowRender && <p className="warning">历史来源需重新获取，已关闭新排版；未到期的已有成品仍按原到期时间展示。</p>}{error && <p className="error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}
    {bundle && <><div className="output-note"><span>正文 v{bundle.revision} · 所选标题 {bundle.selectedTitleIndex + 1}</span><span>到期：{new Date(bundle.expiresAt).toLocaleString()}</span></div>
      <div className="artifact-grid">{bundle.artifacts.map(a => <figure key={a.id}>
        {a.format === 'wechat-richtext' ? <iframe title="公众号排版预览" src={a.previewUrl} sandbox="" /> : <button className="artifact-image" aria-label={`放大${a.name}`} onClick={() => setZoom(a.previewUrl)}><img src={a.previewUrl} alt={a.name} /></button>}
        <figcaption><span>{a.name}{a.width ? ` · ${a.width}×${a.height}` : ''}</span>{bundle.reviewStatus !== 'blocked' && a.downloadUrl && <a href={a.downloadUrl} onClick={event => void download(event, a.downloadUrl!, a.name)}><Download size={14} />下载</a>}</figcaption>
      </figure>)}</div>
      <div className="row wrap">{bundle.reviewStatus !== 'blocked' && bundle.zipUrl && <a className="primary button" href={bundle.zipUrl} onClick={event => void download(event, bundle.zipUrl!, '知序-成品与来源.zip')}><Download size={16} />整组下载（含来源与审核）</a>}
        <button disabled={bundle.reviewStatus === 'blocked'} onClick={() => void copy(false)}><Copy size={15} />复制文案</button>
        {draft.platform === 'wechat' && <button disabled={bundle.reviewStatus === 'blocked'} onClick={() => void copy(true)}><Copy size={15} />复制公众号排版</button>}</div>
      <details className="render-warnings"><summary>素材、审核与发布提示（{bundle.warnings.length}）</summary>{bundle.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>
      {bundle.reviewStatus === 'blocked' && <p className="error">当前审核阻断，仅提供带标记预览；请返回大纲修改后重新生成。</p>}</>}
    {zoom && <div className="lightbox" role="dialog" aria-modal="true" aria-label="成品大图" onClick={() => setZoom(null)}><button className="close" autoFocus onClick={() => setZoom(null)} aria-label="关闭大图"><X /></button><img src={zoom} alt="成品完整预览" /></div>}
  </section>;
}
