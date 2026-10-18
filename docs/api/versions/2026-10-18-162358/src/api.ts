import { PLATFORMS, type RunResult, type TraceEntry } from '../shared/types';

const MAX_FRAME_CHARS = 2 * 1024 * 1024;
const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

function validTrace(value: unknown): value is TraceEntry {
  return record(value) && ['step', 'label', 'detail', 'at'].every(key => typeof value[key] === 'string')
    && ['running', 'done', 'error'].includes(String(value.status));
}

function validResult(value: unknown): value is RunResult {
  if (!record(value) || typeof value.id !== 'string' || !Number.isInteger(value.revision) || Number(value.revision) < 1
    || typeof value.createdAt !== 'string' || typeof value.notice !== 'string'
    || !record(value.brief) || !record(value.product) || !record(value.evidence) || !record(value.review)
    || !Array.isArray(value.drafts) || !value.drafts.length || !Array.isArray(value.strategies) || !Array.isArray(value.trace)) return false;
  const { brief, product, evidence, review } = value;
  return ['scene', 'audience', 'goal', 'mode', 'knowledgeSource'].every(key => typeof brief[key] === 'string')
    && typeof product.name === 'string' && record(value.outline)
    && Array.isArray(evidence.facts) && evidence.facts.every(f => record(f) && typeof f.id === 'string' && typeof f.statement === 'string' && strings(f.qualifiers))
    && Array.isArray(evidence.images) && evidence.images.every(i => record(i) && typeof i.id === 'string' && typeof i.url === 'string')
    && Array.isArray(evidence.sources) && evidence.sources.every(s => record(s) && typeof s.id === 'string' && typeof s.title === 'string')
    && ['passed', 'needs_attention', 'blocked'].includes(String(review.status)) && Array.isArray(review.issues) && Array.isArray(review.checks)
    && value.drafts.every(d => record(d) && typeof d.id === 'string' && PLATFORMS.includes(d.platform as typeof PLATFORMS[number])
      && strings(d.titles) && d.titles.length > 0 && typeof d.intro === 'string' && typeof d.cta === 'string' && strings(d.tags)
      && Array.isArray(d.blocks) && d.blocks.every(b => record(b) && typeof b.id === 'string' && typeof b.heading === 'string' && typeof b.text === 'string' && strings(b.factIds))
      && Array.isArray(d.images) && d.images.every(i => record(i) && typeof i.imageId === 'string' && Number.isInteger(i.afterBlock)));
}
export async function api<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, signal, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.message || `请求失败（${response.status}）`); }
  return response.json() as Promise<T>;
}
export async function generateFromOutline(outlineId: string, version: number, signal: AbortSignal, progress: (entry: TraceEntry) => void): Promise<RunResult> {
  const response = await fetch('/api/generate-from-outline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outlineId, version }), signal });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.message || `正文生成失败（${response.status}）`); }
  if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream') throw new Error('服务器未返回正文事件流，请检查连接后重试。');
  if (!response.body) throw new Error('正文流为空。');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let receivedBytes = 0;
  const frame = (raw: string): RunResult | undefined => {
    if (raw.length > MAX_FRAME_CHARS) throw new Error('正文事件超过接收上限，请精简任务后重试。');
    const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    let event: unknown;
    try { event = JSON.parse(data); } catch { throw new Error('正文事件格式无效，请重试。'); }
    if (!record(event)) throw new Error('正文事件格式无效，请重试。');
    if (event.type === 'progress') {
      if (!validTrace(event.entry)) throw new Error('生成进度格式无效，请重试。');
      progress(event.entry);
    }
    if (event.type === 'result') {
      if (!validResult(event.result)) throw new Error('正文结果不完整，请重试。');
      if (event.result.outline?.id !== outlineId || event.result.outline.version !== version) throw new Error('正文与确认的大纲版本不一致，请重新生成。');
      return event.result;
    }
    if (event.type === 'error' || event.type === 'needs_input') throw new Error(typeof event.message === 'string' && event.message ? event.message : '请补充任务信息。');
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read(); signal.throwIfAborted();
      receivedBytes += value?.byteLength || 0;
      if (receivedBytes > MAX_STREAM_BYTES) throw new Error('正文流超过接收上限，请精简任务后重试。');
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let split: RegExpExecArray | null;
      while ((split = /\r?\n\r?\n/.exec(buffer))) {
        const result = frame(buffer.slice(0, split.index)); buffer = buffer.slice(split.index + split[0].length);
        signal.throwIfAborted(); if (result) return result;
      }
      if (buffer.length > MAX_FRAME_CHARS) throw new Error('正文事件超过接收上限，请精简任务后重试。');
      if (done) { if (buffer.trim()) { const result = frame(buffer); signal.throwIfAborted(); if (result) return result; } break; }
    }
    throw new Error('连接已结束，但未收到完整正文，请重试。');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
