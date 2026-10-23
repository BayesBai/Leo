# 初始化 500 诊断矩阵（本轮最终证据）

本轮问题只针对当前项目实际使用的 Canva MCP。以下内容不是网络根因结论；前版响应与测试另列为历史，不重复记作本轮运行。

| 问题/假设 | 现有源码证据 | 本轮实际证据 | 可得结论与限制 |
| --- | --- | --- | --- |
| 是否使用 Microsoft Canvas SDK | 当前目标为 Canva 官方 MCP/REST | 研究代理逐条核对 PowerPlatform #177/350/359/94，均为微软 CanvasAuthoring 工具 | 相关 .NET/MSAL/.pa.yaml 限制不适用；见引用适用性表 |
| SDK bug 是否导致 500 | 当前有自制客户端；前轮用官方 SDK 也初始化失败 | 引用 OpenHands/Happy 问题的依赖、宿主层或本地 server 生命周期与本项目不同 | 不能直接套用补丁，也不能排除 Canva 远端同类问题；前版未独立新 OAuth |
| 文件过大是否导致失败 | initialize 在设计导入/文件上传之前 | 本轮同一 initialize JSON 仅 173 字节，不含文件 | 当前这次失败没有由成品文件大小触发的证据；微软 .pa.yaml 的512KB限制不适用 |
| 服务是否整体崩溃 | 本地代码不能证明平台整体状态 | 根代理本轮web读取官方状态：All Systems Operational；Connect API/Canva AI Platform Operational | 只说明无公开大面积事故，不能排除特定MCP/应用故障 |
| 静态出口/v2rayN 分流是否相关 | canvaFetch支持专用代理，不自动继承系统代理 | 同令牌两程序路径均REST200/MCP500；保存配置及OS路由已审计，但实时outbound/远端链未知 | 不能单独归因于静态IP，也未完全排除共同网络因素 |
| OAuth/grant 能力或应用开通 | 当前发现endpoint并绑定metadata/resource；REST200不证明MCP audience | 本轮refresh/新授权0，用同一已有未过期令牌；未独立重跑完整OAuth | 不解析/归档claims，不排除应用侧能力或平台内部原因 |

真实矩阵仅保留时间、匿名路径标签、端点类别、HTTP/阶段/安全代码、耗时和可公开追踪号。不得保存实际代理地址、出口 IP、Token、OAuth code/state、原始输出或签名 URL。只读与凭证旋转应分开计数；结果未知不得重放。


## 本轮公共网络对照（4 次无凭证请求）

| 匿名路径 | AS metadata | PR metadata | 观测到的 Cloudflare POP |
| --- | --- | --- | --- |
| 未显式指定代理 | 302，地区站点跳转（不归档 Location 查询） | 200 | LAX/HKG |
| 明确使用当前本机 HTTP 代理 | 200，正式元数据/端点符合当前发现策略 | 200 | IAD |

以上共 4 次公开元数据读取，凭证请求 0，不含 Token、授权、文件或设计。POP 是 Cloudflare 边缘节点标签，不能当作本机出口 IP 的地理定位；不同 POP 只能说明观测到的处理路径不同，不能独立证明静态 IP 被封或分流错误。

同令牌的低频 REST+initialize 两路径对照已完成，见下表；明确不刷新、不重新授权，不以公开 metadata 成功替代已认证 MCP 初始化。

[引用适用性与来源](issue-applicability.md) · [实际计数/限制](acceptance.json)


## 本轮已认证路径对照（同一现有令牌）

北京时间 23:02:54.737—23:03:00.642，同一持久保存且未过期的 mcp-discovery-v2 Token，标准 initialize JSON 173 字节，没有文件。

| 程序路径标签 | REST 元数据 | MCP initialize | Cloudflare POP |
| --- | --- | --- | --- |
| 无显式代理 | 200／986ms | 500/internal_error／1208ms | 两者 HKG |
| 显式使用现有本机 HTTP 代理 | 200／1726ms | 500/internal_error／1974ms | REST IAD；initialize EWR |

这 4 次是带凭证的只读请求；与上表 4 次公共无凭证 metadata 合计本轮本机直接发往Canva的诊断探针8次，不含本机GET连接状态和web研究读取。refresh、新账号授权、模型、设计请求均 0；没有进入 tools/list 或上传文件。详细脱敏统计见 [authenticated-path-comparison.json](authenticated-path-comparison.json)。

“无显式代理”只表示程序没有给该请求设置代理 dispatcher，不能证明物理路径无 TUN、系统路由或其他网络设备。Cloudflare POP 不是出口 IP/国家，不能据其变化断言节点/IP 漂移。显式代理开关在这组观测中没有改变 initialize 失败结果，因此不能单独归因于该开关或静态出口；仍未排除共同网络路径、应用/grant 能力或 Canva 远端内部原因。

保存配置与运行时的只读核查已完成，具体限制见下节；本归档代理不读取实际配置或凭证。


## 保存配置、系统路由与实时证据边界

保存配置为绕过大陆的 8 条规则，domainStrategy=AsIs；所查 4 个 Canva 域名不匹配保存的域名规则，也不匹配已检查的本地 CN/PRIVATE/GOOGLE 列表，没有发现单独 Canva direct/block 规则。

[Xray 官方路由说明](https://xtls.github.io/config/routing.html)描述顺序首条匹配；没有规则匹配时使用第一个 outbound。AsIs 不主动解析域名以供 IP 路由。[出站说明](https://xtls.github.io/config/outbound.html)也说明未匹配时第一个出站承担默认流量。这里能解释为什么域名未匹配仍可能走默认代理，但实际运行时配置目录为空、JSON 已删除，无法确认当时第一个 outbound 的顺序或实际 tag。

OS 的 IPv4/IPv6 默认路由及抽查 3 个 Xray peer 路由均为 en0，未见本次 TUN 重捕获证据；GUI 保存的 TUN=true 不能证明本次实际生效。访问日志关闭、日志级别 warning，也无法确认远端代理链。不能由保存配置或 POP 差异宣称已经完全排除网络、静态出口信誉或应用/grant/平台因素；现有证据不支持贸然改动全局路由。

[路由核查安全摘要](routing-audit-summary.json)只含规则数量、布尔结果与证据限制，没有代理地址、出口 IP、节点 ID、原始配置或凭证。

本轮源码/接口/配置零修改；10 项 transport/HTTP 离线定向通过，未重跑279项或构建。8次Canva诊断探针完成后未追加同类探针，未刷新/新授权/调用模型或设计，未改节点/TUN/进程。


## 公开状态与远程地址复核

根代理本轮通过web重新读取 [Canva官方状态页](https://www.canvastatus.com/)，页面为 All Systems Operational，Connect API 与 Canva AI Platform 均 Operational。它只说明公开页未报告大面积故障，不保证特定MCP应用、账号/grant或某条路径正常。同期重新读取 [Canva Quickstart](https://www.canva.dev/docs/apps/quickstart/)，官方远程MCP地址仍为 https://api.canva.com/connect/v1/mcp 。这些是公开文档读取，不计入本机8次HTTP探针。
