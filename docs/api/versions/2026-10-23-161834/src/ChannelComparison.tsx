import type { Platform, RunResult } from '../shared/types';
import './channel-comparison.css';

const channels: Record<Platform, [string, string]> = {
  wechat: ['公众号', '问题 → 分析 → 决策建议'], xiaohongshu: ['小红书', '收藏封面 → 行动清单 → 评论互动'],
  moments: ['门店朋友圈', '聊天开场 → 单一看点 → 私信交流'], poster: ['门店海报', '场景主张 → 产品主视觉 → 行动邀请'],
};

export function ChannelComparison({ result, onSelect }: { result: RunResult; onSelect: (platform: Platform) => void }) {
  if (result.drafts.length < 2) return null;
  return <details className="channel-comparison">
    <summary>同一任务 · {result.drafts.length} 个渠道对照</summary>
    <p>产品、客户和目标相同，各渠道分别制作。点击渠道查看对应交付。</p>
    <div className="channel-compare-grid">{result.drafts.map(draft => {
      const [label, rhythm] = channels[draft.platform];
      const length = Array.from([draft.intro, ...draft.blocks.map(b => b.text), draft.cta].join('')).length;
      return <article key={draft.platform} className={`channel-compare-card compare-${draft.platform}`}>
        <button onClick={() => onSelect(draft.platform)}>{label} ↗</button><small>{rhythm}</small>
        {draft.platform === 'poster' ? <><h3>一张门店海报</h3><p>产品主视觉、核心画面信息与行动引导。</p><footer>1024 × 1536 · 整图交付</footer></> : <><h3>{draft.titles[0]}</h3><p>{draft.intro}</p>
        <ol>{draft.blocks.map(block => <li key={block.id}>{block.heading}</li>)}</ol>
        <blockquote>{draft.cta}</blockquote><footer>{draft.platform === 'moments' ? `一段文案 · ${draft.images.length} 张原图` : `${draft.blocks.length} 个段落 · 约 ${length} 字符 · ${draft.images.length} 张原图`}</footer></>}
      </article>;
    })}</div>
  </details>;
}
