# Canva 新 Secret 复测与官方 SDK 对照

北京时间：2026-10-22T23:40:15+08:00；版本 `2026-10-22-234015`；上一版 `2026-10-22-233024`。代码基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`。

**已核对，无接口变更。** 本版是同一用户新Secret复测任务的追补归档：233024封存后完成新grant首次官方SDK对照，旧版保持只读。155份源快照与当前/前版一致，无新增前端适配。

- 沿用233024已经发生的事实：用户配置新Secret后空闲重启1次，本人新OAuth和至少一次当前配置换码成功；根connect准备1次，主client唯一verify为502／3347ms、MCP initialize上游500/internal_error。它们不是本版再次执行。浏览器OAuth总请求未逐个统计，REST预检只确认完成，未补写未测得的HTTP200。
- 本版新增对照：北京时间23:38:19.592，官方SDK1.32.1、协议2025-11-25、当前新Secret+本人新OAuth grant的Token内存头、同一生产canvaFetch显式代理，仅一次initialize仍500/internal_error。HTTP1806ms，总1855ms，未进入tools/list；无refresh、新OAuth或业务调用。
- 主client默认协议2025-03-26与SDK2025-11-25的差异未消除500。本次是该本人重新授权产生的新grant的首次SDK对照，不是沿用旧grant探针；仍不能断言根因100%平台，MCP完整设计验收未通过。
- 新SDK Cloudflare CF-Ray为 `a4e996af5ae42a96-IAD`，是边缘追踪号，不是Canva原生request ID。新Secret换码成功不等于MCP应用能力/audience或500已修复。

[完整交接](frontend-handoff.md) · [现行样例](api-examples.http) · [纯Mock](fixtures/frontend.mock.json) · [同任务完整事实](verification/acceptance.json) · [新grant SDK安全统计](verification/new-grant-sdk-comparison.json) · [支持摘要](verification/canva-support-summary.md) · [前版原件](../2026-10-22-233024/README.md)

这次SDK对照后未再发网络、OAuth或付费请求，没有新源码/env/服务重启、测试或构建；旧279/10/CLI验证不计重跑。归档代理不读凭证、不调用接口或公网，不复制原output/session、Secret/Token/PKCE、授权URL或签名资源。根代理独立扫描最终170文件，当前凭证/PKCE精确匹配0，未输出值；已生成manifest并更新固定索引，封存后只读；不暂存、提交或推送。源码快照供阅读，不是独立运行工程。

本轮未核对Canva账号是否变化，“新grant”仅指本人重新授权的产物。 [manifest.json](manifest.json)记录归档字节/核对源文件SHA-256，旧版保持只读。
