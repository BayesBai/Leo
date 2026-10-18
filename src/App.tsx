import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck,
  CheckCircle2, ChevronDown, ChevronRight, Circle, CircleHelp, Clock3, Copy, FileText,
  History, Image as ImageIcon, Layers3, LoaderCircle, PanelRightClose, Plus, RefreshCw,
  Search, Settings2, ShieldCheck, Sparkles, Square, WandSparkles, X, AlertCircle, Zap,
} from 'lucide-react';
import type {
  AppStatus, Brief, Draft, Fact, ImageAsset, Platform, RunResult, StreamEvent, TraceEntry,
} from '../shared/types';

const PLATFORM: Record<Platform, { name: string; short: string; letter: string; className: string; detail: string }> = {
  xiaohongshu: { name: '小红书', short: '小红书笔记', letter: '红', className: 'xhs', detail: '场景共鸣 · 种草分享' },
  wechat: { name: '公众号', short: '微信公众号', letter: '微', className: 'wechat', detail: '深入解读 · 价值沟通' },
  moments: { name: '朋友圈', short: '微信朋友圈', letter: '圈', className: 'moments', detail: '简洁表达 · 到店转化' },
  poster: { name: '门店海报', short: '门店海报', letter: '展', className: 'poster', detail: '核心卖点 · 视觉聚焦' },
};
const DEFAULT_BRIEF: Brief = {
  productId: '', audience: '大学新生', scene: '开学购机', goal: '到店体验', buyingStage: '对比选择',
  platforms: ['xiaohongshu', 'wechat'], instructions: '', mode: 'demo', knowledgeSource: 'local',
};
const STORAGE_KEY = 'zhixu-brief-v1';
const SAFE_PLATFORM = Object.keys(PLATFORM);

function loadPreferences(): Brief {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const saved: Partial<Brief> = {};
    for (const key of ['productId', 'audience', 'scene', 'goal', 'buyingStage', 'instructions'] as const) {
      if (typeof raw[key] === 'string') saved[key] = raw[key].slice(0, 1200);
    }
    if (Array.isArray(raw.platforms) && raw.platforms.length > 0) {
      saved.platforms = raw.platforms.filter((p: unknown) => typeof p === 'string' && SAFE_PLATFORM.includes(p)).slice(0, 2);
    }
    return { ...DEFAULT_BRIEF, ...saved, mode: 'demo', knowledgeSource: 'local' };
  } catch { return { ...DEFAULT_BRIEF }; }
}

function safeUrl(value?: string) {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; }
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function modeLabel(result: RunResult) {
  return result.brief.mode === 'demo' ? '本地演示' : result.evidence.sourceMode === 'ima' ? '模型创作 · ima 资料' : '模型创作 · 本地资料';
}

function markdown(result: RunResult, selectedTitles: Record<string, number>) {
  const b = result.brief;
  const lines = [
    '# 华为 PC 营销内容方案', '', `> ${modeLabel(result)}。${result.notice}`, '',
    '## 一、场景判断', '', `- 产品：${result.product.name}`, `- 人群：${b.audience}`,
    `- 使用场景：${b.scene}`, `- 传播目标：${b.goal}`, `- 购买阶段：${b.buyingStage}`, '',
    ...result.strategies.flatMap(s => [
      `### ${PLATFORM[s.platform].name}策略`, '', `内容切入：${s.angle}`, '', `用户问题：${s.painPoint}`,
      '', `表达语气：${s.tone}`, '', `内容结构：${s.structure.join(' → ')}`, '', `行动引导：${s.cta}`, '',
    ]),
    '## 二、知识库依据', '',
    ...result.evidence.facts.flatMap((f, i) => [
      `### 依据 ${i + 1}：${f.statement}`, '', `原文：${f.quote}`, '',
      `资料：${f.sourceTitle}；来源：${f.sourceMode === 'ima' ? 'ima' : '本地资料'}；状态：${f.status === 'supported' ? '已找到支持原文' : '待确认'}`,
      ...(f.qualifiers.length ? [`限定条件：${f.qualifiers.join('；')}`] : []), '',
    ]),
    '## 三、图文软文', '',
  ];
  for (const draft of result.drafts) {
    function appendImage(placement: (typeof draft.images)[number]) {
      const asset = result.evidence.images.find(i => i.id === placement.imageId);
      lines.push(
        `配图：${asset?.name || '待确认的图片素材'}`,
        `插入位置：${placement.afterBlock < 0 ? '封面' : `第 ${placement.afterBlock + 1} 段后`}`,
        `图注：${placement.caption}`,
        `选图理由：${placement.reason}`,
        `图片来源：${asset?.sourceTitle || '尚未取得可用来源，请确认后使用'}`,
        '',
      );
    }
    lines.push(`### ${PLATFORM[draft.platform].name}`, '', `# ${draft.titles[selectedTitles[draft.id] || 0] || draft.titles[0]}`, '');
    draft.images.filter(p => p.afterBlock < 0).forEach(appendImage);
    lines.push(draft.intro, '');
    draft.blocks.forEach((block, index) => {
      if (block.heading) lines.push(`#### ${block.heading}`, '');
      lines.push(block.text, '');
      const refs = block.factIds.map(id => result.evidence.facts.findIndex(f => f.id === id) + 1).filter(x => x > 0);
      if (refs.length) lines.push(`依据：${refs.map(x => `[依据 ${x}]`).join(' ')}`, '');
      draft.images.filter(p => p.afterBlock === index).forEach(appendImage);
    });
    lines.push(draft.cta, '', draft.tags.map(t => t.startsWith('#') ? t : `#${t}`).join(' '), '');
    draft.images.filter(p => p.afterBlock >= draft.blocks.length).forEach(appendImage);
  }
  lines.push('## 四、核验结果', '',
    `核验方式：${result.review.reviewedBy === 'rules' ? '规则检查，未进行模型语义核验' : '规则检查 + 模型复核'}`,
    `结果：${result.review.status === 'passed' ? '检查项通过' : result.review.status === 'blocked' ? '需补充关键信息' : '有待确认项'}`, '',
    ...result.review.checks.map(c => `- ${c.label}：${c.status === 'pass' ? '通过' : c.status === 'warning' ? '待确认' : '未通过'}。${c.detail}`), '',
    ...result.review.issues.map(i => `- ${i.message} 建议：${i.suggestion}`), '',
    '配图访问地址与内部标识未包含在本导出中。',
  );
  let output = lines.join('\n');
  const references = [
    ...result.evidence.facts.map((fact, index) => [fact.id, `依据 ${index + 1}`] as const),
    ...result.evidence.images.map(image => [image.id, `图片「${image.name}」`] as const),
    ...result.evidence.sources.map(source => [source.id, `资料「${source.title}」`] as const),
    [result.product.id, result.product.name] as const,
  ].filter(([id]) => id.length > 0).sort(([a], [b]) => b.length - a.length);
  for (const [id, label] of references) output = output.split(id).join(label);
  return output
    .replace(/\b(?:image|img|asset)[-_][a-zA-Z0-9][a-zA-Z0-9_-]*\b/g, '所指素材')
    .replace(/\b(?:fact|evidence)[-_][a-zA-Z0-9][a-zA-Z0-9_-]*\b/g, '所指依据')
    .replace(/\b(?:source|doc)[-_][a-zA-Z0-9][a-zA-Z0-9_-]*\b/g, '所指资料')
    .replace(/\bblock[-_][a-zA-Z0-9][a-zA-Z0-9_-]*\b/g, '所指段落');
}

async function consumeStream(response: Response, onEvent: (event: StreamEvent) => void) {
  if (!response.ok) {
    const body = await response.text();
    let message = `请求失败（${response.status}）`;
    try { message = JSON.parse(body).message || JSON.parse(body).error || message; } catch { /* The status remains user-readable. */ }
    throw new Error(message);
  }
  if (!response.body) throw new Error('浏览器未能读取流式响应，请刷新后重试。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let receivedResult = false;
  function frame(text: string) {
    const payload = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload || payload === '[DONE]') return;
    const event = JSON.parse(payload) as StreamEvent;
    if (event.type === 'result' || event.type === 'needs_input' || event.type === 'error') receivedResult = true;
    onEvent(event);
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        frame(pending.slice(0, match.index));
        pending = pending.slice(match.index + match[0].length);
      }
      if (done) break;
    }
    if (pending.trim()) frame(pending);
    if (!receivedResult) throw new Error('连接已结束，但没有收到完整结果。请重试。');
  } finally { reader.releaseLock(); }
}

type RightTab = 'facts' | 'images' | 'checks';
type Modal = 'settings' | 'help' | 'history' | null;

export default function App() {
  const [brief, setBrief] = useState<Brief>(loadPreferences);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [products, setProducts] = useState<RunResult['product'][]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [history, setHistory] = useState<RunResult[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [error, setError] = useState('');
  const [questions, setQuestions] = useState<string[]>([]);
  const [workspaceTab, setWorkspaceTab] = useState<'preview' | 'strategy'>('preview');
  const [rightTab, setRightTab] = useState<RightTab>('facts');
  const [selectedFactId, setSelectedFactId] = useState('');
  const [selectedTitles, setSelectedTitles] = useState<Record<string, number>>({});
  const [revise, setRevise] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState('');
  const [mobilePanel, setMobilePanel] = useState<'brief' | 'content' | 'evidence'>('content');
  const abortRef = useRef<AbortController | null>(null);
  const evidenceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function initialize() {
      const requests = await Promise.allSettled([
        fetch('/api/status', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('连接状态暂时不可用'); return r.json() as Promise<AppStatus>; }),
        fetch('/api/products', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('产品列表载入失败'); return r.json() as Promise<{ products: RunResult['product'][] }>; }),
        fetch('/api/sample', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('演示内容载入失败'); return r.json() as Promise<RunResult>; }),
      ]);
      if (controller.signal.aborted) return;
      const [statusRes, productsRes, sampleRes] = requests;
      if (statusRes.status === 'fulfilled') setStatus(statusRes.value);
      if (productsRes.status === 'fulfilled') setProducts(productsRes.value.products);
      if (sampleRes.status === 'fulfilled') {
        setResult(sampleRes.value); setTrace(sampleRes.value.trace);
        setBrief(current => ({ ...current, productId: productsRes.status === 'fulfilled' && productsRes.value.products.some(p => p.id === current.productId) ? current.productId : sampleRes.value.product.id }));
      } else setError('未能载入示例内容。请确认本地服务已启动，再刷新页面。');
      setInitializing(false);
    }
    void initialize();
    return () => { controller.abort(); abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    try {
      const { productId, audience, scene, goal, buyingStage, platforms, instructions } = brief;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ productId, audience, scene, goal, buyingStage, platforms, instructions }));
    } catch { /* A restricted storage policy should not interrupt creation. */ }
  }, [brief]);

  useEffect(() => { if (toast) { const timeout = window.setTimeout(() => setToast(''), 3000); return () => window.clearTimeout(timeout); } }, [toast]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setModal(null); };
    window.addEventListener('keydown', closeOnEscape);
    window.setTimeout(() => document.getElementById('modal-close')?.focus(), 0);
    return () => { window.removeEventListener('keydown', closeOnEscape); previous?.focus(); };
  }, [modal]);

  function update<K extends keyof Brief>(key: K, value: Brief[K]) { setBrief(current => ({ ...current, [key]: value })); }
  const selectedProduct = products.find(p => p.id === brief.productId);
  const ready = Boolean(brief.productId && brief.audience.trim() && brief.scene.trim() && brief.platforms.length);
  const liveDisabled = !status?.model.configured || (brief.knowledgeSource === 'ima' && !status?.ima.verified);
  const canGenerate = ready && !busy && (brief.mode === 'demo' || !liveDisabled);
  const review = result?.review;
  const citedCount = result?.review.citedFactCount || 0;
  const revisionMatchesBrief = Boolean(result && result.brief.productId === brief.productId && result.brief.mode === brief.mode && result.brief.knowledgeSource === brief.knowledgeSource);

  function pickPlatform(platform: Platform) {
    if (busy) return;
    if (brief.platforms.includes(platform)) {
      if (brief.platforms.length === 1) { setToast('至少保留一个发布平台'); return; }
      update('platforms', brief.platforms.filter(p => p !== platform));
    } else if (brief.platforms.length < 2) update('platforms', [...brief.platforms, platform]);
    else setToast('最多同时比较两个平台，请先取消一个平台');
  }

  async function run(path: '/api/generate' | '/api/revise') {
    if (busy) return;
    if (path === '/api/generate' && !canGenerate) return;
    if (path === '/api/revise' && (!result || !revise.trim())) return;
    if (path === '/api/revise' && !revisionMatchesBrief) { setToast('产品或创作模式已改变，请先生成当前设置的新稿'); return; }
    setBusy(true); setError(''); setQuestions([]); setTrace([]); setMobilePanel('content');
    const controller = new AbortController(); abortRef.current = controller;
    let finalResult = false;
    try {
      const response = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify(path === '/api/generate' ? brief : { runId: result!.id, instructions: revise.trim() }),
      });
      await consumeStream(response, event => {
        if (event.type === 'progress' && event.entry) {
          const entry = event.entry;
          setTrace(current => { const index = current.findIndex(e => e.step === entry.step); return index < 0 ? [...current, entry] : current.map((e, i) => i === index ? entry : e); });
        }
        if (event.type === 'result' && event.result) {
          const next = event.result;
          setResult(next); setBrief(next.brief); setHistory(current => [next, ...current.filter(r => r.id !== next.id)].slice(0, 8));
          setTrace(next.trace); setSelectedTitles({}); setSelectedFactId(''); setRevise('');
          finalResult = true; setToast(path === '/api/revise' ? '内容已更新，核验结果已同步' : '多平台内容已就绪');
        }
        if (event.type === 'error') setError(event.message || '本次任务未完成，请稍后重试。');
        if (event.type === 'needs_input') {
          setQuestions(event.fields?.map(f => f.question) || [event.message || '请补充任务信息。']);
          setMobilePanel('brief');
        }
      });
    } catch (reason) {
      if (controller.signal.aborted) setToast('任务已停止，已完成的内容仍然保留');
      else setError(reason instanceof Error ? reason.message : '网络连接异常，请检查服务后重试。');
    } finally {
      if (!finalResult && controller.signal.aborted) setTrace(current => current.map(t => t.status === 'running' ? { ...t, status: 'error', detail: '任务已取消' } : t));
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  async function verifyConnections() {
    setVerifying(true);
    try {
      const response = await fetch('/api/connections/verify', { method: 'POST' });
      if (!response.ok) {
        const body = await response.text();
        let message = `连接验证失败（${response.status}），请检查服务端配置`;
        try { const detail = JSON.parse(body); message = detail.message || detail.error || message; } catch { /* Preserve the HTTP status when no structured diagnostic is available. */ }
        throw new Error(message);
      }
      const next = await response.json() as AppStatus; setStatus(next);
      setToast(next.ima.verified ? 'ima 连接已验证' : next.ima.message || '请检查连接配置');
    } catch (reason) { setToast(reason instanceof Error ? reason.message : '连接验证失败'); }
    finally { setVerifying(false); }
  }

  function focusEvidence(id?: string, tab: RightTab = 'facts') {
    setRightTab(tab); if (id) setSelectedFactId(id); setMobilePanel('evidence');
    window.setTimeout(() => {
      const element = id ? document.getElementById(`fact-${id}`) : evidenceRef.current;
      element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  async function copyContent() {
    if (!result) return;
    try { await navigator.clipboard.writeText(markdown(result, selectedTitles)); setToast('已复制完整方案，包含依据与核验结果'); }
    catch { setToast('浏览器未开放剪贴板权限，请使用导出按钮保存'); }
  }

  function exportContent() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([markdown(result, selectedTitles)], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `知序-${result.product.name}-内容方案.md`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000); setToast('Markdown 方案已导出');
  }

  function resetBrief() {
    if (busy) return;
    setBrief({ ...DEFAULT_BRIEF, productId: products[0]?.id || result?.product.id || '' });
    setError(''); setQuestions([]); setRevise(''); setMobilePanel('brief'); setToast('新任务已准备好，当前作品保留供参考');
  }

  return (
    <div className="app-shell">
      <aside className="navigation" aria-label="主导航">
        <button className="brand-mark" aria-label="知序首页" onClick={() => { setModal(null); setMobilePanel('content'); }}><span>知</span><i /></button>
        <div className="nav-items">
          <button className="nav-item active" aria-label="内容工作台" title="内容工作台" onClick={() => { setMobilePanel('content'); setModal(null); }}><Layers3 size={21} /></button>
          <button className="nav-item" aria-label="查看知识依据" title="知识依据" onClick={() => focusEvidence()}><BookOpen size={21} /></button>
          <button className="nav-item" aria-label="本次会话历史" title="本次会话历史" onClick={() => setModal('history')}><History size={21} /></button>
        </div>
        <div className="nav-bottom">
          <button className="nav-item" aria-label="使用帮助" title="使用帮助" onClick={() => setModal('help')}><CircleHelp size={21} /></button>
          <button className="nav-item" aria-label="连接设置" title="连接设置" onClick={() => setModal('settings')}><Settings2 size={21} /></button>
          <span className="avatar">Z</span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="brand-copy"><strong>知序<span className="brand-dot">·</span><span>PC 内容工作台</span></strong><small>HUAWEI PC CONTENT STUDIO</small></div>
          <div className="topbar-actions">
            <button className="connection-pill" title={status ? `本地资料：${status.local.productCount} 款产品 · ${status.local.imageCount} 张图片` : '查看连接状态'} onClick={() => setModal('settings')}><span className={`status-dot ${status?.ima.verified ? 'connected' : ''}`} />{status?.ima.verified ? 'ima 已连接' : '本地知识库'}<ChevronRight size={13} /></button>
            <span className="topbar-divider" />
            <button className="button subtle" onClick={resetBrief} disabled={busy}><Plus size={16} />新建任务</button>
          </div>
        </header>

        <main>
          <section className="page-heading">
            <div><div className="eyebrow"><span />FROM PRODUCT TRUTH TO GOOD STORIES</div><h1>让产品价值，<span>被更好地看见。</span></h1><p>以知识为依据，为不同的人，写出恰到好处的内容。</p></div>
            <div className="heading-meta"><span className="edition-badge"><Sparkles size={13} />黑客松演示版</span><span>场景 · 策略 · 创作 · 核验</span></div>
          </section>

          <div className="workspace-status">
            <div className="workspace-status-left"><span className="live-dot" /><strong>内容工作台</strong><span className="slash">/</span><span>{result ? result.product.name : '新建营销方案'}</span></div>
            <div className="workspace-status-right"><Clock3 size={13} /><span>{result ? `${formatTime(result.createdAt)} 更新` : '准备就绪'}</span><span className="outline-badge">{result ? modeLabel(result) : '本地演示'}</span></div>
          </div>

          <div className="mobile-switch" aria-label="工作区切换">
            {(['brief', 'content', 'evidence'] as const).map((tab, i) => <button key={tab} className={mobilePanel === tab ? 'selected' : ''} onClick={() => setMobilePanel(tab)}>{['任务设定', '内容预览', '知识与核验'][i]}</button>)}
          </div>

          <div className="workspace-grid">
            <section className={`brief-panel panel ${mobilePanel === 'brief' ? 'mobile-visible' : ''}`} aria-labelledby="brief-heading">
              <div className="panel-heading"><div className="panel-heading-title"><span className="section-number">01</span><h2 id="brief-heading">创作任务</h2></div><button className="icon-button" onClick={resetBrief} title="重置任务" aria-label="重置任务" disabled={busy}><RefreshCw size={14} /></button></div>
              <form onSubmit={event => { event.preventDefault(); void run('/api/generate'); }}>
                <fieldset disabled={busy}>
                  <div className="field-group">
                    <label htmlFor="product">选择产品<span>PRODUCT</span></label>
                    <div className="select-wrap"><select id="product" value={brief.productId} onChange={e => update('productId', e.target.value)}><option value="" disabled>请选择产品</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={14} /></div>
                    {selectedProduct && <div className="product-summary"><span className="tiny-square" /><span>{selectedProduct.system}</span><span className="product-dot">·</span><span>{selectedProduct.imageCount} 张可用素材</span></div>}
                  </div>
                  <div className="field-group"><label htmlFor="audience">写给谁<span>AUDIENCE</span></label><input id="audience" value={brief.audience} onChange={e => update('audience', e.target.value)} placeholder="例如：刚入学的大学新生" maxLength={160} /><div className="preset-tags">{['大学新生', '职场新人', '差旅办公'].map(x => <button type="button" key={x} className={brief.audience === x ? 'selected' : ''} onClick={() => update('audience', x)}>{x}</button>)}</div></div>
                  <div className="field-group"><label htmlFor="scene">什么场景<span>SCENARIO</span></label><input id="scene" value={brief.scene} onChange={e => update('scene', e.target.value)} placeholder="例如：开学购机、移动办公" maxLength={160} /><div className="preset-tags">{['开学购机', '高效办公', '创作表达'].map(x => <button type="button" key={x} className={brief.scene === x ? 'selected' : ''} onClick={() => update('scene', x)}>{x}</button>)}</div></div>
                  <div className="field-group"><label>发布到哪里<span>最多 2 个</span></label><div className="platform-picker">{(Object.keys(PLATFORM) as Platform[]).map(p => <button type="button" aria-pressed={brief.platforms.includes(p)} key={p} className={brief.platforms.includes(p) ? 'selected' : ''} onClick={() => pickPlatform(p)}><span className={`platform-icon ${PLATFORM[p].className}`}>{PLATFORM[p].letter}</span><span>{PLATFORM[p].name}</span><span className="selection-check">{brief.platforms.includes(p) ? <Check size={11} /> : <span />}</span></button>)}</div></div>
                  <div className="field-row"><div className="field-group"><label htmlFor="goal">传播目标</label><div className="select-wrap"><select id="goal" value={brief.goal} onChange={e => update('goal', e.target.value)}>{['到店体验', '了解产品', '咨询转化', '品牌认知'].map(x => <option key={x}>{x}</option>)}</select><ChevronDown size={13} /></div></div><div className="field-group"><label htmlFor="buyingStage">购买阶段</label><div className="select-wrap"><select id="buyingStage" value={brief.buyingStage} onChange={e => update('buyingStage', e.target.value)}>{['对比选择', '初步了解', '准备购买', '使用分享'].map(x => <option key={x}>{x}</option>)}</select><ChevronDown size={13} /></div></div></div>
                  <div className="field-group"><label htmlFor="instructions">还有什么想法<span>选填</span></label><textarea id="instructions" value={brief.instructions} onChange={e => update('instructions', e.target.value)} rows={3} maxLength={1200} placeholder="例如：突出学习与创作场景，语气自然，避免夸张表达…" /></div>
                  <div className="engine-choice"><label htmlFor="engine">创作方式<button type="button" onClick={() => setModal('settings')} aria-label="了解创作模式"><CircleHelp size={13} /></button></label><div className="select-wrap"><select id="engine" value={`${brief.mode}:${brief.knowledgeSource}`} onChange={e => { const [mode, knowledgeSource] = e.target.value.split(':') as [Brief['mode'], Brief['knowledgeSource']]; setBrief(current => ({ ...current, mode, knowledgeSource })); }}><option value="demo:local">本地演示 · 规则模板</option><option value="live:local" disabled={!status?.model.configured}>模型创作 · 本地资料{!status?.model.configured ? '（待配置）' : ''}</option><option value="live:ima" disabled={!status?.model.configured || !status?.ima.verified}>正式接入 · ima 资料{!status?.ima.verified ? '（待连接）' : ''}</option></select><ChevronDown size={13} /></div><p>{brief.mode === 'demo' ? '使用本地资料与规则模板，可体验完整流程。' : brief.knowledgeSource === 'ima' ? '使用真实模型与已验证的 ima 原始资料。' : '使用真实模型创作，产品依据来自本地资料。'}</p></div>
                </fieldset>
                <div className="generate-wrap">{busy ? <button type="button" className="button primary generate-button" onClick={() => abortRef.current?.abort()}><Square size={14} fill="currentColor" />停止生成</button> : <button type="submit" className="button primary generate-button" disabled={!canGenerate}><WandSparkles size={17} />生成内容方案<ArrowRight size={16} /></button>}<span className="generation-caption"><ShieldCheck size={12} />每一个卖点，都有依据</span></div>
              </form>
            </section>

            <section className={`content-panel ${mobilePanel === 'content' ? 'mobile-visible' : ''}`} aria-labelledby="content-heading">
              <div className="content-toolbar"><div className="content-tabs" role="tablist" aria-label="内容视图"><button role="tab" aria-selected={workspaceTab === 'preview'} className={workspaceTab === 'preview' ? 'selected' : ''} onClick={() => setWorkspaceTab('preview')}><FileText size={15} />图文预览</button><button role="tab" aria-selected={workspaceTab === 'strategy'} className={workspaceTab === 'strategy' ? 'selected' : ''} onClick={() => setWorkspaceTab('strategy')}><Zap size={15} />内容策略</button></div><div className="toolbar-actions"><button className="icon-button" onClick={() => void copyContent()} disabled={!result} aria-label="复制完整内容" title="复制完整内容"><Copy size={15} /></button><button className="button small export-button" onClick={exportContent} disabled={!result}><ArrowDownToLine size={14} /><span>导出</span></button></div></div>
              <h2 id="content-heading" className="sr-only">多平台内容预览</h2>
              {error && <div className="message error-message" role="alert"><AlertCircle size={17} /><div><strong>本次任务尚未完成</strong><p>{error}</p></div><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={14} /></button></div>}
              {questions.length > 0 && <div className="message question-message" role="alert"><CircleHelp size={17} /><div><strong>还需要补充一点信息</strong>{questions.map(q => <p key={q}>{q}</p>)}<button className="text-button" onClick={() => setMobilePanel('brief')}>完善左侧任务 <ArrowRight size={13} /></button></div></div>}
              {busy && <div className="progress-panel" aria-live="polite"><div className="progress-title"><span><LoaderCircle size={16} className="spin" /><strong>正在组织你的内容方案</strong></span><small>依据先行，逐步创作</small></div><div className="progress-steps">{trace.length ? trace.map(entry => <div key={entry.step} className={`progress-step ${entry.status}`}>{entry.status === 'done' ? <CheckCircle2 size={14} /> : entry.status === 'error' ? <AlertCircle size={14} /> : <LoaderCircle size={14} className="spin" />}<span>{entry.label}</span></div>) : <div className="progress-step running"><LoaderCircle size={14} className="spin" /><span>准备任务</span></div>}</div>{trace.length > 0 && <p>{trace[trace.length - 1].detail}</p>}</div>}
              {initializing && <div className="empty-state"><LoaderCircle size={30} className="spin" /><h3>正在打开内容工作台</h3><p>载入产品资料与示例方案…</p></div>}
              {!initializing && !result && <div className="empty-state"><WandSparkles size={36} /><h3>从一个好场景开始</h3><p>设定产品、人群与发布平台，生成第一份内容方案。</p></div>}
              {result && <>
                <div className={`source-notice ${result.brief.mode === 'demo' ? 'demo' : ''}`}><span className="notice-symbol">{result.brief.mode === 'demo' ? <Layers3 size={14} /> : <Sparkles size={14} />}</span><p><strong>{modeLabel(result)}</strong><span>{result.notice}</span></p><span className="notice-mini">{result.revision > 1 ? `第 ${result.revision - 1} 次修订` : '初稿'}</span></div>
                {workspaceTab === 'preview' ? <div className={`drafts-grid ${result.drafts.length === 1 ? 'single' : ''}`}>{result.drafts.map(draft => <DraftPreview key={draft.id} draft={draft} result={result} selectedTitle={selectedTitles[draft.id] || 0} onSelectTitle={index => setSelectedTitles(current => ({ ...current, [draft.id]: index }))} onEvidence={focusEvidence} />)}</div> : <div className="strategy-grid">{result.strategies.map((strategy, index) => <article className="strategy-card" key={strategy.platform}><div className="draft-platform"><span className={`platform-icon ${PLATFORM[strategy.platform].className}`}>{PLATFORM[strategy.platform].letter}</span><div><h3>{PLATFORM[strategy.platform].short}</h3><small>{PLATFORM[strategy.platform].detail}</small></div><span className="strategy-index">0{index + 1}</span></div><div className="strategy-angle"><span>内容切入</span><h3>{strategy.angle}</h3><p>{strategy.painPoint}</p></div><div className="strategy-line"><span>表达语气</span><p>{strategy.tone}</p></div><div className="strategy-line"><span>卖点到价值</span><div>{strategy.sellingPoints.map((s, i) => <button className="strategy-selling" key={`${s.factId}-${i}`} onClick={() => focusEvidence(s.factId)}><span>0{i + 1}</span><p>{s.benefit}</p><ArrowUpRight size={13} /></button>)}</div></div><div className="strategy-line"><span>叙事结构</span><div className="structure-list">{strategy.structure.map((s, i) => <div key={`${s}-${i}`}><i>{i + 1}</i><p>{s}</p></div>)}</div></div><div className="strategy-meta"><span><ImageIcon size={13} />计划配图 {strategy.imageCount} 张</span><span>{strategy.buyingStage}</span></div><div className="strategy-cta"><ArrowRight size={15} /><p>{strategy.cta}</p></div></article>)}</div>}
                <div className="revision-box"><div className="revision-icon"><WandSparkles size={18} /></div><div className="revision-main"><label htmlFor="revision">让内容再靠近一点你的想法</label><div className="revision-input-wrap"><input id="revision" value={revise} onChange={e => setRevise(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && revise.trim() && !busy && revisionMatchesBrief) void run('/api/revise'); }} placeholder={result.brief.mode === 'demo' ? '例如：精简文案，突出内存；或改成朋友圈' : '例如：语气更轻松，突出开学场景；或改成朋友圈'} maxLength={1200} disabled={busy || !revisionMatchesBrief} aria-describedby="revision-hint" /><button className="button revision-button" onClick={() => void run('/api/revise')} disabled={busy || !revise.trim() || !revisionMatchesBrief} aria-label="按要求修改内容" title={!revisionMatchesBrief ? '请先生成当前设置的新稿' : '按要求修改当前成稿'}><ArrowRight size={16} /></button></div><span id="revision-hint" className={!revisionMatchesBrief ? 'revision-warning' : ''}>{!revisionMatchesBrief ? '产品或创作模式已改变，请先生成当前设置的新稿。' : '修改后将重新检查事实引用、配图与平台规则'}</span></div></div>
                <div className="content-footer"><span><ShieldCheck size={13} />{citedCount} 项事实引用 · {result.evidence.images.length} 张素材可追溯</span><span>内容建议人工确认后发布</span></div>
              </>}
            </section>

            <aside ref={evidenceRef} className={`evidence-panel panel ${mobilePanel === 'evidence' ? 'mobile-visible' : ''}`} aria-labelledby="evidence-heading">
              <div className="panel-heading"><div className="panel-heading-title"><span className="section-number">02</span><h2 id="evidence-heading">知识与核验</h2></div><ShieldCheck size={17} className="muted" /></div>
              <div className="evidence-overview"><div><span>让创作有据可循</span><strong>{result?.evidence.facts.length || 0}<small>项产品依据</small></strong></div><div className="evidence-orbit"><BookOpen size={23} /><span><Check size={10} /></span></div></div>
              <div className="evidence-tabs" role="tablist" aria-label="依据分类">{(['facts', 'images', 'checks'] as const).map((tab, i) => <button key={tab} role="tab" aria-selected={rightTab === tab} className={rightTab === tab ? 'selected' : ''} onClick={() => setRightTab(tab)}>{['产品事实', '图片素材', '内容核验'][i]}{tab === 'checks' && review && review.issues.filter(x => x.severity !== 'info').length > 0 && <i />}</button>)}</div>
              {result && <div className="evidence-body">
                {rightTab === 'facts' && <><div className="evidence-section-caption"><span><span className={`status-dot ${result.evidence.sourceMode === 'ima' ? 'connected' : ''}`} />{result.evidence.sourceMode === 'ima' ? 'ima 原始资料' : '本地产品资料'}</span><span>{result.evidence.facts.length} 项</span></div>{result.evidence.facts.map((fact, index) => <FactCard key={fact.id} fact={fact} index={index} selected={selectedFactId === fact.id} onSelect={() => setSelectedFactId(selectedFactId === fact.id ? '' : fact.id)} />)}<div className="evidence-footnote"><BookOpen size={13} /><p>点击正文中的依据标记，可定位对应原文。所有产品描述需受原文限定条件约束。</p></div></>}
                {rightTab === 'images' && <><div className="evidence-section-caption"><span>与当前型号匹配的素材</span><span>{result.evidence.images.length} 张</span></div><div className="image-library">{result.evidence.images.map(asset => <div className="asset-card" key={asset.id}><div className="asset-image"><SafeImage asset={asset} /></div><strong>{asset.name}</strong><p>{asset.description}</p><small>{asset.sourceTitle}</small><span className="asset-badge">{asset.sourceMode === 'ima' ? 'ima' : '本地素材'}</span></div>)}</div>{!result.evidence.images.length && <div className="empty-evidence"><ImageIcon size={28} /><p>没有取得可用图片，需补充当前型号素材。</p></div>}</>}
                {rightTab === 'checks' && <><div className={`review-summary ${review?.status}`}><ShieldCheck size={21} /><div><strong>{review?.status === 'passed' ? '当前检查项已通过' : review?.status === 'blocked' ? '关键信息需要补充' : '有内容需要留意'}</strong><p>{review?.reviewedBy === 'rules' ? '已完成规则检查，未进行模型语义核验' : '已完成规则检查与模型复核'}</p></div></div><div className="review-metrics"><div><strong>{review?.citedFactCount}/{review?.factCount}</strong><span>事实引用</span></div><div><strong>{review?.imageCount}</strong><span>已配图片</span></div><div><strong>{review?.issues.filter(i => i.severity !== 'info').length}</strong><span>待确认项</span></div></div><div className="checklist">{review?.checks.map((check, index) => <div className={`checklist-item ${check.status}`} key={`${check.label}-${index}`}>{check.status === 'pass' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}<div><strong>{check.label}</strong><p>{check.detail}</p></div></div>)}</div>{review?.issues.map(issue => <div className={`review-issue ${issue.severity}`} key={issue.id}><span>{issue.severity === 'error' ? '需修正' : issue.severity === 'warning' ? '待确认' : '提示'}</span><strong>{issue.message}</strong><p>{issue.suggestion}</p>{issue.factId && <button className="text-button" onClick={() => focusEvidence(issue.factId)}>查看对应依据<ArrowUpRight size={12} /></button>}</div>)}</>}
                {rightTab === 'checks' && <details className="trace-log"><summary><History size={13} />查看任务执行记录<span>{result.trace.length} 步</span></summary><div>{result.trace.map((entry, index) => <div className={`trace-log-entry ${entry.status}`} key={`${entry.step}-${index}`}>{entry.status === 'done' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}<div><strong>{entry.label}</strong><p>{entry.detail}</p><small>{formatTime(entry.at)}{entry.elapsedMs !== undefined ? ` · ${(entry.elapsedMs / 1000).toFixed(1)} 秒` : ''}</small></div></div>)}</div></details>}
                {result.evidence.warnings.length > 0 && <div className="source-warnings">{result.evidence.warnings.map((warning, i) => <p key={i}><AlertCircle size={12} />{warning}</p>)}</div>}
              </div>}
              <div className="evidence-bottom"><span className="status-dot" /><span>知识来源可查看 · 生成过程可追踪</span></div>
            </aside>
          </div>
          <footer className="page-footer"><span>知序 · 让每一份内容，都有来处。</span><span>黑客松作品演示，非华为官方产品</span></footer>
        </main>
      </div>

      {toast && <div className="toast" role="status"><CheckCircle2 size={17} />{toast}<button aria-label="关闭提示" onClick={() => setToast('')}><X size={13} /></button></div>}

      {modal && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onKeyDown={event => { if (event.key !== 'Tab') return; const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]'); const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}><div className="modal-header"><div><span className="eyebrow">ZHIXU WORKSPACE</span><h2 id="modal-title">{modal === 'settings' ? '连接与创作模式' : modal === 'help' ? '从产品事实，到内容方案' : '本次会话历史'}</h2></div><button id="modal-close" className="icon-button" onClick={() => setModal(null)} aria-label="关闭弹窗"><X size={20} /></button></div>
        {modal === 'settings' && <div className="modal-body"><p className="modal-lead">从本地演示开始，按需连接真实模型与 ima 知识库。密钥仅保存在服务端。</p><div className="connection-card"><div><Sparkles size={20} /><div><strong>赛事模型接口</strong><p>{status?.model.name || 'claude-opus-5'}</p></div><span className={`connection-state ${status?.model.configured ? 'yes' : ''}`}>{status?.model.configured ? '已配置' : '待配置'}</span></div><p>在项目的 <code>.env.local</code> 中配置模型 API 密钥、服务地址与模型名称，重启服务后生效。</p><div className="config-example"><code>LLM_BASE_URL=https://api.openai-next.com</code><code>LLM_MODEL=claude-opus-5</code><code>LLM_API_KEY=你的赛事密钥</code></div><small>本工作台不会在浏览器中显示或保存密钥。</small></div><div className="connection-card"><div><BookOpen size={20} /><div><strong>ima 共享知识库</strong><p>{status?.ima.kbName || '指定共享知识库'}</p></div><span className={`connection-state ${status?.ima.verified ? 'yes' : ''}`}>{status?.ima.verified ? '连接已验证' : status?.ima.configured ? '待验证' : '待配置'}</span></div><p>{status?.ima.message || '配置服务端 ima 凭证与共享知识库后，验证读取权限。'}</p>{status?.ima.accountLabel && <small>账号：{status.ima.accountLabel}</small>}<button className="button small" disabled={verifying} onClick={() => void verifyConnections()}>{verifying ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}验证连接</button></div><div className="mode-explanation"><h3>三种清晰区分的模式</h3><p><strong>本地演示</strong>读取本地资料，使用规则模板演示流程。</p><p><strong>模型创作 · 本地资料</strong>真实调用赛事模型，本地资料提供产品依据。</p><p><strong>正式接入 · ima</strong>真实调用赛事模型，读取已验证 ima 原文与图片。</p></div></div>}
        {modal === 'help' && <div className="modal-body"><p className="modal-lead">先确定要对谁说、在什么场景说，再让产品事实成为表达的起点。</p><div className="help-steps">{[{ title: '设定创作任务', text: '选择准确的产品型号，补充人群、场景与目标，最多同时选择两个平台。' }, { title: '查看平台差异', text: '在图文预览与内容策略间切换，比较切入点、卖点顺序、表达语气与配图安排。' }, { title: '追溯产品依据', text: '点击正文中的依据标记，查看支持原文和限定条件。图片素材与当前产品对应。' }, { title: '修改、核验与导出', text: '用自然语言提出修改要求，再查看核验结果。导出的四部分方案包含场景、依据、文案与核验。' }].map((step, i) => <div key={step.title}><span>0{i + 1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></div>)}</div><div className="help-note"><ShieldCheck size={20} /><p>本地演示明确标注规则模板与本地资料。规则检查通过，代表相应检查项通过；发布前仍应确认实际产品信息与营销表述。</p></div></div>}
        {modal === 'history' && <div className="modal-body"><p className="modal-lead">仅保留当前浏览器会话内最近 8 次任务，刷新页面后清空。</p>{history.length ? history.map(item => <button className="history-card" key={`${item.id}-${item.revision}`} onClick={() => { setResult(item); setBrief(item.brief); setTrace(item.trace); setSelectedTitles({}); setModal(null); setMobilePanel('content'); }}><span className="history-icon"><FileText size={20} /></span><div><strong>{item.product.name}</strong><p>{item.brief.audience} · {item.brief.scene}</p><small>{modeLabel(item)} · {formatTime(item.createdAt)}</small></div><ArrowRight size={16} /></button>) : <div className="empty-state modal-empty"><History size={32} /><h3>第一份作品，即将开始</h3><p>生成内容方案后，会在这里保留本次会话的任务。</p></div>}</div>}
      </section></div>}
    </div>
  );
}

function SafeImage({ asset, className = '' }: { asset: ImageAsset; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [asset.url]);
  if (failed || !asset.url.startsWith('/api/assets/')) return <div className={`image-unavailable ${className}`}><ImageIcon size={24} /><span>图片暂不可用</span></div>;
  return <img className={className} src={asset.url} alt={asset.description || asset.name} loading="lazy" onError={() => setFailed(true)} />;
}

function DraftPreview({ draft, result, selectedTitle, onSelectTitle, onEvidence }: {
  draft: Draft; result: RunResult; selectedTitle: number; onSelectTitle: (index: number) => void;
  onEvidence: (id?: string, tab?: RightTab) => void;
}) {
  const info = PLATFORM[draft.platform];
  const placements = draft.images.map(p => ({ ...p, asset: result.evidence.images.find(i => i.id === p.imageId) })).filter(p => p.asset);
  const hero = placements[0];
  const platformIssues = result.review.issues.filter(issue => !issue.platform || issue.platform === draft.platform);
  const readiness = platformIssues.some(issue => issue.severity === 'error')
    ? '待修正'
    : platformIssues.some(issue => issue.severity === 'warning') || result.evidence.warnings.length > 0
      ? '待确认' : '草稿就绪';
  const [expanded, setExpanded] = useState(false);
  const previewBlocks = expanded ? draft.blocks : draft.blocks.slice(0, 2);
  const textLength = draft.intro.length + draft.blocks.reduce((sum, b) => sum + b.text.length, 0) + draft.cta.length;
  return <article className={`draft-card ${info.className}`}>
    <div className="draft-platform"><span className={`platform-icon ${info.className}`}>{info.letter}</span><div><h3>{info.short}</h3><small>{info.detail}</small></div><span className={`draft-ready ${readiness === '待修正' ? 'needs-fix' : readiness === '待确认' ? 'needs-confirmation' : ''}`}><span />{readiness}</span></div>
    <div className="draft-preview">
      {hero ? <button className="hero-image" onClick={() => onEvidence(undefined, 'images')} aria-label={`查看配图依据：${hero.asset!.name}`}><SafeImage asset={hero.asset!} /><span className="image-count"><ImageIcon size={11} />{placements.length} 张配图</span><span className="hero-local">{hero.asset!.sourceMode === 'ima' ? 'ima 素材' : '本地素材'}</span></button> : <div className="hero-image missing"><ImageIcon size={30} /><span>待补充当前型号配图</span></div>}
      <div className="draft-text"><div className="draft-meta-line"><span className="author-avatar">知</span><span>知序 · 产品内容企划</span><span className="draft-meta-divider">·</span><span>{draft.platform === 'xiaohongshu' ? '笔记草稿' : draft.platform === 'wechat' ? '文章草稿' : '内容草稿'}</span></div><h3 className="draft-title">{draft.titles[selectedTitle] || draft.titles[0]}</h3>
      {draft.titles.length > 1 && <div className="title-options" aria-label="选择标题"><span>备选标题</span>{draft.titles.map((title, i) => <button key={`${title}-${i}`} aria-label={`使用标题 ${i + 1}：${title}`} title={title} aria-pressed={selectedTitle === i} className={selectedTitle === i ? 'selected' : ''} onClick={() => onSelectTitle(i)}>{i + 1}</button>)}</div>}
      <p className="draft-intro">{draft.intro}</p>
      <div className="draft-blocks">{previewBlocks.map((block, index) => <section key={block.id} className="draft-block">{block.heading && <h4><span>{draft.platform === 'wechat' ? `${String(index + 1).padStart(2, '0')}` : ''}</span>{block.heading}</h4>}<p>{block.text}</p><div className="fact-chips">{block.factIds.map(id => { const factIndex = result.evidence.facts.findIndex(f => f.id === id); return factIndex >= 0 ? <button key={id} onClick={() => onEvidence(id)} title="查看支持原文"><BookOpen size={10} />依据 {factIndex + 1}<ArrowUpRight size={9} /></button> : null; })}</div>{expanded && placements.filter(p => p !== hero && p.afterBlock === index).map(p => <figure className="inline-placement" key={`${p.imageId}-${index}`}><SafeImage asset={p.asset!} /><figcaption>{p.caption}</figcaption></figure>)}</section>)}</div>
      {draft.blocks.length > 2 && <button className="expand-draft" onClick={() => setExpanded(!expanded)}>{expanded ? '收起部分正文' : `展开全部 ${draft.blocks.length} 段内容`}<ChevronDown size={13} className={expanded ? 'rotate' : ''} /></button>}
      <p className="draft-cta">{draft.cta}</p>{draft.tags.length > 0 && <div className="draft-tags">{draft.tags.map(t => <span key={t}>{t.startsWith('#') ? t : `#${t}`}</span>)}</div>}
      </div>
    </div>
    <details className="image-plan"><summary><ImageIcon size={12} /><span>配图编排</span><small>{draft.images.length} 张</small><ChevronDown size={12} /></summary><div className="image-plan-list">{draft.images.map((placement, index) => {
      const asset = result.evidence.images.find(image => image.id === placement.imageId);
      return <div className="image-plan-item" key={`${placement.imageId}-${index}`}><button className="image-plan-thumbnail" onClick={() => onEvidence(undefined, 'images')} aria-label={`查看配图来源：${asset?.name || '图片待确认'}`}>{asset ? <SafeImage asset={asset} /> : <ImageIcon size={18} />}</button><div className="image-plan-copy"><div className="image-plan-title"><strong title={asset?.name || '图片待确认'}>{asset?.name || '图片待确认'}</strong><span>{placement.afterBlock < 0 ? '封面' : `第 ${placement.afterBlock + 1} 段后`}</span></div><p><span>图注</span>{placement.caption}</p><p><span>选图理由</span>{placement.reason}</p><small title={asset?.sourceTitle}>{asset ? `来源：${asset.sourceTitle}` : '尚未取得可用来源，请确认后使用'}</small></div></div>;
    })}</div></details>
    <div className="draft-card-footer"><span>{textLength} 字 · {placements.length} 张配图</span><button onClick={() => onEvidence(undefined, 'checks')}><ShieldCheck size={12} />查看核验<ChevronRight size={11} /></button></div>
  </article>;
}

function FactCard({ fact, index, selected, onSelect }: { fact: Fact; index: number; selected: boolean; onSelect: () => void }) {
  const url = safeUrl(fact.sourceUrl);
  return <article className={`fact-card ${selected ? 'selected' : ''}`} id={`fact-${fact.id}`}><button className="fact-card-main" aria-expanded={selected} onClick={onSelect}><div className="fact-card-top"><span className="fact-label">依据 {String(index + 1).padStart(2, '0')}</span><span className={`fact-supported ${fact.status === 'unverified' ? 'unverified' : ''}`}>{fact.status === 'supported' ? <><Check size={10} />原文支持</> : <><AlertCircle size={10} />待确认</>}</span></div><h3>{fact.statement}</h3><div className="fact-source"><FileText size={11} /><span>{fact.sourceTitle}</span><ChevronDown size={12} className={selected ? 'rotate' : ''} /></div></button>{selected && <div className="fact-detail"><span className="quote-label">支持原文</span><blockquote>{fact.quote}</blockquote>{fact.qualifiers.length > 0 && <div className="fact-qualifiers"><strong>使用限定</strong>{fact.qualifiers.map((q, i) => <p key={i}>{q}</p>)}</div>}<div className="fact-detail-bottom"><span>{fact.sourceMode === 'ima' ? 'ima 原文' : '本地资料'}</span>{url && <a href={url} target="_blank" rel="noopener noreferrer">查看来源<ArrowUpRight size={12} /></a>}</div></div>}</article>;
}

