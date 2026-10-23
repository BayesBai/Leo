import { CheckCircle2, CircleX, TriangleAlert } from 'lucide-react';
import type { ReviewReport } from '../shared/types';
import { reviewAction, reviewHeading } from './channel-review';

export function ChannelReviewNotice({ review, onDetails, heading }: { review: ReviewReport; onDetails?: () => void; heading?: string }) {
  const warnings = review.issues.filter(issue => issue.severity !== 'info');
  return <section className={`review-banner channel-review-notice ${review.status}`} aria-label="当前渠道审核" role="status">
    {review.status === 'blocked' ? <CircleX size={20} aria-hidden="true" /> : warnings.length ? <TriangleAlert size={20} aria-hidden="true" /> : <CheckCircle2 size={20} aria-hidden="true" />}
    <div><strong>{heading || reviewHeading(review)}</strong>
      {warnings.length ? <><p>{review.status === 'blocked' ? '请处理下列阻断问题后重新生成。' : '以下是发布提醒，不是等待点击确认的步骤。请在使用前核实。'}</p><ul>{warnings.map(issue => <li key={issue.id}><span>{issue.message}</span><small>{issue.suggestion || reviewAction(issue)}</small></li>)}</ul></> : <p>本渠道内容没有阻断问题。图片核对及临时资源有效期以成品区为准。</p>}
      {onDetails && <button className="vr-text-button" type="button" onClick={onDetails}>查看依据与处理位置</button>}
    </div>
  </section>;
}
