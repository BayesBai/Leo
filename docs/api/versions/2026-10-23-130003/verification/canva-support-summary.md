# Canva MCP 支持复现摘要 / Support reproduction summary

此文仅供用户人工复制给Canva官方支持，**尚未发送**。没有Client ID、Secret、Token、用户/团队标识、设计内容、授权链接、签名资源或实际代理地址。若支持确需应用标识，由账号本人通过官方私密工单提供。

## 中文摘要

我们在同一开发应用和用户grant下可以刷新OAuth令牌、读取REST设计元数据，官方introspection确认active、当前应用一致、有效时间与三个design scope。但MCP初始化持续返回HTTP500/internal_error：生产Node和独立curl HTTP/2一致，无显式应用代理路径也复现。缺Authorization及合成无效Token则正常返回401。

- MCP URL：`https://api.canva.com/connect/v1/mcp`
- 当前公开发现的issuer：`https://www.canva.com`；token endpoint：`https://api.canva.com/auth/v1/oauth/token`
- OAuth：client_secret_basic、S256 PKCE、resource为上述MCP URL；本轮正常refresh HTTP200并保留连接身份，无新授权码交换。
- 已请求并经introspection确认scope：`design:content:read design:content:write design:meta:read`。
- 生产initialize协议：`2025-03-26`；与JSON同体的curl HTTP/2也失败。2026-07-28标准server/discover另测500；尚未成功协商，未断言Canva必须支持新版。
- 主失败UTC：`2026-10-23T04:50:01.276Z`，HTTP500，1873ms；CF-Ray：`a4ee1e5bbb2124ca-IAD`。
- curl HTTP/2有效Token：HTTP500，1729ms；CF-Ray：`a4ee204aba31ca5f-IAD`；未单独保存开始时间。
- 无显式应用代理initialize UTC：`2026-10-23T04:56:58.590Z`，HTTP500，1309ms；CF-Ray：`a4ee2887ef3829a5-LAX`。
- 无Authorization CF-Ray：`a4ee20354cd63c2f-IAD`，HTTP401；合成无效Token：`a4ee2040bed8202d-IAD`，HTTP401/invalid_token。
- 结构化错误：`{"error":"internal_error","message":"Unknown error occurred"}`。

这些证据将范围集中到有效令牌关联MCP处理路径，但无法仅从客户端区分应用/账号grant映射、MCP功能权限或服务端内部异常。请用上述CF-Ray与UTC时间检查相应日志，确认该应用/用户MCP能力和grant映射是否正确，以及initialize/server-discovery失败的内部原因。Cloudflare CF-Ray是边缘追踪号，不是Canva原生request ID。

用户此前确认开发门户MCP开关开启；本轮GUI打开超时，未再次独立核验。状态页Operational不排除应用特定MCP错误。无显式应用代理不等于已证明物理直连。尚未成功完成initialize或tools/list，没有设计导入、编辑、导出或生图。

## English summary

With the existing developer app and user grant, OAuth refresh returns HTTP 200, REST design metadata returns HTTP 200, and Canva's official introspection reports an active, time-valid token whose documented `client` matches the configured application and whose scopes contain all three requested design permissions. An initial comparison mistakenly used `client_id`; that comparison was discarded and a corrected introspection request confirmed the match.

MCP initialization with that valid refreshed token consistently returns HTTP 500 (`internal_error`, `Unknown error occurred`). This is reproduced by the production Node transport and independent curl over HTTP/2, as well as a request without an explicitly configured application proxy. The no-Authorization and synthetic-invalid-token controls return HTTP 401. We have not established that the latter network route is physically direct.

Please investigate the valid-token MCP request path using the UTC times and Cloudflare CF-Ray values above, specifically the app/user grant mapping, MCP feature or permission enablement, credential-processing internals and initialization errors. We cannot distinguish these server-side branches from the client, nor do we infer a platform-wide outage. The MCP URL is still the official canonical endpoint. No file payload or business tool is involved; the recorded initialize body is 168 bytes. Failure arrives in roughly 1.3–1.9 seconds and does not hit the client's 120-second timeout.

A standards-based `server/discover` diagnostic using the 2026-07-28 MCP specification also returned 500. No protocol was successfully negotiated; this is not a claim that Canva supports or requires that version. A single `tools/list` request without a session was diagnostic only and is not our production workflow. The application still follows initialize → initialized notification → tools/list before business tools. No design creation/edit/export or image generation took place.

## Minimal request shape (placeholders only)

The following is a minimal support reproduction shape, not an exact byte-for-byte copy of the 168-byte recorded request. The credential is deliberately a placeholder. Do not paste real credentials into support messages or public issue trackers. Replace the placeholder only in a local private execution environment if a further explicit test is needed; this archived snippet was not executed as an additional request.

```http
POST /connect/v1/mcp HTTP/1.1
Host: api.canva.com
Authorization: Bearer <ACCESS_TOKEN_REDACTED>
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2025-03-26

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"minimal-canva-diagnostic","version":"1.0.0"}}}
```

Observed valid-token response shape:

```http
HTTP/2 500
Content-Type: application/json

{"error":"internal_error","message":"Unknown error occurred"}
```

Official references: [introspection](https://www.canva.dev/docs/apps/rest-apis/reference/authentication/introspect-access-token/), [Quickstart](https://www.canva.dev/docs/apps/quickstart/), [MCP access](https://www.canva.dev/docs/apps/mcp/access/), [2026-07-28 server/discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [Canva Status](https://www.canvastatus.com/). Local sanitized evidence: [diagnostic matrix](diagnostic-matrix.md), [request summary](mcp-retry-summary.json).
