import { useEffect, useRef, useState } from 'react';
import { Download, Copy, Image as ImageIcon, LoaderCircle, X } from 'lucide-react';
import type { Draft, RenderBundle, RenderTemplate, RunResult } from '../shared/types';
import { api } from './api';

export function RenderPanel({ result, draft, titleIndex, templates }: { result: RunResult; draft: Draft; titleIndex: number; templates: RenderTemplate[] }) {
  const available = templates.filter(t => t.platform === draft.platform);
  const [template, setTemplate] = useState(available[0]?.id || '');
  const [bundle, setBundle] = useState<RenderBundle | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const identity = `${result.id}:${result.revision}:${titleIndex}:${template}`;
  useEffect(() => { setBundle(null); setError(''); setMessage(''); setZoom(null); return () => { controller.current?.abort(); }; }, [identity]);
  useEffect(() => { if (!zoom) return; const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setZoom(null); }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [zoom]);
  async function render() {
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(''); setBundle(null);
    try {
      const response = await api<RenderBundle>('/api/render', 'POST', { runId: result.id, revision: result.revision, platform: draft.platform, selectedTitleIndex: titleIndex, templateId: template }, request.signal);
      if (!request.signal.aborted) setBundle(response);
    } catch (reason) { if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : '排版未完成。'); }
    finally { if (controller.current === request) { controller.current = null; setBusy(false); } }
  }
  async function copy(rich: boolean) {
    if (!bundle || bundle.reviewStatus === 'blocked') return;
    try {
      if (!navigator.clipboard || rich && typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持此剪贴板格式，请下载文章或整组成品。');
      if (rich) {
        const article = bundle.artifacts.find(a => a.format === 'wechat-richtext'); if (!article) return;
        // Start the write in the user gesture; resolve the HTML asynchronously for browser clipboard policies.
        const html = fetch(article.previewUrl).then(async response => {
          if (!response.ok) throw new Error('文章已过期，请重新排版。');
          const document = new DOMParser().parseFromString(await response.text(), 'text/html');
          return new Blob([document.body.innerHTML], { type: 'text/html' });
        });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': new Blob([bundle.copyText], { type: 'text/plain' }) })]);
        setMessage('排版已复制；微信图片仍需逐张上传或替换，请粘贴后检查。');
      } else { await navigator.clipboard.writeText(bundle.copyText); setMessage('标题、正文和话题已复制。'); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '剪贴板不可用，请下载成品包。'); }
  }
  async function download(event: React.MouseEvent<HTMLAnchorElement>, url: string, name: string) {
    event.preventDefault(); setError('');
    try {
      const response = await fetch(url);
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.message || '文件下载失败，请重新排版。'); }
      const objectUrl = URL.createObjectURL(await response.blob()); const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = name; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '下载失败。'); }
  }
  return <section className="render-panel">
    <div className="section-line"><div><span className="eyebrow">VISUAL OUTPUT</span><h3>把文案变成成品</h3></div><ImageIcon size={22} /></div>
    <div className="render-actions"><select aria-label="成品模板" value={template} disabled={busy} onChange={e => setTemplate(e.target.value)}>{available.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <button className="primary" onClick={() => void render()} disabled={busy || !template}>{busy ? <LoaderCircle className="spin" size={16} /> : <ImageIcon size={16} />}{busy ? '正在排版' : bundle ? '重新生成成品' : '生成成品'}</button>
      {busy && <button onClick={() => { controller.current?.abort(); setBusy(false); }}>停止排版</button>}</div>
    {error && <p className="error" role="alert">{error}</p>}{message && <p className="success" role="status">{message}</p>}
    {bundle && <><div className="output-note"><span>正文 v{bundle.revision} · 所选标题 {bundle.selectedTitleIndex + 1}</span><span>文件保存 30 分钟</span></div>
      <div className="artifact-grid">{bundle.artifacts.map(a => <figure key={a.id}>
        {a.format === 'wechat-richtext' ? <iframe title="公众号排版预览" src={a.previewUrl} sandbox="" /> : <button className="artifact-image" aria-label={`放大${a.name}`} onClick={() => setZoom(a.previewUrl)}><img src={a.previewUrl} alt={a.name} /></button>}
        <figcaption><span>{a.name}{a.width ? ` · ${a.width}×${a.height}` : ''}</span>{a.downloadUrl && <a href={a.downloadUrl} onClick={event => void download(event, a.downloadUrl!, a.name)}><Download size={14} />下载</a>}</figcaption>
      </figure>)}</div>
      <div className="row wrap">{bundle.zipUrl && <a className="primary button" href={bundle.zipUrl} onClick={event => void download(event, bundle.zipUrl!, '知序-成品与来源.zip')}><Download size={16} />整组下载（含来源与审核）</a>}
        <button disabled={bundle.reviewStatus === 'blocked'} onClick={() => void copy(false)}><Copy size={15} />复制文案</button>
        {draft.platform === 'wechat' && <button disabled={bundle.reviewStatus === 'blocked'} onClick={() => void copy(true)}><Copy size={15} />复制公众号排版</button>}</div>
      <details className="render-warnings"><summary>素材、审核与发布提示（{bundle.warnings.length}）</summary>{bundle.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>
      {bundle.reviewStatus === 'blocked' && <p className="error">当前审核阻断，仅提供带标记预览；请返回大纲修改后重新生成。</p>}</>}
    {zoom && <div className="lightbox" role="dialog" aria-modal="true" aria-label="成品大图" onClick={() => setZoom(null)}><button className="close" autoFocus onClick={() => setZoom(null)} aria-label="关闭大图"><X /></button><img src={zoom} alt="成品完整预览" /></div>}
  </section>;
}
