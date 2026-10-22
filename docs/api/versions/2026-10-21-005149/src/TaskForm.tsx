import { ArrowRight, Check, Image, ShieldCheck, Settings } from 'lucide-react';
import type { AppStatus, Brief, Product, TaskOptions } from '../shared/types';

type Props = {
  brief: Brief; products: Product[]; options: TaskOptions | null; status: AppStatus | null;
  busy: boolean; canPlan: boolean; loading: boolean;
  update: <K extends keyof Brief>(key: K, value: Brief[K]) => void;
  onGenerate: () => void; onSettings: () => void;
};

const labels = { wechat: '公众号', xiaohongshu: '小红书', moments: '门店朋友圈', poster: '门店海报' };
const descriptions = { wechat: '讲清选购思路', xiaohongshu: '可收藏的场景清单', moments: '自然聊天，邀请咨询', poster: '一个主题，简明卖点' };

export function TaskForm({ brief, products, options, status, busy, canPlan, loading, update, onGenerate, onSettings }: Props) {
  const product = products.find(p => p.id === brief.productId);
  const scenario = options?.scenarios.find(s => s.label === brief.scene);
  const ready = brief.mode === 'demo' ? status?.local.available : status?.model.configured && (brief.knowledgeSource === 'local' ? status?.local.available : status?.ima.verified);
  return <>
    <div className="page-title task-intro"><h1>这次，想为谁介绍电脑？</h1><p>选好产品、客户与渠道，先看写作方向，再生成图文。</p></div>
    {loading ? <div className="task-loading" role="status">正在载入产品和工作台设置…</div> : !products.length && <div className="empty-state"><h2>还没有可选产品</h2><p>请检查产品资料或接入配置，载入目录后再开始。</p><button onClick={onSettings}>检查接入设置</button></div>}
    <fieldset disabled={busy || loading} className="task-form">
      <section className="paper task-product">
        <div className="task-product-fields"><h2>介绍哪款产品</h2><label className="field">产品型号与系统<select value={brief.productId} onChange={e => update('productId', e.target.value)}><option value="" disabled>请选择产品</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.system}</option>)}</select></label>{product && <p className="caption">{product.description} · {product.imageCount} 张来源图</p>}</div>
        <div className="task-product-preview">{product?.coverUrl ? <img src={product.coverUrl} alt={product.name} /> : <Image size={40} aria-hidden="true" />}</div>
      </section>
      <section className="paper task-audience"><h2>这段内容写给谁</h2>
        <div className="two-fields"><label className="field">业务场景<input list="scenario-options" value={brief.scene} maxLength={250} onChange={e => update('scene', e.target.value)} /><datalist id="scenario-options">{options?.scenarios.map(s => <option key={s.id} value={s.label} />)}</datalist></label><label className="field">目标客户 <span>必填，可自定义</span><input value={brief.audience} placeholder="例如大学新生、家长、差旅办公者" maxLength={120} onChange={e => update('audience', e.target.value)} /></label></div>
        <div className="audience-suggestions"><span>常见客户</span><div className="chips">{(scenario?.audienceSuggestions || ['大学新生', '家长', '差旅办公者']).map(a => <button key={a} aria-pressed={brief.audience === a} className={brief.audience === a ? 'selected' : ''} onClick={() => update('audience', a)}>{a}</button>)}</div></div>
        <p className="caption">切换场景会保留你填写的客户，请核对是否适合。</p>
      </section>
      <section className="paper task-channels"><div className="section-line"><h2>准备发在哪里</h2><span>可选 1–4 个渠道</span></div><div className="channel-choices">{options?.platforms.map(p => <button key={p.id} aria-pressed={brief.platforms.includes(p.id)} className={`channel-choice ${brief.platforms.includes(p.id) ? 'selected' : ''}`} onClick={() => { if (brief.platforms.includes(p.id)) { if (brief.platforms.length > 1) update('platforms', brief.platforms.filter(id => id !== p.id)); } else if (brief.platforms.length < 4) update('platforms', [...brief.platforms, p.id]); }}><span className="channel-choice-check">{brief.platforms.includes(p.id) && <Check size={14} />}</span><span><b>{labels[p.id]}</b><small>{descriptions[p.id]}</small></span></button>)}</div></section>
      <details className="paper task-advanced"><summary>更多要求 <span>选填 · {brief.goal} · {brief.buyingStage}</span></summary>
        <div className="two-fields"><label className="field">营销目标<input list="goal-options" value={brief.goal} maxLength={160} onChange={e => update('goal', e.target.value)} /><datalist id="goal-options">{options?.goals.map(g => <option key={g} value={g} />)}</datalist></label><label className="field">客户购买阶段<select value={brief.buyingStage} onChange={e => update('buyingStage', e.target.value)}>{(options?.buyingStages || ['初步了解', '对比选择', '购买决策']).map(g => <option key={g}>{g}</option>)}</select></label></div>
        <label className="field">补充要求 <span>{brief.instructions.length}/2000</span><textarea rows={3} maxLength={2000} value={brief.instructions} onChange={e => update('instructions', e.target.value)} placeholder="例如：语气自然，不写价格，不编造亲测体验。" /></label><div className="chips">{['语气自然，避免生硬推销', '不要写价格与优惠', '精简文案'].map(text => <button key={text} onClick={() => update('instructions', `${brief.instructions}${brief.instructions ? '；' : ''}${text}`.slice(0, 2000))}>{text}</button>)}</div>
      </details>
    </fieldset>
    <div className="task-submit"><div><ShieldCheck size={19} /><p>先确认大纲，再写正文。产品事实与配图均保留来源。</p></div><button className="primary" disabled={!canPlan || busy || loading} onClick={onGenerate}>生成写作大纲<ArrowRight size={17} /></button></div>
    {!loading && !ready && <p className="warning">{brief.mode === 'demo' ? '当前缺少本地产品资料，请配置资料或切换已就绪的模型来源。' : brief.knowledgeSource === 'ima' ? '请先在接入设置中验证模型与 ima 共享库。' : '请检查模型配置和本地产品资料。'} <button className="text-button" onClick={onSettings} disabled={busy}><Settings size={14} />接入设置</button></p>}
  </>;
}
