import { useState } from 'react';
import { ChevronDown, History, Settings } from 'lucide-react';
import type { AppStatus, Brief, Product, TaskOptions } from '../shared/types';
import { Button, Choice } from './virgo/Controls';
import { mockLabel } from './api';

type Props = {
  brief: Brief; products: Product[]; options: TaskOptions | null; status: AppStatus | null;
  busy: boolean; canPlan: boolean; loading: boolean;
  update: <K extends keyof Brief>(key: K, value: Brief[K]) => void;
  onGenerate: () => void; onSettings: () => void; onHistory?: () => void;
};
const labels = { wechat: '微信公众号', xiaohongshu: '小红书', moments: '朋友圈', poster: '门店海报' };

export function TaskForm({ brief, products, options, status, busy, canPlan, loading, update, onGenerate, onSettings, onHistory }: Props) {
  const product = products.find(p => p.id === brief.productId);
  const [customScene, setCustomScene] = useState(false);
  const scenarios = (options?.scenarios.map(s => s.label) || ['开学选购', '移动办公', '日常换机']).slice(0, 3);
  const scenario = options?.scenarios.find(s => s.label === brief.scene);
  const ready = brief.mode === 'demo' ? status?.local.available : status?.model.configured && (brief.knowledgeSource === 'local' ? status?.local.available : status?.ima.verified);
  const disabled = busy || loading;
  return <>
    <div className="page-title"><h1>Virgo-你的产品规划搭子</h1><p>选好产品、客户和渠道，明确大方向</p></div>
    {loading && <div className="status-note" role="status">正在载入产品和工作台设置…</div>}
    {!loading && !products.length && <div className="empty-state"><h2>还没有可选产品</h2><p>请检查产品资料或接入配置，载入目录后再开始。</p><Button onClick={onSettings}>检查接入设置</Button></div>}
    <div className="task-layout">
      <fieldset disabled={disabled} className="task-fields">
        <label className="field">选择产品<select value={brief.productId} onChange={e => update('productId', e.target.value)}><option value="" disabled>请选择产品型号</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.system}</option>)}</select></label>
        <p className="caption">{mockLabel ? '纯模拟任务 · 不含真实产品参数或活动信息' : product ? `${product.description} · ${product.imageCount} 张来源图` : '选择具体型号，保留事实与图片来源。'}</p>
        <div className="field-group"><span className="field-label">这次是什么场景？</span><div className="scene-options">{scenarios.map(scene => <Choice key={scene} selected={brief.scene === scene} onClick={() => { update('scene', scene); setCustomScene(false); }}>{scene}</Choice>)}</div>
          <Button variant="ghost" className="custom-scene-toggle" onClick={() => setCustomScene(v => !v)} aria-expanded={customScene}>自定义场景<ChevronDown size={14} /></Button>
          {(customScene || !scenarios.includes(brief.scene)) && <input aria-label="自定义推广场景" list="scenario-options" value={brief.scene} maxLength={250} onChange={e => update('scene', e.target.value)} />}
          <datalist id="scenario-options">{options?.scenarios.map(s => <option key={s.id} value={s.label} />)}</datalist>
        </div>
        <label className="field">主要讲给谁听？<input value={brief.audience} placeholder="例如大学生与家长" list="audience-options" maxLength={120} onChange={e => update('audience', e.target.value)} /></label>
        <datalist id="audience-options">{(scenario?.audienceSuggestions || ['大学生与家长', '差旅办公者', '日常换机用户']).map(a => <option key={a} value={a} />)}</datalist>
        <p className="caption">可以写你熟悉的客户。切换场景不会清空这里。</p>
        <div className="field-group"><span className="field-label">准备发到哪里？</span><div className="channel-options">{[...(options?.platforms || [])].sort((a, b) => ['xiaohongshu', 'wechat', 'moments', 'poster'].indexOf(a.id) - ['xiaohongshu', 'wechat', 'moments', 'poster'].indexOf(b.id)).map(p => <Choice key={p.id} selected={brief.platforms.includes(p.id)} onClick={() => {
          if (brief.platforms.includes(p.id)) { if (brief.platforms.length > 1) update('platforms', brief.platforms.filter(id => id !== p.id)); }
          else if (brief.platforms.length < 4) update('platforms', [...brief.platforms, p.id]);
        }}>{labels[p.id]}</Choice>)}</div><p className="caption">选择 1–4 个渠道，每个渠道各有表达。</p></div>
        <Button variant="ghost" className="select-all-channels" aria-pressed={brief.platforms.length === 4} onClick={() => update('platforms', ['xiaohongshu', 'wechat', 'moments', 'poster'])}>全选四个渠道</Button>
        <details className="task-advanced"><summary>补充要求 · 可选<ChevronDown size={16} /></summary><div className="advanced-body">
          <div className="two-fields"><label className="field">营销目标<input list="goal-options" value={brief.goal} maxLength={160} onChange={e => update('goal', e.target.value)} /><datalist id="goal-options">{options?.goals.map(g => <option key={g} value={g} />)}</datalist></label><label className="field">客户购买阶段<select value={brief.buyingStage} onChange={e => update('buyingStage', e.target.value)}>{(options?.buyingStages || ['初步了解', '对比选择', '购买决策']).map(g => <option key={g}>{g}</option>)}</select></label></div>
          <label className="field">补充要求 <span className="caption">{brief.instructions.length}/2000</span><textarea rows={3} maxLength={2000} value={brief.instructions} onChange={e => update('instructions', e.target.value)} placeholder="例如：语气自然，不写价格，不编造亲测体验。" /></label>
        </div></details>
        <div className="task-inline-submit"><Button variant="primary" disabled={!canPlan || disabled} onClick={onGenerate}>生成营销方案</Button><span className="caption">资料就绪后即可开始。</span></div>
        {!loading && !ready && <p className="warning" role="status">{brief.mode === 'demo' ? '当前缺少本地产品资料，请检查接入配置。' : brief.knowledgeSource === 'ima' ? '请先验证模型与 ima 共享库。' : '请检查模型配置和本地产品资料。'} <Button variant="ghost" onClick={onSettings} disabled={busy}><Settings size={16} />接入设置</Button></p>}
      </fieldset>
      <aside className="task-summary"><h2>本次创作</h2><div><h3>{product?.name || '尚未选择产品'}</h3><p>{brief.scene || '尚未填写场景'}<br />{brief.audience || '尚未填写客户'}</p></div><hr /><p>{brief.platforms.map(p => labels[p]).join(' / ')}</p><p className="small">先整理方向，再确认内容。<br />参数、图片与适用条件会保留来源。</p><p className="small">接入设置在独立入口中。<br />日常创作无需反复配置。</p>{onHistory && <Button variant="ghost" className="task-history" disabled={disabled} onClick={onHistory}><History size={16} />最近七天记录</Button>}</aside>
    </div>
    <div className="mobile-task-actions"><Button variant="primary" disabled={!canPlan || disabled} onClick={onGenerate}>生成营销方案</Button></div>
  </>;
}
