/** Bounded, work-conserving scheduling: take one waiter per owner in round-robin order. */
export class FairLimiter {
  private active = 0;
  private queues = new Map<string, Array<{ resolve: (release: () => void) => void; reject: (reason: unknown) => void; signal?: AbortSignal; abort: () => void }>>();
  private owners: string[] = [];
  private lastOwner?: string;
  constructor(readonly limit: number) { if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid concurrency limit'); }
  acquire(owner: string, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, abort: () => {
        const queue = this.queues.get(owner); const index = queue?.indexOf(entry) ?? -1;
        if (index >= 0) queue!.splice(index, 1);
        if (!queue?.length) { this.queues.delete(owner); this.owners = this.owners.filter(key => key !== owner); }
        signal?.removeEventListener('abort', entry.abort); reject(signal?.reason);
      } };
      if (!this.queues.has(owner)) { this.queues.set(owner, []); this.owners.push(owner); }
      this.queues.get(owner)!.push(entry);
      signal?.addEventListener('abort', entry.abort, { once: true });
      if (signal?.aborted) entry.abort();
      this.drain();
    });
  }
  private drain() {
    while (this.active < this.limit && this.owners.length) {
      // A newly queued owner gets a turn ahead of the previous winner's backlog.
      if (this.owners.length > 1 && this.owners[0] === this.lastOwner) this.owners.push(this.owners.shift()!);
      const owner = this.owners.shift()!, queue = this.queues.get(owner)!;
      const entry = queue.shift()!;
      if (queue.length) this.owners.push(owner); else this.queues.delete(owner);
      entry.signal?.removeEventListener('abort', entry.abort);
      if (entry.signal?.aborted) { entry.reject(entry.signal.reason); continue; }
      this.lastOwner = owner; this.active++;
      let released = false;
      entry.resolve(() => { if (released) return; released = true; this.active--; this.drain(); });
    }
  }
}
