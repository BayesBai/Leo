# Canva 预检诊断、MCP 授权目标与分层检查

北京时间：2026-10-22T21:27:20+08:00；版本 `2026-10-22-212720`；上一版 `2026-10-22-205701`。代码基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`。本版业务源码、离线验证与真实只读诊断已完成本地归档。新目标 OAuth 已连接，但 MCP 初始化仍失败，真实设计和四渠道验收未执行。未自动 Git 提交或推送。

**接口有兼容扩展：既有 Canva 预检失败响应新增安全诊断字段，没有新增路由。** OAuth 授权目标和身份绑定收紧，旧令牌需由账号本人重新授权一次；前端继续保留 `message` 的兼容展示。

- `POST /api/integrations/canva/verify` 验证 REST 只读元数据权限、MCP 初始化、所需工具与实时 input schema。Canva 错误返回 `CanvaVerificationError`，含阶段、上游状态、安全服务商代码、请求号（如提供）、本机诊断号、可否主动重试与结果不确定标记。只读预检不导入、编辑、导出或生图。
- MCP 授权、代码交换和刷新均携带 canonical `resource=https://api.canva.com/connect/v1/mcp`；目标、权限、授权版本纳入配置指纹。旧授权与旧 pending 记录不被自动升级/刷新；重新连接由账号本人完成，无需重配 Key 或 Secret。该修正不保证消除上游 500。
- 付费生图真正派发前再次核对 Canva 授权身份与来源有效性；全部预期图片层都需可定位且可编辑。七天历史、三十分钟资源原期限、渠道独立门禁和成功检查点保持。
- 用户确认开发应用 MCP 开关已开启后，21:42:07 的旧授权预检仍返回本机 502、上游 500/internal_error，阶段 `mcp.initialize`，耗时 2185ms，未进入 tools/list。此前 REST GET 200 与旧 OAuth 成功均不能作为新 resource 授权验收。
- 用户完成新目标授权后，后端确认 `connected=true`。北京时间 21:57:50 的新目标只读预检耗时 2416ms，仍返回本机 502/上游 500、internal_error、`mcp.initialize`、`outcomeUnknown=false`，未进入 tools/list。配置与身份只读核对未发现 Client ID 不一致、占位/重复或启动 shell 覆盖证据；未归档实际标识/环境值，不要求循环授权。本轮真实文本/生图、Canva 导入/编辑/导出均为 0。
- 独立官方 `@modelcontextprotocol/sdk@1.32.1` 用协议 `2025-11-25`、现有 Token 内存头，仅一次 initialize 也返回 HTTP 500，HTTP 1211ms／总 1270ms；未进入 tools/list，没有 OAuth/刷新或业务工具请求。SDK 仅数值 code=500，未提取 providerCode。两客户端对照后根因仍未确认，不能把问题全部归于平台或 Key，也不能声称 MCP 已接通。
- 257/257 项完整离线测试通过，失败 0、跳过 0，耗时 73.217 秒；31 项定向和类型检查亦通过。首次全并发并行构建时出现 Chromium 页面加载超时（254/255），相关单文件 6/6 后以测试 worker 并发 2 完整复验通过。该设置仅影响测试，不改变后台业务限额。随后顺序执行 `npm run build`（含 TypeScript 检查）通过，仅保留既有 Vite 大 chunk 提醒。

[完整协议](frontend-handoff.md) · [请求样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [本轮验证记录](verification/acceptance.json) · [Canva 支持摘要](verification/canva-support-summary.md) · [官方 SDK 只读对照](verification/canva-sdk-comparison.json) · [配置指引](docs/setup/visual-integrations.md) · [前版验证](../2026-10-22-205701/README.md)

上一版 244 项测试与 Mock 窄屏截图是历史事实，不算本轮重跑。本版不复制主 `.local-state/`、真实产品资料、授权 URL、Token、原始模型响应或签名资源 URL；真实验收仅保存明确脱敏的统计与结论。源码快照供阅读，不作为独立可运行工程。


前端兼容：路由和成功 DTO 不变，失败仍含 `message`，现有展示继续有效；需要详细排障时可选展示 `code/phase/upstreamStatus/providerCode/requestId/diagnosticId`，不展示原始服务商响应。授权升级会让旧会话显示未连接，按工作台重新授权一次即可。

本版 [manifest.json](manifest.json) 记录全部归档字节及核对源文件的 SHA-256。清单校验和相对链接核对完成后，本目录作为只读历史保留。没有暂存、Git 提交或推送；本地归档不等于远端同步。
