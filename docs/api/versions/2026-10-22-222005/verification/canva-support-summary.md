# Canva MCP 连接排障支持摘要

供账号本人选择向 Canva 支持提供；项目没有自动发送本文件或工单。本文件只含根代理明确脱敏的协议状态、耗时与追踪号，不含真实 Client ID、Secret、Token/claims、代理 URL、OAuth URL/code/state、用户设计或签名资源。

本轮已修正两处本地缺口：Node 未使用现有系统代理，及旧代码固定 REST-only token endpoint、未做 MCP OAuth 服务发现。公开 discovery 现声明 `https://api.canva.com/auth/v1/oauth/token` 与 S256；专用 Canva 代理传输成功读取服务元数据，完整 discovery 成功（3329ms，凭证请求 0）。这些结果不代表 MCP 已初始化。

北京时间 2026-10-22 22:36:51.898，正式服务明确预检触发一次精确同应用/scopes/resource 的既有 resource-v1 grant 迁移 refresh，使用发现到的 auth/v1 endpoint 成功，随后 REST 预检 200；MCP initialize 仍 500/internal_error。整轮 6210ms，本机 HTTP 502，失败阶段 mcp.initialize，outcomeUnknown=false。本机诊断号 ccbb5365-121a-4973-8b9f-e367b7d20b52（不是 Canva 原生请求号）。整轮有 OAuth refresh 1，不能称为全程纯只读或零凭证操作；没有付费文本/生图或设计 mutation。

北京时间 22:40:55.958，使用官方 SDK 1.32.1、协议 2025-11-25、新 mcp-discovery-v2 access token 内存请求头，以及同一生产 canvaFetch 专用代理，仅一次 POST initialize，仍为 HTTP 500/internal_error。HTTP 1821ms／总 1849ms；没有刷新、重新授权、工具发现或业务工具。安全统计见 [canva-sdk-comparison.json](canva-sdk-comparison.json)。

**Cloudflare CF-Ray：a4e9429d1df8c07b-IAD。** 这是 Cloudflare 边缘追踪号，不是 Canva 原生 request ID。请结合公开 endpoint `https://api.canva.com/connect/v1/mcp`、上述北京时间和错误类别核查；没有原生请求号时不编造。

请 Canva 协助确认：同一开发应用当前 MCP 实际开通状态、发现到的授权端点签发 grant 的 MCP audience/能力，以及为什么新令牌 REST 元数据可读但 MCP initialize 返回 500。项目客户端与官方 SDK 的对照缩小了范围，但仍不能断言全部来自平台、Key/Secret 错误或某个未经证实的内部原因。

本轮未继续循环授权、扩大权限、付费试错或设计导入/编辑/导出。业务源码与摘要已冻结；最终完整离线 279/279、类型检查与生产构建通过，当前真实四渠道 Canva 验收尚未执行。参考 [官方排障](https://www.canva.dev/docs/apps/mcp/troubleshooting/)、[MCP Access](https://www.canva.dev/docs/apps/mcp/access/)。


此处新令牌来自同 grant 的一次 refresh，不是本轮新增账号 OAuth 同意。未解读 Token claims，也不能从 REST200 推断 MCP audience 或应用 grant 能力已生效；仍请 Canva 核查这些应用侧与平台侧因素。
