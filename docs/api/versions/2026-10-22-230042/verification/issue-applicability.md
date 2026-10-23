# 引用问题与当前 Canva MCP 的适用性

以下由本轮研究代理逐条阅读公开问题并核对项目依赖/流程后整理；归档代理未重新发送公网请求。本表不把其他产品的 500 当作本项目根因，也不排除 Canva 服务端存在同类错误的可能。

| 来源 | 原问题层次 | 当前项目可用结论 |
| --- | --- | --- |
| [Microsoft Power Platform #177](https://github.com/microsoft/power-platform-skills/issues/177) | CanvasAuthoring.McpServer 的 MSAL 缓存不持久，重复 Entra 登录 | 当前用 Canva OAuth 与持久 JSON，不依赖 MSAL，不能套用清缓存补丁；其他 grant 能力仍需核对 |
| [#350](https://github.com/microsoft/power-platform-skills/issues/350)、[#359](https://github.com/microsoft/power-platform-skills/issues/359) | 本地 .NET/dnx 工具缺少 Intel Mac 构建 | 本机 x86_64 与问题背景相似，但当前连接官方远程 HTTPS，未运行该微软二进制 |
| [#94](https://github.com/microsoft/power-platform-skills/issues/94) | compile_canvas 对 .pa.yaml 单文件限制 512KB | 当前尚在 initialize，没有文档上传/编译或设计工具；该具体限制不适用 |
| [Microsoft Learn](https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/create-canvas-external-tools) | Power Apps Canvas Studio 与 YAML 协作开发 | 是微软 Canvas Apps，不是项目实际连接的 Canva，不据此安装 Power Apps 插件 |
| [OpenHands software-agent-sdk #4454](https://github.com/OpenHands/software-agent-sdk/issues/4454) | MCP 连接错误导致宿主 /api/conversations 返回 500 | 当前是上游 api.canva.com 返回 500，本机映射 502，失败层次不同 |
| [OpenHands #16270](https://github.com/OpenHands/OpenHands/issues/16270) | Python browser_use 调用不存在的 Server.list_tools | 项目没有 OpenHands、该 Python 库或该浏览器服务，不适用其依赖修复 |
| [Happy #619](https://github.com/slopus/happy/issues/619) | 本地 stateless StreamableHTTPServerTransport 被复用，后续请求失败 | 当前仅是远程客户端，没有该本地 MCP server；首个 initialize 就失败，不能套用其生命周期补丁 |

[Instructure Canvas LMS OAuth](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth_endpoints) 也是不同产品；项目当前使用 [Canva 官方远程 MCP](https://www.canva.dev/docs/apps/quickstart/)。Canvas/Canva 名称相似不代表协议、限制或服务相同。

源码核对：initialize 成功之后才进入 tools/list；现阶段没有 PPTX/图片上传。前版官方 SDK 探针用已升级现有 grant，未独立新跑完整账号 OAuth。同一 grant 两种客户端都失败，只缩小项目独有请求格式错误的范围，不能据此排除应用侧能力或所有 Canva 远端原因。

本轮研究只读公开资料、源码及上一版安全结果，没有业务代码改动、配置变更、新 OAuth、业务请求或测试重跑。本轮新网络证据另见 [诊断矩阵](diagnostic-matrix.md)。
