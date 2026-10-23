# Canva MCP 只读连接问题支持摘要

用途：供账号本人核对或提交 Canva 支持时参考。本文件没有自动发送给 Canva，也没有创建工单。省略真实 Client ID、Client Secret、Token、Token claims、OAuth code/state、授权链接、用户设计和签名资源 URL。以下信息不能证明问题完全来自上游，也不能据此认定 Secret 错误。

## 已核对的配置与操作

- 用户确认同一开发应用的 Canva REST APIs 与 Canva MCP 两个开关均已开启；三个设计权限为 `design:content:read`、`design:content:write`、`design:meta:read`。
- 后端已核对实际配置文件的优先级、占位值和重复项；未发现占位/重复问题。本机 Client ID 与用户本轮提供的值一致；启动 shell 没有继承覆盖的 Canva Client ID/Secret，项目 `.env` 不存在，当前没有错误文件或旧进程环境覆盖的证据。只归档这些布尔结论，不写实际标识或环境值。新 OAuth 代码交换成功，后端当前 `configured=true,connected=true`。这只证明本机获得了对应授权记录，不能替代 MCP 或设计流程验证。
- 新版授权 URL、代码交换和刷新均固定传入 `resource=https://api.canva.com/connect/v1/mcp`；该目标、权限和授权版本绑定到会话。用户已针对本次升级重新授权一次，不再要求循环授权。
- REST 元数据只读 GET 返回 HTTP 200；返回的设计列表立即丢弃，不进入本摘要。未经认证的 MCP initialize 对照返回 HTTP 401，并提供与当前 canonical resource 一致的 protected-resource metadata。
- 原生客户端在 `initialize` 阶段失败，尚未进入 `tools/list`，没有调用任何业务工具。

## 公开协议地址

| 用途 | 项目当前使用的公开地址 |
| --- | --- |
| MCP / canonical resource | `https://api.canva.com/connect/v1/mcp` |
| OAuth authorize | `https://www.canva.com/api/oauth/authorize` |
| OAuth token | `https://api.canva.com/rest/v1/oauth/token` |
| REST 只读元数据 | `https://api.canva.com/rest/v1/designs?limit=1` |

实际 Client ID 和授权信息由账号本人通过 Canva 官方安全渠道核对，不放入本归档。

## 只读复现结果

| 阶段 | 北京时间/背景 | 本机 HTTP | 上游 HTTP/代码 | 结果 |
| --- | --- | --- | --- | --- |
| 初次预检 | 原授权，耗时 2237ms | 502 | 后续诊断确认 initialize 500 | REST 与 OAuth 成功不代表 MCP 成功 |
| 用户确认开关后 | 2026-10-22 21:42:07，原授权，2185ms | 502 | 500 / internal_error | 阶段 mcp.initialize，未进入 tools/list |
| 新 canonical resource 授权后 | 2026-10-22 21:57:50.949，2416ms | 502 | 500 / internal_error | 阶段 mcp.initialize，outcomeUnknown=false，未进入 tools/list |
| 独立官方 MCP SDK 对照 | 2026-10-22 22:07:13.403，HTTP 1211ms／总 1270ms | 不经过本机 verify 路由 | HTTP 500；SDK 数值 code=500，未提取 providerCode | initialize 未完成，未到 tools/list |

原授权诊断分别使用协议 `2025-03-26`、`2025-06-18`、`2025-11-25`，均在 initialize 返回 500；不能把错误只归因于单一版本。新版使用 canonical resource 后仍出现相同阶段错误；新版授权未声称已经逐一重跑全部三个版本。

新目标预检的**本机诊断号**：`31d48e1b-52fc-43d1-9fbb-751c914c165c`。该 UUID 用于本项目定位，不是 Canva 官方请求号。没有可公开归档的服务商 request ID 时不编造值。安全服务商代码为 `internal_error`；初次诊断得到的安全错误文字为 `Unknown error occurred`，不回传原始响应体。

## 请 Canva 协助确认

1. 当前开发应用是否已实际开通 REST 与 MCP，是否存在尚未生效的开通状态；本机不自行推断平台内部状态。
2. 项目对当前 portal client 使用的 authorize/token endpoint、canonical resource/audience 是否符合该应用类型的要求。
3. 三个已授权 design scopes 是否足以执行 initialize 和工具发现；如平台有其他必需权限，请提供当前正式文档依据。项目未找到 initialize 要求额外 profile 权限的官方证据，未为了尝试扩大权限再次授权。
4. 对照上述时间和响应类别，是否能确认服务器端 initialize 的具体失败原因，或提供可用于支持定位的请求号。

`outcomeUnknown=false` 只表示失败发生于只读预检，没有设计写入结果待确认；它不表示连接成功。全程本轮付费文本/生图、Canva 导入/设计内容读取/编辑/导出均为 0，尚未执行真实四渠道成品联调。

官方参考：[Canva Quickstart](https://www.canva.dev/docs/apps/quickstart/)、[MCP 接入](https://www.canva.dev/docs/apps/mcp/access/)、[MCP 授权目标规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#resource-parameter-implementation)。该摘要仅整理当前可观察证据，不替代 Canva 服务端诊断。


## 官方 SDK 独立对照与最终边界

使用 `@modelcontextprotocol/sdk@1.32.1`、协议 `2025-11-25`，仅把现有新目标 Access Token 作为内存请求头；没有 authProvider、授权或刷新。只派发一次 POST initialize，HTTP 500（1211ms），总耗时 1270ms；未完成初始化、未进入工具发现、业务工具调用为 0。安全原始统计见 [canva-sdk-comparison.json](canva-sdk-comparison.json)，其中 SDK 数值 code=500 不是已提取的服务商 providerCode，不能补写 internal_error。

独立 SDK 与项目客户端都在初始化阶段失败，具体服务端/应用根因仍未确认。当前新目标 OAuth 已连接，但 Canva MCP 未接通；没有继续循环授权、扩大权限或试付费请求。未执行设计导入、内容读取、真实编辑、导出和四渠道真实成品联调。下一步可由账号本人依据本摘要请 Canva 核对实际开通状态及授权 audience/endpoint；项目未自动发送此摘要或创建工单。
