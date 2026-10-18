import type { RunResult, StreamEvent, TraceEntry } from '../shared/types';
export async function api<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, signal, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.message || `请求失败（${response.status}）`); }
  return response.json() as Promise<T>;
}
export async function generateFromOutline(outlineId: string, version: number, signal: AbortSignal, progress: (entry: TraceEntry) => void): Promise<RunResult> {
  const response = await fetch('/api/generate-from-outline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outlineId, version }), signal });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.message || `正文生成失败（${response.status}）`); }
  if (!response.body) throw new Error('正文流为空。');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let result: RunResult | undefined;
  const frame = (raw: string) => {
    const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    const event = JSON.parse(data) as StreamEvent;
    if (event.type === 'progress' && event.entry) progress(event.entry);
    if (event.type === 'result') result = event.result;
    if (event.type === 'error' || event.type === 'needs_input') throw new Error(event.message || '请补充任务信息。');
  };
  try {
    while (true) {
      const { value, done } = await reader.read(); buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let split: RegExpExecArray | null;
      while ((split = /\r?\n\r?\n/.exec(buffer))) { frame(buffer.slice(0, split.index)); buffer = buffer.slice(split.index + split[0].length); }
      if (done) { if (buffer.trim()) frame(buffer); break; }
    }
    if (!result) throw new Error('连接已结束，但未收到完整正文，请重试。');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
