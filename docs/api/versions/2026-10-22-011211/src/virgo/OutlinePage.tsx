import { useEffect, useId, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { OutlineResult, Platform, PlatformOutline, TaskOptions } from '../../shared/types';
import { mockLabel } from '../api';
import { Button } from './Controls';

const platformNames: Record<Platform, string> = { xiaohongshu: '小红书', wechat: '公众号', moments: '朋友圈', poster: '海报' };

export type OutlinePageProps = {
  outline: OutlineResult;
  edits: PlatformOutline[];
  dirty: boolean;
  readOnly: boolean;
  busy: boolean;
  invalidImages: boolean;
  options: TaskOptions | null;
  revision: string;
  onRevision: (value: string) => void;
  onChange: (index: number, change: (platformOutline: PlatformOutline) => PlatformOutline) => void;
  onSave: () => void;
  onConfirm: () => void;
  onGenerate: () => void;
  onRevise: () => void;
  onBack: () => void;
  onLoadLatest: () => void;
  onReplan: () => void;
  onSources: () => void;
};

export function OutlinePage({ outline, edits, dirty, readOnly, busy, invalidImages, options, revision, onRevision, onChange, onSave, onConfirm, onGenerate, onRevise, onBack, onLoadLatest, onReplan, onSources }: OutlinePageProps) {
  const [activePlatform, setActivePlatform] = useState<Platform>(edits[0]?.platform || outline.platforms[0]?.platform || 'xiaohongshu');
  const tabsId = useId();
  const revisionId = useId();
  useEffect(() => {
    setActivePlatform(current => edits.some(item => item.platform === current) ? current : edits[0]?.platform || 'xiaohongshu');
  }, [edits]);
  const platformIndex = Math.max(0, edits.findIndex(item => item.platform === activePlatform));
  const current = edits[platformIndex];
  const bounds = options?.platforms.find(item => item.id === current?.platform);
  const confirmed = outline.status === 'confirmed';
  const disabled = busy || readOnly;
  const saveDisabled = disabled || invalidImages || !dirty;
  const confirmDisabled = disabled || invalidImages || dirty || confirmed;
  const generateDisabled = disabled || invalidImages || dirty || !confirmed;
  const change = (update: (value: PlatformOutline) => PlatformOutline) => {
    if (!disabled) onChange(platformIndex, update);
  };
  const sourceNames = outline.evidence.sources.map(source => source.title).filter(Boolean);
  const sourceSummary = sourceNames.length ? `${sourceNames.slice(0, 2).join('、')}${sourceNames.length > 2 ? `等 ${sourceNames.length} 份资料` : ''}` : '当前资料未提供来源标题';
  const sourceDescription = mockLabel ? '纯模拟资料，仅用于界面与流程演示。' : outline.evidence.sourceMode === 'ima' ? '来自 ima 共享知识库，发布前仍需核对型号、授权与时效。' : '来自本地产品资料，发布前请核对授权与时效。';

  return <>
    <div className="page-title"><h1>确认营销方案</h1><p>按你的想法调整，确认后生成内容。</p></div>
    <div className="outline-status"><span>{outline.product.name} · {outline.brief.audience}</span><span className={`status-badge ${dirty ? 'editing' : confirmed ? 'confirmed' : 'pending'}`}>方案 v{outline.version} · {dirty ? '有未保存修改' : confirmed ? '已确认' : '待确认'}</span></div>
    {readOnly && <div className="notice warning" role="status"><p>此方案仅供阅读：版本已更新或来源需要重新获取。可载入最新方案，或按原任务重新策划。</p><div className="row wrap"><Button disabled={busy} onClick={onLoadLatest}>载入最新方案</Button><Button disabled={busy} onClick={onReplan}>按原任务重新策划</Button></div></div>}
    {outline.history?.interrupted && <p className="notice warning" role="status">上次操作已中断，已保存内容仍保留。核对后可以重新操作。</p>}

    <div className="outline-layout">
      <div className="outline-main">
        <div className="outline-tabs" role="tablist" aria-label="方案渠道">
          {edits.map((item, index) => <Button key={item.platform} id={`${tabsId}-tab-${item.platform}`} role="tab" variant="ghost" aria-selected={current?.platform === item.platform} aria-controls={`${tabsId}-panel-${item.platform}`} tabIndex={current?.platform === item.platform ? 0 : -1} className={current?.platform === item.platform ? 'selected' : ''} disabled={busy} onClick={() => setActivePlatform(item.platform)} onKeyDown={event => {
            if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? edits.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + edits.length) % edits.length;
            setActivePlatform(edits[next].platform);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}>{platformNames[item.platform]}</Button>)}
        </div>

        {current && <div className="outline-platform" id={`${tabsId}-panel-${current.platform}`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${current.platform}`}>
          <div className="outline-overview">
            <h2>{current.title}</h2>
            <section><h3>切入点</h3><p>{current.angle}</p></section>
            <section><h3>准备这样展开</h3><p>{current.sections.map(section => section.heading).join(' → ')}</p></section>
            <section><h3>行动引导</h3><p>{current.cta}</p></section>
          </div>

          <details className="outline-editor" key={`${outline.id}:${current.platform}`}>
            <summary>展开编辑标题、段落、依据与配图</summary>
            <fieldset disabled={disabled}>
              <label className="field">标题<input value={current.title} maxLength={140} onChange={event => change(value => ({ ...value, title: event.target.value }))} /></label>
              <label className="field">内容切入<input value={current.angle} maxLength={300} onChange={event => change(value => ({ ...value, angle: event.target.value }))} /></label>
              <label className="field">导语与开场<textarea rows={2} value={current.intro} maxLength={1000} onChange={event => change(value => ({ ...value, intro: event.target.value }))} /></label>

              {current.sections.map((section, sectionIndex) => <div className="outline-section" key={section.id}>
                <div className="section-line"><h3>段落 {String(sectionIndex + 1).padStart(2, '0')}</h3><div className="row">
                  <Button variant="ghost" className="icon-button" aria-label={`上移段落${sectionIndex + 1}`} disabled={disabled || sectionIndex === 0} onClick={() => change(value => { const sections = [...value.sections]; [sections[sectionIndex - 1], sections[sectionIndex]] = [sections[sectionIndex], sections[sectionIndex - 1]]; return { ...value, sections }; })}><ChevronUp size={18} /></Button>
                  <Button variant="ghost" className="icon-button" aria-label={`下移段落${sectionIndex + 1}`} disabled={disabled || sectionIndex === current.sections.length - 1} onClick={() => change(value => { const sections = [...value.sections]; [sections[sectionIndex + 1], sections[sectionIndex]] = [sections[sectionIndex], sections[sectionIndex + 1]]; return { ...value, sections }; })}><ChevronDown size={18} /></Button>
                  <Button variant="ghost" className="icon-button" aria-label={`删除段落${sectionIndex + 1}`} disabled={disabled || current.sections.length === 1} onClick={() => change(value => ({ ...value, sections: value.sections.filter((_, index) => index !== sectionIndex) }))}><Trash2 size={18} /></Button>
                </div></div>
                <label className="field">段落标题<input value={section.heading} maxLength={100} onChange={event => change(value => ({ ...value, sections: value.sections.map((item, index) => index === sectionIndex ? { ...item, heading: event.target.value } : item) }))} /></label>
                <label className="field">写作要点（每行一个，最多四条）<textarea rows={3} value={section.points.join('\n')} maxLength={2600} onChange={event => change(value => ({ ...value, sections: value.sections.map((item, index) => index === sectionIndex ? { ...item, points: event.target.value.split('\n') } : item) }))} /></label>
                <details><summary>本段依据 · {section.factIds.length} 条</summary><div className="fact-options">
                  {outline.evidence.facts.map((fact, factIndex) => <label key={fact.id}><input type="checkbox" checked={section.factIds.includes(fact.id)} onChange={() => change(value => ({ ...value, sections: value.sections.map((item, index) => index === sectionIndex ? { ...item, factIds: item.factIds.includes(fact.id) ? item.factIds.filter(id => id !== fact.id) : [...item.factIds, fact.id] } : item) }))} /><span><strong>依据 {factIndex + 1}</strong> {fact.statement}{fact.qualifiers.length > 0 && <small>{fact.qualifiers.join('；')}</small>}</span></label>)}
                  {!outline.evidence.facts.length && <p>当前没有可选择的产品依据，请重新获取资料。</p>}
                </div></details>
              </div>)}

              <Button className="add-section" disabled={disabled || current.sections.length >= (current.platform === 'poster' ? 3 : 8)} onClick={() => change(value => ({ ...value, sections: [...value.sections, { id: `s-${crypto.randomUUID().slice(0, 8)}`, heading: '新的内容段落', points: ['请填写写作要点'], factIds: [] }] }))}><Plus size={18} />添加段落</Button>
              <label className="field">行动引导<input value={current.cta} maxLength={500} onChange={event => change(value => ({ ...value, cta: event.target.value }))} /></label>
              <details><summary>选择同型号配图 · {current.imageIds.length} 张{bounds ? `（需 ${bounds.minImages}–${bounds.maxImages} 张）` : '（配图规则尚未载入）'}</summary>
                <div className="outline-images">{outline.evidence.images.map(image => {
                  const selected = current.imageIds.includes(image.id);
                  const sameProduct = image.productId === outline.product.id;
                  return <label className={selected ? 'selected' : ''} key={image.id}><img src={image.url} alt={image.name} loading="lazy" /><span><input type="checkbox" checked={selected} disabled={disabled || !selected && (!sameProduct || !bounds || current.imageIds.length >= bounds.maxImages)} onChange={() => change(value => ({ ...value, imageIds: value.imageIds.includes(image.id) ? value.imageIds.filter(id => id !== image.id) : [...value.imageIds, image.id] }))} />{image.name}{!sameProduct && ' · 型号不符'}</span></label>;
                })}</div>
                {!outline.evidence.images.length && <p>当前没有可用的产品原图，请返回需求调整渠道或重新获取资料。</p>}
                {current.imageIds.filter(id => !outline.evidence.images.some(image => image.id === id)).map(id => <div className="notice warning" key={id}><span>已选配图不在当前资料中，请移除后重新选择。</span><Button disabled={disabled} onClick={() => change(value => ({ ...value, imageIds: value.imageIds.filter(imageId => imageId !== id) }))}>移除失效配图</Button></div>)}
              </details>
            </fieldset>
          </details>
        </div>}

        <section className="outline-ai"><label className="field" htmlFor={revisionId}>让 Virgo 调整方案<textarea id={revisionId} rows={3} maxLength={2000} disabled={disabled} value={revision} onChange={event => onRevision(event.target.value)} placeholder={outline.brief.mode === 'demo' ? '本地规则演示可输入“精简”；其他修改可直接手动编辑。' : '例如：更贴近家长的选购问题。'} /></label><Button onClick={onRevise} disabled={disabled || dirty || !revision.trim()}><Sparkles size={18} />调整方案</Button></section>
        {invalidImages && <p className="notice warning" role="alert">配图数量或型号无效。请按各渠道标注的最少与最多张数调整，再保存、确认。</p>}
        {dirty && <p className="notice warning" role="status">有未保存修改。请先保存，再调整或确认方案；旧版确认不能用于生成本次编辑内容。</p>}
        <div className="outline-actions"><Button variant="ghost" onClick={onBack} disabled={busy}><ArrowLeft size={18} />返回需求</Button><Button onClick={onSave} disabled={saveDisabled}>保存修改</Button><Button variant="primary" onClick={onConfirm} disabled={confirmDisabled}><Check size={18} />确认本版方案</Button><Button variant="primary" onClick={onGenerate} disabled={generateDisabled}>生成内容<ArrowRight size={18} /></Button></div>
      </div>

      <aside className="outline-sources" aria-label="方案依据"><h2>每个表达，都有来处。</h2><div><p>{sourceSummary} · {outline.evidence.images.length} 张来源图片</p><p>{sourceDescription}</p></div><Button onClick={onSources} disabled={busy}>查看来源与配图</Button><hr /><h3>方案确认 ≠ 事实审核通过</h3><p>确认的是当前版本的写作方向。正文生成后，再进行独立审核。</p><p>保存或 AI 调整后，旧确认失效。请重新确认新版本。</p>{outline.warnings.length > 0 && <details><summary>证据与流程提示（{outline.warnings.length}）</summary>{outline.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}</aside>
    </div>
    <div className="mobile-outline-actions"><Button variant="primary" disabled={dirty ? saveDisabled : confirmed ? generateDisabled : confirmDisabled} onClick={dirty ? onSave : confirmed ? onGenerate : onConfirm}>{dirty ? '保存修改' : confirmed ? '生成内容' : '确认本版方案'}</Button></div>
  </>;
}
