import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, LoaderCircle, RefreshCw, Unplug } from 'lucide-react';
import type { CanvaConnectionStatus } from '../shared/types';
import { api } from './api';
import { Button } from './virgo/Controls';

interface Props { status?: CanvaConnectionStatus; onStatus?: (status: CanvaConnectionStatus) => void }

export function CanvaConnection({ status, onStatus }: Props) {
  const headingId = useId(); const [current, setCurrent] = useState(status); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const [authorizationUrl, setAuthorizationUrl] = useState(''); const mounted = useRef(true); const callback = useRef(onStatus); callback.current = onStatus;
  const running = useRef(false);
  useEffect(() => { if (status) setCurrent(status); }, [status]);
  useEffect(() => {
    mounted.current = true; const request = new AbortController();
    api<CanvaConnectionStatus>('/api/integrations/canva', 'GET', undefined, request.signal).then(next => { if (!request.signal.aborted) { setCurrent(next); callback.current?.(next); } }).catch(reason => { if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : 'Canva 状态读取失败。'); });
    return () => { mounted.current = false; request.abort(); };
  }, []);
  async function action(name: 'connect' | 'disconnect' | 'refresh') {
    if (running.current) return; running.current = true; setBusy(name); setError('');
    try {
      if (name === 'connect') {
        const next = await api<{ authorizationUrl: string; mock?: boolean }>('/api/integrations/canva/connect', 'POST', {});
        if(next.mock){const simulated=await api<CanvaConnectionStatus>('/api/integrations/canva');if(mounted.current){setCurrent(simulated);callback.current?.(simulated);setAuthorizationUrl('');}return;}
        const url = new URL(next.authorizationUrl);
        if (url.protocol !== 'https:' || !['www.canva.com', 'canva.com'].includes(url.hostname) || url.username || url.password) throw new Error('Canva 授权地址异常，请检查本机服务配置。');
        if (mounted.current) setAuthorizationUrl(url.toString());
      } else {
        const next = await api<CanvaConnectionStatus>(`/api/integrations/canva${name === 'disconnect' ? '/disconnect' : ''}`, name === 'disconnect' ? 'POST' : 'GET', name === 'disconnect' ? {} : undefined);
        if (mounted.current) { setCurrent(next); callback.current?.(next); if (name === 'disconnect' || next.connected) setAuthorizationUrl(''); }
      }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Canva 连接操作未完成。'); }
    finally { running.current = false; if (mounted.current) setBusy(''); }
  }
  return <section className="canva-connection" aria-labelledby={headingId} aria-busy={!!busy}>
    <h3 id={headingId}>Canva 可编辑设计</h3>
    <p className="caption">{current?.message || '正在读取 Canva 连接状态…'}</p>
    {!current?.configured && <p className="caption">先运行项目的本机视觉接入配置命令，填写 Canva 开发应用凭证并在开发者门户启用 MCP。凭证只保留在后端。</p>}
    {current?.redirectUri && !current.connected && <p className="caption">开发应用回调地址：<span style={{ overflowWrap: 'anywhere' }}>{current.redirectUri}</span></p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="row wrap connection-buttons">
      <Button disabled={!!busy || !current?.configured} onClick={() => void action('connect')}>{busy === 'connect' ? <LoaderCircle size={16} aria-hidden="true" /> : <ExternalLink size={16} aria-hidden="true" />}{current?.connected ? '重新授权 Canva' : '连接 Canva'}</Button>
      <Button disabled={!!busy} onClick={() => void action('refresh')}><RefreshCw size={16} aria-hidden="true" />刷新连接状态</Button>
      {current?.connected && <Button disabled={!!busy} onClick={() => void action('disconnect')}><Unplug size={16} aria-hidden="true" />断开本机授权</Button>}
    </div>
    {authorizationUrl && <p className="caption"><a href={authorizationUrl} target="_blank" rel="noreferrer">打开 Canva 完成账号授权<ExternalLink size={14} aria-hidden="true" /></a>，授权完成后返回这里刷新连接状态。</p>}
  </section>;
}
