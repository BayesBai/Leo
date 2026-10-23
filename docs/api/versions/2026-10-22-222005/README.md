# Canva 专用网络、OAuth 发现与连接修复记录

北京时间：2026-10-22T22:20:05+08:00；版本 `2026-10-22-222005`；上一版 `2026-10-22-212720`。代码基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`。本轮实现和验证已冻结；修复本机网络/授权发现缺口后，MCP 初始化仍失败，真实 Canva 成品联调未执行。

**接口为兼容行为变化：无新增路由或 DTO 字段。** connect 增加 OAuth discovery 失败；verify 可能先执行一次受限 grant 升级，再做设计侧只读检查；requestId 增加保留 `cf-ray:` 来源前缀的安全回退。现有 message/成功响应保持兼容，前端适配见完整交接第 9 节。

- Node 不自动使用 macOS 系统代理。新增仅作用于 Canva 的 `CANVA_PROXY_URL` / canvaFetch（固定 undici 7.30.1），拒绝不安全代理/跳转，复用 canva.com/canva.ai 官方域名边界；不改变文本、生图、ima 网络或重做界面。
- 正式 PR/AS metadata discovery 声明 token endpoint 为 `https://api.canva.com/auth/v1/oauth/token` 和 PKCE S256，修正原固定 REST-only endpoint。公开生产 AS 读取 200／1682ms，完整 discovery 成功／3329ms，**仅这部分凭证请求为 0**。
- 北京时间 22:36:51.898，主服务明确执行一次同 grant refresh 迁移并成功，随后 REST 预检 200，但 MCP initialize 仍 500/internal_error；整轮 6210ms，本机 502/outcomeUnknown=false。OAuth refresh 1、模型付费/设计 mutation 0，不能称全程纯只读或零凭证操作。
- 北京时间 22:40:55.958，官方 SDK 1.32.1、协议 2025-11-25、新 mcp-discovery-v2 Token 和生产专用代理，仅一次 initialize 仍 500/internal_error（HTTP 1821ms／总 1849ms），无工具发现/刷新/重新授权/业务调用。Cloudflare CF-Ray 为 `a4e9429d1df8c07b-IAD`，它是边缘追踪号，不是 Canva 原生请求 ID。根因仍未确认，不归结为全部平台或 Key 问题。本轮没有新的账号 OAuth 同意，也未解读 Token claims，REST200 不能证明 MCP audience 生效。
- 实时 schema 的 id/design_id 候选参数与 PNG 格式校验由预检、内容读取、编辑开启和导出共用，未以远端失败重试换参。该能力有离线覆盖，真实工具发现仍未到达。
- 最终离线 **279/279**，失败/取消/跳过均 0，102.798 秒；类型检查和生产构建通过（Vite 1614 模块、9.81 秒），仅既有 Mock 大包提醒。中间 276 项及 10/46 项定向分别记录，不累加为新的总数；前版 257 项不计入本轮。
- 配置脚本仅在临时纯模拟环境验证：7 类非法输入不写文件、合法端口只改代理、空白停用、保留配置、600 与不输出 Key 均通过。主服务空闲重启后 configured/connected=true、活动任务 0，无模型/设计派发；状态不代替 MCP 或成品验收。

[完整协议](frontend-handoff.md) · [样例](api-examples.http) · [纯 Mock](fixtures/frontend.mock.json) · [实际验证](verification/acceptance.json) · [公开发现摘要](verification/oauth-discovery-summary.json) · [新令牌 SDK 对照](verification/canva-sdk-comparison.json) · [Canva 支持摘要](verification/canva-support-summary.md) · [配置指引](docs/setup/visual-integrations.md) · [清单](manifest.json)

未复制原始 output/session/env、主本地状态、私有素材、Token/claims、OAuth 或签名 URL；只归档安全测试/构建日志及明确脱敏统计。前版静态旧 Token SDK500 是历史现象，不能作为已经排除 OAuth 问题的证据。七天历史、三十分钟资源原期限、渠道独立门禁与成功检查点继续保持。

本目录完成 SHA-256 和相对链接核对后作为只读历史保留；源码快照只供阅读，不是独立运行工程。未自动发送支持工单，未暂存、提交或推送。上一版完整原件保留于 [212720](../2026-10-22-212720/README.md)。
