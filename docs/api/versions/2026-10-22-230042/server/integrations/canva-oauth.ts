/** OAuth discovery for Canva MCP, independent from Canva's REST-only token API.
 * MCP: protected-resource metadata -> authorization-server metadata -> endpoints.
 * https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
 * No credentials are sent during discovery and no redirect is followed. */
import { createHash } from 'node:crypto';
import { atCanvaPhase, boundedBytes, CanvaError, jsonObject, providerFailure, safeCanvaRequestId, type JsonObject } from './canva-http.js';
import { canvaFetch, CanvaTransportError } from './canva-transport.js';

export const CANVA_MCP_RESOURCE = 'https://api.canva.com/connect/v1/mcp';
export const CANVA_OAUTH_ISSUER = 'https://www.canva.com';
export const CANVA_MCP_SCOPES = 'design:content:read design:content:write design:meta:read';
export const CANVA_OAUTH_VERSION = 'mcp-discovery-v2';
const RESOURCE_METADATA = 'https://api.canva.com/.well-known/oauth-protected-resource/connect/v1/mcp';
const MAX_METADATA = 128 * 1024;

export interface CanvaOAuthMetadata {
  resource: string; issuer: string; authorizationEndpoint: string; tokenEndpoint: string;
  revocationEndpoint?: string; tokenAuthMethod: 'client_secret_basic'; pkceMethod: 'S256';
  fingerprint: string;
}
function discoveryError(message = 'Canva OAuth 元数据与 MCP 授权目标不匹配，请检查官方授权服务连接。', code = 'CANVA_OAUTH_METADATA'): CanvaError {
  return new CanvaError(message, code, 502, false, undefined, undefined, 'oauth.discovery');
}
function endpoint(value: unknown, host: 'www.canva.com' | 'api.canva.com'): string {
  if (typeof value !== 'string') throw discoveryError();
  let url: URL; try { url = new URL(value); } catch { throw discoveryError(); }
  if (url.protocol !== 'https:' || url.hostname !== host || url.port && url.port !== '443' || url.username || url.password || url.hash || url.search || url.pathname === '/') throw discoveryError();
  return url.toString();
}
function payload(value: Omit<CanvaOAuthMetadata, 'fingerprint'>) {
  return JSON.stringify({ resource: value.resource, issuer: value.issuer, authorizationEndpoint: value.authorizationEndpoint,
    tokenEndpoint: value.tokenEndpoint, revocationEndpoint: value.revocationEndpoint || null, tokenAuthMethod: value.tokenAuthMethod, pkceMethod: value.pkceMethod });
}
function fingerprint(value: Omit<CanvaOAuthMetadata, 'fingerprint'>) { return createHash('sha256').update(payload(value)).digest('hex'); }
/** Revalidate persisted metadata before attaching client secrets or refresh tokens. */
export function validateCanvaOAuthMetadata(value: unknown): CanvaOAuthMetadata {
  const data = jsonObject(value);
  if (data.resource !== CANVA_MCP_RESOURCE || data.issuer !== CANVA_OAUTH_ISSUER || data.tokenAuthMethod !== 'client_secret_basic' || data.pkceMethod !== 'S256') throw discoveryError();
  const result: Omit<CanvaOAuthMetadata, 'fingerprint'> = { resource: CANVA_MCP_RESOURCE, issuer: CANVA_OAUTH_ISSUER,
    authorizationEndpoint: endpoint(data.authorizationEndpoint, 'www.canva.com'), tokenEndpoint: endpoint(data.tokenEndpoint, 'api.canva.com'),
    tokenAuthMethod: 'client_secret_basic', pkceMethod: 'S256',
    ...(data.revocationEndpoint === undefined ? {} : { revocationEndpoint: endpoint(data.revocationEndpoint, 'api.canva.com') }) };
  if (data.fingerprint !== fingerprint(result)) throw discoveryError('Canva OAuth 元数据校验不一致，已停止凭证发送。');
  return { ...result, fingerprint: data.fingerprint };
}
async function metadataGet(url: string, signal?: AbortSignal): Promise<{ status: number; data?: JsonObject }> {
  let response: Response | undefined;
  try {
    response = await canvaFetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]), redirect: 'manual' });
    // In particular, never follow www.canva.com -> canva.cn and never inspect or
    // expose a Location header, which can contain provider-specific parameters.
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new CanvaError('Canva OAuth 元数据发生跳转，已停止；请检查官方服务的网络访问路径。', 'CANVA_OAUTH_DISCOVERY_REDIRECT', 502, false, response.status, undefined, 'oauth.discovery', undefined, safeCanvaRequestId(response.headers));
    }
    if ([404, 405].includes(response.status)) { await response.body?.cancel(); return { status: response.status }; }
    const contentType = response.headers.get('content-type') || '';
    if (!/(?:application\/json|application\/[\w.-]+\+json)(?:\s*;|$)/i.test(contentType)) { await response.body?.cancel(); throw discoveryError('Canva OAuth 元数据未返回 JSON，已停止凭证发送。'); }
    const bytes = await boundedBytes(response, MAX_METADATA);
    let raw: unknown; try { raw = JSON.parse(bytes.toString('utf8')); } catch { throw discoveryError('Canva OAuth 元数据 JSON 无效，已停止凭证发送。'); }
    if (!response.ok) throw providerFailure(response.status, raw);
    return { status: response.status, data: jsonObject(raw) };
  } catch (error) {
    if (error instanceof CanvaError) throw atCanvaPhase(error, 'oauth.discovery', response?.status, response ? safeCanvaRequestId(response.headers) : undefined);
    if (error instanceof CanvaTransportError) throw new CanvaError(error.message, error.code, 422, false, undefined, undefined, 'oauth.discovery');
    throw new CanvaError('Canva OAuth 元数据只读连接失败，请检查网络后重试；尚未发送授权凭证。', 'CANVA_OAUTH_DISCOVERY', 502, false, response?.status, undefined, 'oauth.discovery');
  }
}
export async function discoverCanvaOAuth(signal?: AbortSignal): Promise<CanvaOAuthMetadata> {
  const resource = (await metadataGet(RESOURCE_METADATA, signal)).data;
  if (!resource || resource.resource !== CANVA_MCP_RESOURCE || !Array.isArray(resource.authorization_servers) || !resource.authorization_servers.includes(CANVA_OAUTH_ISSUER)) throw discoveryError();
  if (resource.bearer_methods_supported !== undefined && (!Array.isArray(resource.bearer_methods_supported) || !resource.bearer_methods_supported.includes('header'))) throw discoveryError();
  if (resource.scopes_supported !== undefined && (!Array.isArray(resource.scopes_supported) || CANVA_MCP_SCOPES.split(' ').some(scope => !resource.scopes_supported.includes(scope)))) throw discoveryError('Canva MCP 保护资源未声明当前需要的设计权限，已停止授权。');
  // RFC 8414 takes priority; OIDC is the standardized fallback only when the
  // first endpoint is absent. A redirect, bad issuer or malformed response fails.
  let server = await metadataGet(`${CANVA_OAUTH_ISSUER}/.well-known/oauth-authorization-server`, signal);
  if (!server.data) server = await metadataGet(`${CANVA_OAUTH_ISSUER}/.well-known/openid-configuration`, signal);
  const data = server.data;
  if (!data || data.issuer !== CANVA_OAUTH_ISSUER || !Array.isArray(data.code_challenge_methods_supported) || !data.code_challenge_methods_supported.includes('S256')) throw discoveryError('Canva OAuth 服务身份或 S256 PKCE 声明不符合 MCP 要求，已停止授权。');
  if (data.token_endpoint_auth_methods_supported !== undefined && (!Array.isArray(data.token_endpoint_auth_methods_supported) || !data.token_endpoint_auth_methods_supported.includes('client_secret_basic'))) throw discoveryError();
  if (data.response_types_supported !== undefined && (!Array.isArray(data.response_types_supported) || !data.response_types_supported.includes('code'))) throw discoveryError();
  if (data.grant_types_supported !== undefined && (!Array.isArray(data.grant_types_supported) || ['authorization_code', 'refresh_token'].some(grant => !data.grant_types_supported.includes(grant)))) throw discoveryError();
  const discovered: Omit<CanvaOAuthMetadata, 'fingerprint'> = { resource: CANVA_MCP_RESOURCE, issuer: CANVA_OAUTH_ISSUER,
    authorizationEndpoint: endpoint(data.authorization_endpoint, 'www.canva.com'), tokenEndpoint: endpoint(data.token_endpoint, 'api.canva.com'),
    tokenAuthMethod: 'client_secret_basic', pkceMethod: 'S256',
    ...(data.revocation_endpoint === undefined ? {} : { revocationEndpoint: endpoint(data.revocation_endpoint, 'api.canva.com') }) };
  return { ...discovered, fingerprint: fingerprint(discovered) };
}
