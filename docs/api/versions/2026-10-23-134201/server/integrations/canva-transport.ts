import { ProxyAgent, type Dispatcher } from 'undici';
import { parseCanvaUrl } from '../../shared/canva-url.js';

export class CanvaTransportError extends Error {
  constructor(readonly code: 'CANVA_PROXY_CONFIG' | 'CANVA_URL') {
    super(code === 'CANVA_PROXY_CONFIG'
      ? 'Canva 专用代理配置无效，请使用本机 HTTP(S) 代理地址。'
      : 'Canva 请求地址不在允许的官方 HTTPS 域名范围内。');
    this.name = 'CanvaTransportError';
  }
}

function configuredProxy(): string | undefined {
  const value = process.env.CANVA_PROXY_URL?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]'
      || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
    if (!['http:', 'https:'].includes(url.protocol) || !loopback || url.username || url.password
      || url.hash || url.search || url.pathname !== '/' || url.port === '0') throw new Error();
    return url.toString();
  } catch { throw new CanvaTransportError('CANVA_PROXY_CONFIG'); }
}

/** Safe status only: proxy URLs and their input values never enter a DTO. */
export function canvaProxyStatus(): { configured: boolean; valid: boolean } {
  try { return { configured: Boolean(configuredProxy()), valid: true }; }
  catch { return { configured: true, valid: false }; }
}

let current: { url: string; agent: ProxyAgent } | undefined;
function dispatcher(url: string | undefined): Dispatcher | undefined {
  if (current?.url === url) return current?.agent;
  const previous = current;
  current = url ? { url, agent: new ProxyAgent({ uri: url }) } : undefined;
  // close waits for in-flight responses rather than aborting a dispatched paid
  // step. A later request reads the latest explicit setting independently.
  if (previous) void previous.agent.close().catch(() => {});
  return current?.agent;
}

/** Explicit Canva-only transport. Never reads global proxy settings or macOS
 * system settings, replaces global dispatchers, or falls back after a failure. */
export async function canvaFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = parseCanvaUrl(input);
  if (!url) throw new CanvaTransportError('CANVA_URL');
  const proxyDispatcher = dispatcher(configuredProxy());
  const options: RequestInit & { dispatcher?: Dispatcher } = {
    ...init,
    // A credential-bearing redirect must be reviewed by the caller. Public
    // metadata/resources can use manual mode and validate every next URL.
    redirect: init?.redirect === 'manual' ? 'manual' : 'error',
    ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}),
  };
  // Keep native fetch so existing offline tests can substitute it. The optional
  // dispatcher belongs to this request only; LLM/image/ima calls are untouched.
  return globalThis.fetch(url, options);
}

/** Shutdown/test cleanup; no requests or token operations are performed. */
export async function closeCanvaTransport(): Promise<void> {
  const previous = current; current = undefined;
  await previous?.agent.close();
}
