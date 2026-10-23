# Canva MCP 复测诊断矩阵

结论：当前有效授权刷新后，Canva MCP仍未跑通。证据把范围收敛到有效令牌关联的MCP入口处理路径，但尚不能区分应用/账号grant与能力映射、服务端凭证校验内部或MCP初始化内部错误。不是平台全站故障结论。

## 实际请求

以下UTC时间和耗时来自根代理脱敏统计；没有记录的时间/协议不自行补值。CF-Ray是Cloudflare边缘追踪号，非Canva原生request ID；POP后缀不证明出口IP或国家。

| 诊断 | UTC开始 | HTTP | 耗时ms | 已记录协议 | 错误码 | CF-Ray |
| --- | --- | --- | --- | --- | --- | --- |
| 公共OAuth发现 | 2026-10-23T04:49:56.973Z | 200 | 1709 | — | — | `a4ee1e40cb17c488-IAD` |
| 公共OAuth发现 | 2026-10-23T04:49:58.698Z | 200 | 1672 | — | — | `a4ee1e4b6c375774-IAD` |
| 授权grant正常refresh | 2026-10-23T04:50:00.408Z | 200 | 473 | — | — | `a4ee1e4d4c6dc488-IAD` |
| REST设计元数据 | 2026-10-23T04:50:00.912Z | 200 | 361 | — | — | `a4ee1e507b46c488-IAD` |
| 生产Node initialize | 2026-10-23T04:50:01.276Z | 500 | 1873 | 2025-03-26 | internal_error | `a4ee1e5bbb2124ca-IAD` |
| curl无Authorization阴性对照 | 未单独记录 | 401 | 4361 | — | — | `a4ee20354cd63c2f-IAD` |
| curl合成无效Token阴性对照 | 未单独记录 | 401 | 1728 | — | invalid_token | `a4ee2040bed8202d-IAD` |
| curl HTTP/2有效Token | 未单独记录 | 500 | 1729 | — | internal_error | `a4ee204aba31ca5f-IAD` |
| introspection初次读取 | 2026-10-23T04:53:22.930Z | 200 | 1777 | — | — | `a4ee2347be7b2552-IAD` |
| 2026-07-28 server/discover | 2026-10-23T04:53:24.713Z | 500 | 397 | — | internal_error | `a4ee234a3da42552-IAD` |
| introspection按client字段重查 | 2026-10-23T04:55:25.547Z | 200 | 1711 | — | — | `a4ee26461a2ab098-IAD` |
| 无显式应用代理initialize | 2026-10-23T04:56:58.590Z | 500 | 1309 | — | internal_error | `a4ee2887ef3829a5-LAX` |
| 无session tools/list诊断 | 2026-10-23T04:58:12.848Z | 500 | 1889 | 2025-11-25 | internal_error | `a4ee2a5c6decf36e-IAD` |

另有2次无凭证公共metadata GET均200，公开端点未变；其逐次时间/耗时未在汇总记录，故不补造。总计15次直发Canva诊断HTTP，上表13次加这2次。生产函数verify的6189ms是包含前5次发现/refresh/REST/initialize的总耗时，不能再加作第16个远端请求；本机GET状态/jobs和公开网页浏览不属于这15次。

## 排除与保留

| 假设 | 本轮证据 | 可得结论与限制 |
| --- | --- | --- |
| 当前Access Token过期/无效、Secret不能刷新 | 正常refresh HTTP200；introspection active、时间有效 | 当前刷新成功的grant有效，不能由旧Token过期解释后续稳定500；不证明MCP能力已开通 |
| Token属于不同应用或缺少请求的scope | 第二次官方introspection按client字段确认应用匹配，三个design scope齐全 | 排除本次被测Token的明显应用不匹配/缺少这三个scope；第一次client_id比较作废 |
| 通用endpoint不可达 | 无Authorization/合成无效Token均401；有效Token500，REST200 | HTTP/TLS及至少鉴权拒绝分支工作；仍可能有效凭证路径内部报错 |
| Node SDK或HTTP/1实现专属错误 | 同样JSON主体，生产Node与curl HTTP/2均500；此前官方SDK也失败 | 当前问题不是仅生产Node实现的症状；历史SDK结果不算本轮再跑 |
| 显式代理是唯一成因 | 当前显式代理和无显式应用代理都500 | 简单去掉该应用代理未解决；无显式代理不保证物理直连，不能彻底排除网络影响 |
| 文件过大/图层/旧工具名 | initialize主体168字节，无文件；未到业务工具 | 当前初始化500与已上传文件大小、设计图层或旧生成工具名无直接证据关系 |
| 本机请求超时过短 | 有效Token initialize约1.3–1.9秒即500 | 未触发本机120秒上限；延长等待不是此响应的直接修复 |
| Canva要求新MCP协议 | 标准2026-07-28 server/discover也500，没有协商结果 | 不能证明Canva支持/要求此版本；生产协议未盲目更换 |
| 工具列表可绕过初始化 | 无session单独tools/list返回500 | 仅诊断探针，未进入有效会话；不作为生产跳过初始化依据 |
| MCP开关仍未开启 | 用户此前确认开启，本轮门户GUI打开超时 | 本轮没有独立看到当前开关；应用MCP能力映射仍是待官方确认点 |
| Canva全站事故 | 官方状态页显示Operational | 状态页不能排除单应用、单账号或MCP专属问题；也不能据此宣称服务正常 |

本机JWT解码未验签，仅作辅助，不归档Token或claims原文；aud为Canva API根资源不被当作与MCP canonical URL不等就必错的依据。官方introspection结论优先于本机未验签解码。

## 当前可交接复现

生产函数异常为CANVA_PROVIDER、phase=mcp.initialize、upstreamStatus=500、providerCode=internal_error、diagnosticId=dbe65038-f5aa-4030-b009-a18871c2dea3。error.status=502只是本机异常映射值；本轮通过函数直接调用，并未测得verify HTTP路由返回502。retryable=true允许用户主动再试，outcomeUnknown=false表示没有设计修改结果待确认，不等于成功。

可提供[中英文支持摘要](canva-support-summary.md)中的UTC时间和CF-Ray，请Canva定位该应用/用户grant对应的后端日志，确认权限/功能标记、应用MCP能力和初始化内部错误。摘要未自动发送；不附Token、Secret、Client ID值、用户设计列表或私有素材。

## 官方参考与适用范围

- [Canva token introspection](https://www.canva.dev/docs/apps/rest-apis/reference/authentication/introspect-access-token/)：核对active、client、scope和时间；本轮按该字段纠正第一次比较。
- [Canva Quickstart](https://www.canva.dev/docs/apps/quickstart/) 与 [MCP access](https://www.canva.dev/docs/apps/mcp/access/)：官方endpoint及应用/用户授权要求。
- [MCP 2026-07-28 server/discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)、[Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)、[versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)：本轮最新标准探针的依据；不代表Canva已实现这个版本。
- [Canva MCP troubleshooting](https://www.canva.dev/docs/apps/mcp/troubleshooting/)：域名与长任务超时说明；当前即时initialize500不等于长任务超时。
- [Canva Status](https://www.canvastatus.com/)：本轮所见全系统Operational及10月22/23无事件，不是单独MCP应用路径健康证明。

无业务源码/env改动，无新账号授权、模型/生图或设计修改；正常refresh已落盘，服务启动一次。旧离线测试与build未重跑。完整安全计数见[mcp-retry-summary.json](mcp-retry-summary.json)。
