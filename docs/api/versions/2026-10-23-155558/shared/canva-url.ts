/** Canva resource policy, shared by the backend and browser. This is deliberately
 * separate from model gateway configuration and product evidence URL policies. */
export function isCanvaHost(host: string): boolean {
  if (typeof host !== 'string' || host.length > 253) return false;
  const normalized = host.toLowerCase();
  // Empty labels, trailing dots, ports, IP literals and userinfo are not hosts in
  // this policy. Check labels before the suffix to preserve the domain boundary.
  if (!normalized.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
  return ['canva.com', 'canva.ai'].some(domain => normalized === domain || normalized.endsWith(`.${domain}`));
}

export function parseCanvaUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' && !(value instanceof URL)) return undefined;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !isCanvaHost(url.hostname)) return undefined;
    // Queries are required for Canva's short-lived signed resource URLs. They
    // must never be returned in diagnostics or archives by the caller.
    return url;
  } catch { return undefined; }
}

export function isCanvaUrl(value: unknown): boolean { return Boolean(parseCanvaUrl(value)); }
