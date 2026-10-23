import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const HISTORY_TTL = 7 * 24 * 60 * 60_000;
export const runtimeId = randomUUID();
export class StateError extends Error { readonly status = 503; }
type State = { version: 1; buckets: Record<string, Record<string, unknown>> };
/** Synchronous commits serialize all writers in this single-process desktop server. */
export class FileStateStore {
  private state: State;
  private lock: string;
  private closed = false;
  private token = randomUUID();
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    this.lock = path.join(directory, 'writer.lock');
    if (existsSync(this.lock)) {
      let owner: { pid: number };
      try { owner = JSON.parse(readFileSync(this.lock, 'utf8')); } catch { throw new StateError('本地历史锁损坏，请保留文件并检查，未覆盖历史。'); }
      let alive = true;
      try { process.kill(owner.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
      if (alive) throw new StateError('此历史目录已有后端实例使用，请先关闭该实例。');
      unlinkSync(this.lock);
    }
    const fd = openSync(this.lock, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this.token })); } finally { closeSync(fd); }
    try {
      const file = path.join(directory, 'state.v1.json');
      this.state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, buckets: {} };
      if (this.state.version !== 1 || !this.state.buckets || typeof this.state.buckets !== 'object' || Array.isArray(this.state.buckets)
        || Object.values(this.state.buckets).some(b => !b || typeof b !== 'object' || Array.isArray(b))) throw new Error('schema');
    } catch { this.close(); throw new StateError('本地历史文件损坏或版本不支持；已保留原文件，未重置历史。'); }
    process.once('exit', this.onExit);
  }
  private onExit = () => this.close();
  get<T>(bucket: string, id: string): T | undefined { return structuredClone(this.state.buckets[bucket]?.[id]) as T | undefined; }
  entries<T>(bucket: string): [string, T][] { return Object.entries(structuredClone(this.state.buckets[bucket] || {})) as [string, T][]; }
  update(change: (buckets: State['buckets']) => void) {
    if (this.closed) throw new StateError('本地历史存储已关闭。');
    const next = structuredClone(this.state); change(next.buckets);
    const file = path.join(this.directory, 'state.v1.json'); const temp = path.join(this.directory, `.${randomUUID()}.tmp`);
    try {
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, file); this.state = next;
    } catch { try { unlinkSync(temp); } catch { /* preserve the previous committed file */ } throw new StateError('本地历史保存失败；上次成功保存的记录仍保留。'); }
  }
  set<T>(bucket: string, id: string, value: T) { this.update(b => { (b[bucket] ||= {})[id] = value; }); }
  remove(bucket: string, id: string) { this.update(b => { delete b[bucket]?.[id]; }); }
  close() {
    if (this.closed) return; this.closed = true;
    process.removeListener('exit', this.onExit);
    try { if (JSON.parse(readFileSync(this.lock, 'utf8')).token === this.token) unlinkSync(this.lock); } catch { /* never remove another writer's lock */ }
  }
}
let singleton: FileStateStore | undefined;
export function stateDirectory() { return path.resolve(process.env.AGENT_STATE_DIR || '.local-state'); }
export function stateStore() { return singleton ||= new FileStateStore(stateDirectory()); }
export function closeStateStore() { singleton?.close(); singleton = undefined; }
export function markOperation(id: string, kind: string) { const token = randomUUID(); stateStore().set('operations', token, { id, kind, runtimeId }); return token; }
export function finishOperation(token: string) {
  const op = stateStore().get<{ id: string }>('operations', token);
  if (op) stateStore().update(b => { delete b.operations?.[token]; for (const [key, value] of Object.entries(b.operations || {})) { const other = value as { id: string; runtimeId: string }; if (other.id === op.id && other.runtimeId !== runtimeId) delete b.operations[key]; } });
}
export function wasInterrupted(id: string) { return stateStore().entries<{ id: string; runtimeId: string }>('operations').some(([, op]) => op.id === id && op.runtimeId !== runtimeId); }
