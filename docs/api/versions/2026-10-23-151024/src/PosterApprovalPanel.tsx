import { useEffect, useId, useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { ChannelDelivery, PosterApproval } from '../shared/types';
import { api } from './api';

const checklist = [
  ['text', '画面中文正确', '标题、型号与小字清楚，没有错字、乱码或缺字。'],
  ['product', '产品外观正确', '对照同型号原图，确认机身、屏幕与接口等外观没有被画错。'],
  ['facts', '事实及适用条件正确', '核对参数与行动信息，必要的适用条件完整可读。'],
] as const;

export function PosterApprovalPanel({ approval, deliveryId, disabledReason, onUpdated }: { approval: PosterApproval; deliveryId: string; disabledReason?: string; onUpdated: (delivery: ChannelDelivery) => void }) {
  const headingId = useId(); const identity = `${deliveryId}:${approval.bundleId}:${approval.artifactId}:${approval.sha256}`;
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const [checks, setChecks] = useState({ text: false, product: false, facts: false });
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState('');
  const running = useRef(false); const requests = useRef(new Set<AbortController>());
  useEffect(() => { setChecks({ text: false, product: false, facts: false }); setError(''); setSubmitting(false); running.current = false; return () => { for (const request of requests.current) request.abort(); requests.current.clear(); }; }, [identity]);

  async function approve() {
    if (disabledReason || Date.parse(approval.expiresAt) <= Date.now() || running.current || !Object.values(checks).every(Boolean) || approval.status !== 'pending') return;
    const submittedIdentity = identity; const request = new AbortController(); requests.current.add(request); running.current = true; setSubmitting(true); setError('');
    try {
      const response = await api<{ delivery: ChannelDelivery }>(`/api/deliveries/${encodeURIComponent(deliveryId)}/poster/approve`, 'POST', {
        bundleId: approval.bundleId, artifactId: approval.artifactId, sha256: approval.sha256, checks,
      }, request.signal);
      if (!request.signal.aborted && currentIdentity.current === submittedIdentity) onUpdated(response.delivery);
    } catch (reason) { if (!request.signal.aborted && currentIdentity.current === submittedIdentity) setError(reason instanceof Error ? reason.message : '核对结果未保存，尚未开放下载。请重试。'); }
    finally { requests.current.delete(request); if (currentIdentity.current === submittedIdentity) { running.current = false; setSubmitting(false); } }
  }

  return <section className="poster-approval" aria-labelledby={headingId}>
    <h4 id={headingId}>{approval.status === 'approved' ? <><Check size={18} aria-hidden="true" />本版海报已人工核对</> : '核对本版海报后下载'}</h4>
    <p className="vr-caption">{approval.notice}</p>
    <details className="poster-reference"><summary>查看画面文字、事实依据与产品原图</summary>
      {!!approval.requiredCopy.length && <><h5>应包含的画面文字</h5><ul>{approval.requiredCopy.map((text, i) => <li key={i}>{text}</li>)}</ul></>}
      {!!approval.factChecks.length && <><h5>事实及完整适用条件</h5>{approval.factChecks.map(fact => <div key={fact.factId}><p>{fact.statement}</p>{fact.qualifiers.map((condition, i) => <p className="vr-caption" key={i}>{condition}</p>)}<small>{fact.sourceTitle}</small></div>)}</>}
      {!!approval.referenceImages.length && <><h5>同型号产品原图</h5><div className="poster-reference-images">{approval.referenceImages.map(image => <figure key={image.id}><img src={image.url} alt={image.name} loading="lazy" /><figcaption>{image.name}</figcaption></figure>)}</div></>}
    </details>
    {approval.status === 'pending' && <>{disabledReason && <p className="vr-notice vr-notice-warning" role="status">{disabledReason}</p>}<fieldset disabled={submitting || !!disabledReason} className="poster-checklist"><legend className="sr-only">海报人工核对项</legend>{checklist.map(([key, label, detail]) => <label key={key}><input type="checkbox" checked={checks[key]} onChange={event => setChecks(current => ({ ...current, [key]: event.target.checked }))} /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</fieldset>
      {error && <p className="vr-notice vr-notice-error" role="alert">{error}</p>}
      <button className="vr-button vr-button-primary" type="button" disabled={submitting || !!disabledReason || !Object.values(checks).every(Boolean)} onClick={() => void approve()}>{submitting ? <LoaderCircle className="vr-spin" size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}确认本版，开放下载</button><p className="vr-caption">确认只绑定当前图片。重新生成海报后，需要重新核对三项。</p></>}
  </section>;
}
