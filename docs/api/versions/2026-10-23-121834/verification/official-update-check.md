# 官方更新核查记录

检查日期：2026-10-23；归档时间采用 Asia/Shanghai。当前工作区基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`。仅对公开官方文档、两份公开 OAuth 元数据和当前可交接源码做只读核查。

## Canva 的近期变化

| 官方页面 | 本轮确认的信息 | 与当前失败的关系 |
| --- | --- | --- |
| [New Canva MCP tools are here](https://community.canva.dev/t/new-canva-mcp-tools-are-here/8924)（2026-09-28） | `create-design`、`get-create-design-async-job` 用于新的设计生成流程，公告介绍替代此前 `generate-design`；新增 `generate-image`、`remove-background`、`separate-image-layers` | 项目没有调用这些生成工具；当前文档仍并列列出旧新工具，不能声称旧工具已经全面停用 |
| [Canva MCP is generally available](https://community.canva.dev/t/the-wait-list-is-over-canva-mcp-server-is-now-generally-available/8942)（2026-10-07） | 开发者可在 Developer Portal 为应用启用 MCP | 不构成当前应用 MCP 初始化已经通过的证据；搜索摘要中的旧 waitlist/CIMD 描述与 live 页面可能不同，以当前页面和有日期公告区分 |
| [Canva REST API changelog](https://www.canva.dev/docs/apps/rest-apis/changelog/) | 最新列出的 2026-10-19 URL 资产上传 GA、10-01 生图 preview、09-29 设计生成 preview | 属于 REST 能力更新，不是 MCP 初始化端点迁移或 `internal_error` 修复公告 |
| [Quickstart](https://www.canva.dev/docs/apps/quickstart/) 与 [Access](https://www.canva.dev/docs/apps/mcp/access/) | MCP 入口仍为 `https://api.canva.com/connect/v1/mcp`，应用凭证和个人 OAuth 仍适用 | 未发现要求本项目更改 MCP URL 或转用 Miro Canvas 工具的公告 |
| [MCP tools](https://www.canva.dev/docs/apps/mcp/tools/) | 当前文档仍包含项目使用的六个读取、编辑事务和导出工具 | 当前本地实现无需因截图替换为 Miro 工具名；真实调用 schema 仍以当前会话 `tools/list` 为准 |

网页与官方公告研究由根代理及研究代理执行，归档代理只收录明确脱敏的核查结果。未能读取顶级 llms.txt/通用 changelog 的情形不写为通过；具体 live 官方页面和有日期公告已用于核实。官网文档可继续变化，本次不是对所有官方更新的穷尽清单。

## 截图中的 Miro 迁移确实存在，但不属于 Canva

| 官方来源 | 已确认事实 | 时间表述限制 |
| --- | --- | --- |
| [Canvas tools replace layout tools](https://developers.miro.com/changelog/canvas-tools-replace-layout-tools) | `layout_create` 对应 `canvas_create_from_svg`；`layout_read` 对应 `canvas_read_as_svg` | 页面元数据创建日期为 2026-08-12，现正文含后续迁移内容；不把创建日期写成功能精确切换日 |
| [20 legacy MCP board tools to be deprecated](https://developers.miro.com/changelog/20-legacy-mcp-board-tools-to-be-deprecated-migrate-by-sept-14) | 官方要求迁移，当前正文说明 2026-09-14 移除旧工具 | 页面元数据创建于 2026-09-08，不能等同实际移除日 |
| [Legacy MCP board tools have been removed](https://developers.miro.com/changelog/legacy-mcp-board-tools-have-been-removed) 与 [Miro MCP tools](https://developers.miro.com/docs/miro-mcp-tools) | 2026-09-17 创建的公告及当前工具文档确认 legacy board tools 已移除 | 移除行为与截图的 09-14 时间表相符，但产品是 Miro |

Miro、微软 Power Apps Canvas、Canvas LMS 与 Canva 是不同服务。本项目没有接入 Miro，也没有 `layout_create`／`layout_read` 业务调用；不能把 Miro 的命名迁移直接当作 Canva 初始化 500 的原因。

## 当前源码对照

已核对 `server/index.ts`、`server/schemas.ts`、`shared/types.ts`、`server/integrations/canva.ts`、`canva-http.ts`、`canva-oauth.ts`、`canva-transport.ts`、`server/visual-workflow.ts` 及归档内全部 155 份源快照。当前源码与上一版源快照一致。

- MCP URL 和 OAuth protected resource 均为 `https://api.canva.com/connect/v1/mcp`。
- 创作流程通过 Canva REST 二进制 PPTX 导入，然后使用 MCP `get-design-content`、`start-editing-transaction`、`perform-editing-operations`、`commit-editing-transaction`、`cancel-editing-transaction`、`export-design`。
- 每个新 `CanvaMcp` 实例的工具 Map 仅存于内存。流程是 `initialize` → `notifications/initialized` → `tools/list`，没有持久工具目录缓存。
- 项目没有调用 `generate-design`、`create-design`、`get-create-design-async-job`，无需因这次生成工具更新直接改名。
- 既有 500 记录发生在 `initialize`，早于工具发现与文件导入，所以当前没有证据将它归因于旧工具名称。

## 本轮实际公开请求

UTC `2026-10-23T04:18:15.738Z` 开始的两个无凭证 GET：protected-resource 元数据 200／1835ms，authorization-server 元数据 200／1684ms。规范化 resource、issuer、authorize endpoint、`auth/v1/oauth/token`、`client_secret_basic`、S256 指纹与上一轮相同：`e0f7beddf27327a37fcc086b70a97a7040cc847ea53ba3c619ef630efd16fd95`。见 [安全统计](public-discovery.json)。

没有发送授权头、换码或刷新请求，没有 POST MCP，没有重测初始化，也没有设计或付费模型操作。公开发现成功只能证明公开配置仍可读且未改变，不能证明账号授权、MCP 工具发现、设计编辑/导出或整轮流程已修复。上一轮初始化 500 仍为历史事实；本轮没有复测后续状态。

## 验证边界

本轮不改业务源码、环境配置、网关、模型或代理，不重启服务、不删除缓存或循环授权。没有重跑历史 279 项、10 项定向测试或生产构建，不将旧结果记作本轮通过。接口路由、输入约束、DTO、SSE、资源期限与前端适配不变。当前结论为“已核对，无接口变更”。
