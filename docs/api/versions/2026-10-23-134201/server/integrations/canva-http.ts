/** Minimal Streamable HTTP MCP client. Tool names and input schemas are discovered
 * from Canva on every session; no local generated document is exposed by URL. */
import { randomUUID } from 'node:crypto';
import { canvaFetch, CanvaTransportError } from './canva-transport.js';

export type CanvaPhase = 'oauth.discovery' | 'oauth.exchange' | 'oauth.refresh' | 'oauth.revoke' | 'rest.preflight' | 'rest.import.create' | 'rest.import.poll'
  | 'mcp.initialize' | 'mcp.initialized' | 'mcp.tools-list' | 'mcp.get-design-content' | 'mcp.start-editing-transaction'
  | 'mcp.perform-editing-operations' | 'mcp.commit-editing-transaction' | 'mcp.cancel-editing-transaction' | 'mcp.export-design' | 'mcp.tool-call' | 'export.download';
const TOOL_PHASES: Readonly<Record<string, CanvaPhase>> = { 'get-design-content': 'mcp.get-design-content', 'start-editing-transaction': 'mcp.start-editing-transaction', 'perform-editing-operations': 'mcp.perform-editing-operations', 'commit-editing-transaction': 'mcp.commit-editing-transaction', 'cancel-editing-transaction': 'mcp.cancel-editing-transaction', 'export-design': 'mcp.export-design' };
export function canvaToolPhase(name: string): CanvaPhase { return TOOL_PHASES[name] || 'mcp.tool-call'; }

export class CanvaError extends Error {
  readonly diagnosticId: string;
  readonly retryable: boolean;
  constructor(message: string, readonly code = 'CANVA_PROTOCOL', readonly status = 502,
    readonly outcomeUnknown = false, readonly upstreamStatus?: number, readonly providerCode?: string, readonly phase?: CanvaPhase, diagnosticId?: string, readonly requestId?: string) {
    super(message);
    this.diagnosticId = diagnosticId || randomUUID();
    const readOnlyPhase = phase === 'oauth.discovery' || phase === 'rest.preflight' || phase === 'rest.import.poll' || phase === 'mcp.initialize' || phase === 'mcp.initialized' || phase === 'mcp.tools-list' || phase === 'mcp.get-design-content';
    this.retryable = ['CANVA_IMPORT_PENDING', 'CANVA_EXPORT_PENDING', 'CANVA_NETWORK', 'CANVA_RATE_LIMIT', 'CANVA_OAUTH_UNKNOWN', 'CANVA_AUTH', 'CANVA_NOT_CONNECTED', 'CANVA_NOT_CONFIGURED', 'CANVA_EXPORT_DOWNLOAD', 'CANVA_EXPORT_CACHE'].includes(code)
      || Boolean(readOnlyPhase && code === 'CANVA_PROVIDER' && (upstreamStatus || 0) >= 500);
  }
}
export function atCanvaPhase(error: unknown, phase: CanvaPhase, upstreamStatus?: number, requestId?: string): CanvaError {
  const original = error instanceof CanvaError ? error : new CanvaError('Canva 连接处理失败，请根据诊断号检查。');
  return new CanvaError(original.message, original.code, original.status, original.outcomeUnknown, original.upstreamStatus ?? upstreamStatus, original.providerCode, original.phase || phase, original.diagnosticId, original.requestId || requestId);
}
export function safeCanvaRequestId(headers: Headers, requestSecrets: string[] = []): string | undefined {
  const secrets = [...requestSecrets, process.env.CANVA_CLIENT_SECRET, process.env.IMAGE_API_KEY, process.env.LLM_API_KEY].filter((value): value is string => Boolean(value));
  for (const name of ['x-request-id', 'x-canva-request-id', 'request-id', 'trace-id', 'cf-ray']) {
    const value = headers.get(name)?.trim();
    if (value && /^[A-Za-z0-9_.:-]{1,120}$/.test(value) && !/^(?:sk-|cnvca|eyJ)|bearer|secret|https?:/i.test(value) && !secrets.some(secret => value.includes(secret))) {
      // An edge trace can help Canva support when no application request ID is
      // supplied. Keep its source explicit; it is not a Canva request ID.
      return name === 'cf-ray' ? `cf-ray:${value}` : value;
    }
  }
}
export type JsonObject = Record<string, any>;
export type McpTool = { name: string; inputSchema: JsonObject };
// Current official Quickstart: https://www.canva.dev/docs/apps/quickstart/
const MCP_URL = 'https://api.canva.com/connect/v1/mcp';
const MAX_RESPONSE = 8 * 1024 * 1024;

export async function boundedBytes(response: Response, limit = MAX_RESPONSE): Promise<Buffer> {
  if (!response.body) throw new CanvaError('Canva 返回了空响应。');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const item = await reader.read(); if (item.done) break;
      length += item.value.byteLength;
      if (length > limit) throw new CanvaError('Canva 响应超过大小限制。', 'CANVA_RESPONSE_TOO_LARGE');
      chunks.push(item.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return Buffer.concat(chunks);
}
export function providerFailure(status: number, data?: unknown, uncertain = false): CanvaError {
  const raw = data && typeof data === 'object' ? data as JsonObject : {};
  const rawCode = raw.error?.code ?? raw.code ?? raw.error;
  const candidate = Number.isSafeInteger(rawCode) ? String(rawCode) : rawCode;
  const secrets = [process.env.CANVA_CLIENT_SECRET, process.env.IMAGE_API_KEY, process.env.LLM_API_KEY].filter((value): value is string => Boolean(value));
  const code = typeof candidate === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(candidate)
    && !/^(?:sk-|cnvca|eyJ)|bearer|secret|https?:/i.test(candidate) && !secrets.some(value => candidate.includes(value)) ? candidate : undefined;
  if (status === 401) return new CanvaError('Canva 授权已失效，请重新连接。', 'CANVA_AUTH', 401, false, status, code);
  if (status === 403) return new CanvaError('Canva 权限不足，请检查开发应用的 MCP 开关、授权范围和设计编辑权限。', 'CANVA_PERMISSION', 403, false, status, code);
  if (status === 429) return new CanvaError('Canva 请求过于频繁，请稍后主动重试。', 'CANVA_RATE_LIMIT', 429, false, status, code);
  return new CanvaError(uncertain ? 'Canva 请求结果不确定，请检查已有设计后主动续跑。' : 'Canva 返回业务错误，请根据诊断号检查连接。', 'CANVA_PROVIDER', 502, uncertain, status, code);
}
export function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CanvaError('Canva 返回的数据结构不符合协议。');
  return value as JsonObject;
}
export async function responseJson(response: Response): Promise<JsonObject> {
  const bytes = await boundedBytes(response);
  let data: unknown;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new CanvaError('Canva 未返回有效 JSON。', 'CANVA_PROTOCOL', 502, false, response.status); }
  if (!response.ok) throw providerFailure(response.status, data);
  return jsonObject(data);
}

function schemaValid(value: any, schema: JsonObject): boolean {
  if (schema.anyOf) return schema.anyOf.some((part: JsonObject) => schemaValid(value, part));
  if (schema.oneOf) return schema.oneOf.some((part: JsonObject) => schemaValid(value, part));
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  const types: string[] = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(type => type === 'array' ? Array.isArray(value) : type === 'null' ? value === null
    : type === 'integer' ? Number.isInteger(value) : type === 'object' ? value && typeof value === 'object' && !Array.isArray(value) : typeof value === type)) return false;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ((schema.required || []).some((key: string) => value[key] === undefined)) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !schema.properties?.[key])) return false;
    return Object.entries(value).every(([key, item]) => !schema.properties?.[key] || schemaValid(item, schema.properties[key]));
  }
  return !Array.isArray(value) || !schema.items || value.every(item => schemaValid(item, schema.items));
}

export class CanvaMcp {
  private session?: string;
  private protocol = '2025-03-26';
  private sequence = 0;
  private requestId?: string;
  private tools = new Map<string, McpTool>();
  constructor(private token: () => Promise<string>, private signal?: AbortSignal) {}
  private async rpc(method: string, params: JsonObject, notification = false): Promise<JsonObject> {
    const phase: CanvaPhase = method === 'initialize' ? 'mcp.initialize' : method === 'notifications/initialized' ? 'mcp.initialized' : method === 'tools/list' ? 'mcp.tools-list' : canvaToolPhase(params.name);
    const mutating = method === 'tools/call' && ['perform-editing-operations', 'commit-editing-transaction', 'export-design'].includes(params.name);
    this.requestId = undefined;
    this.signal?.throwIfAborted();
    const id = notification ? undefined : ++this.sequence;
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': this.protocol };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    let dispatched = false;
    let upstreamStatus: number | undefined;
    try {
      const requestSignal = AbortSignal.any([AbortSignal.timeout(120_000), ...(this.signal ? [this.signal] : [])]);
      dispatched = true;
      const response = await canvaFetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }), signal: requestSignal, redirect: 'error' });
      upstreamStatus = response.status;
      this.requestId = safeCanvaRequestId(response.headers, [headers.Authorization.slice(7)]);
      if (response.headers.get('mcp-session-id')) this.session = response.headers.get('mcp-session-id')!;
      if (notification && response.ok) { await response.body?.cancel(); return {}; }
      if (!response.ok) { let data: unknown; try { data = JSON.parse((await boundedBytes(response)).toString('utf8')); } catch { /* no raw upstream body in errors */ } throw providerFailure(response.status, data, mutating && response.status >= 500); }
      let envelope: JsonObject | undefined;
      if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
        if (!response.body) throw new CanvaError('Canva MCP 返回空事件流。');
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let total = 0;
        try {
          while (!envelope) {
            const chunk = await reader.read(); if (chunk.done) break;
            total += chunk.value.byteLength; if (total > MAX_RESPONSE) throw new CanvaError('Canva MCP 事件流超过大小限制。');
            buffer += decoder.decode(chunk.value, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              const raw = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              if (!raw) continue;
              let candidate: JsonObject; try { candidate = JSON.parse(raw); } catch { throw new CanvaError('Canva MCP 事件不是有效 JSON。'); }
              if (candidate.id === id) { envelope = candidate; break; }
            }
          }
        } finally { await reader.cancel().catch(() => {}); }
      } else { const data = await responseJson(response); if (data.id === id) envelope = data; }
      if (!envelope) throw new CanvaError('Canva MCP 未返回对应请求结果。', 'CANVA_PROTOCOL', 502, mutating);
      if (envelope.error) throw providerFailure(200, envelope.error, mutating);
      return jsonObject(envelope.result);
    } catch (error) {
      if (error instanceof CanvaError) throw atCanvaPhase(error, phase, upstreamStatus, this.requestId);
      if (error instanceof CanvaTransportError) throw new CanvaError(error.message, error.code, 422, false, upstreamStatus, undefined, phase);
      throw new CanvaError(mutating ? 'Canva 连接中断或超时；结果不确定，请主动续跑。' : 'Canva 连接中断或超时，请检查连接后重试。', 'CANVA_NETWORK', 502, dispatched && mutating, upstreamStatus, undefined, phase, undefined, this.requestId);
    }
  }
  async connect() {
    const result = await this.rpc('initialize', { protocolVersion: this.protocol, capabilities: {}, clientInfo: { name: 'virgo-local-backend', version: '1.0.0' } });
    if (typeof result.protocolVersion !== 'string') throw new CanvaError('Canva MCP 初始化缺少协议版本。');
    this.protocol = result.protocolVersion;
    await this.rpc('notifications/initialized', {}, true);
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const list = await this.rpc('tools/list', cursor ? { cursor } : {});
      if (!Array.isArray(list.tools)) throw new CanvaError('Canva MCP 工具清单格式异常。');
      for (const tool of list.tools) if (typeof tool.name === 'string' && tool.inputSchema) this.tools.set(tool.name, tool);
      cursor = typeof list.nextCursor === 'string' ? list.nextCursor : undefined;
      if (!cursor) return;
    }
    throw new CanvaError('Canva MCP 工具清单分页超过限制。');
  }
  schema(name: string): JsonObject {
    const tool = this.tools.get(name); if (!tool) throw new CanvaError(`Canva MCP 未开放所需工具：${name}。`, 'CANVA_TOOL_UNAVAILABLE');
    return tool.inputSchema;
  }
  accepts(name: string, values: JsonObject, userIntent: string): boolean {
    const schema = this.schema(name); const args = { ...values };
    if (schema.properties?.user_intent && args.user_intent === undefined) args.user_intent = userIntent;
    return schemaValid(args, schema);
  }
  async call(name: string, values: JsonObject, userIntent: string): Promise<JsonObject> {
    try {
    const schema = this.schema(name); const args = { ...values };
    if (schema.properties?.user_intent && args.user_intent === undefined) args.user_intent = userIntent;
    if (!schemaValid(args, schema)) throw new CanvaError(`Canva 工具 ${name} 的参数与当前发现的协议不匹配。`, 'CANVA_TOOL_SCHEMA');
    const result = await this.rpc('tools/call', { name, arguments: args });
    if (result.isError) throw providerFailure(200, undefined, ['perform-editing-operations', 'commit-editing-transaction', 'export-design'].includes(name));
    if (result.structuredContent) return jsonObject(result.structuredContent);
    for (const block of result.content || []) if (block.type === 'text' && typeof block.text === 'string') {
      try { return jsonObject(JSON.parse(block.text)); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    throw new CanvaError('Canva MCP 工具未返回结构化结果。');
    } catch (error) { throw atCanvaPhase(error, canvaToolPhase(name), undefined, this.requestId); }
  }
}
