import type { Platform, ReviewReport, RunResult } from '../shared/types';

export function channelReview(result: RunResult, platform: Platform): ReviewReport {
  const issues = result.review.issues.filter(issue => !issue.platform || issue.platform === platform);
  return { ...result.review, issues, status: issues.some(issue => issue.severity === 'error') ? 'blocked' : issues.some(issue => issue.severity === 'warning') ? 'needs_attention' : result.review.status === 'blocked' && !result.review.issues.length ? 'blocked' : 'passed' };
}

export function reviewHeading(review: ReviewReport) {
  const warnings = review.issues.filter(issue => issue.severity === 'warning').length;
  return review.status === 'blocked' ? '需修改 · 正式导出已关闭' : warnings ? `可交付 · ${warnings} 项发布提醒` : '可交付 · 内容检查通过';
}

export function reviewAction(issue: ReviewReport['issues'][number]) {
  return issue.resolution === 'edit_outline' ? '返回方案调整' : issue.resolution === 'refresh_evidence' ? '重新获取来源资料' : issue.resolution === 'auto_text' ? '核对正文与原始依据' : '发布前人工核实';
}
