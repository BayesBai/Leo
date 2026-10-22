# 前端技能安装与 Figma 调研记录

本页记录本轮用户级工具准备。没有修改项目应用源码或 HTTP/SSE 协议，没有安装项目 npm 依赖，没有安装或连接 Figma 插件。

## 已安装的 11 个技能

安装根目录为 `/Users/maxchen/.codex/skills`。本轮安装成功，下一轮会话可使用；已存在的 Impeccable 字节保持不变。以下提交与许可来自本轮安装步骤的核对记录；不把技能安装视为项目功能实现或应用验收。

| 安装名称 | 上游仓库与固定提交 | 上游路径 | 保留的许可 |
| --- | --- | --- | --- |
| `emil-design-eng` | [emilkowalski/skills](https://github.com/emilkowalski/skills/tree/2d228630ba1446365f614a108cb8252f1feda202) · `2d228630ba1446365f614a108cb8252f1feda202` | `skills/emil-design-eng` | MIT |
| `gsap-core`、`gsap-timeline`、`gsap-scrolltrigger`、`gsap-plugins`、`gsap-utils`、`gsap-react`、`gsap-performance`、`gsap-frameworks`（8 个） | [greensock/gsap-skills](https://github.com/greensock/gsap-skills/tree/aed9cfd3277740755f6bfc1155c7aa645403b760) · `aed9cfd3277740755f6bfc1155c7aa645403b760` | 各技能对应目录 | MIT |
| `transitions-dev` | [Jakubantalik/transitions.dev](https://github.com/Jakubantalik/transitions.dev/tree/7ec0b0b0b8beb15788a9de68a40ec6be2d5e84b5) · `7ec0b0b0b8beb15788a9de68a40ec6be2d5e84b5` | `skills/transitions-dev` | 原始自定义 Transitions.dev License，未改称 MIT |
| `design-taste-frontend` | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill/tree/63aba5f43b5056758b15bbe7d683da8c86a7a7ad) · `63aba5f43b5056758b15bbe7d683da8c86a7a7ad` | `skills/taste-skill`，安装目录改名 | MIT |

安装步骤另已核对：11 个新技能的 `SKILL.md` 存在，frontmatter 名称与安装目录一致；许可证完整保留，MIT 来源的安装目录附上游 `LICENSE`，Transitions.dev 保留自带的 `LICENSE.txt`。每个目录新增 `INSTALL_SOURCE.json` 记录仓库、固定提交、路径与许可；全局安装收据为 `/Users/maxchen/.codex/skills/frontend-design-installation.json`。这只是结构和来源元数据校验，没有执行技能脚本。

这里记录的是技能文件的许可；本轮没有安装 GSAP 等项目运行库，也没有把技能变成项目依赖。技能文件位于用户目录，不复制进源码快照或接口夹具。

## Figma 的用途与本轮边界

Figma 可用于先确定 ORIEL 的品牌、页面布局、组件和视觉稿，再将设计连接到现有 React 前端。它不替代现有产品事实检索、大纲确认、审核与四渠道交付 API。

本轮已发现 Figma 插件可安装，但没有安装、登录或连接，也没有读取用户 Figma 文件、写入画布或建立组件映射。以下为本轮主任务核对官方文档后的结论：

- 官方远程 MCP 支持读取设计上下文及写入画布能力；具体可用工具与授权以连接时实际状态为准。参见[远程服务器接入](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)与[写入画布](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/)。
- 官方桌面本地 MCP 支持读取设计与部分辅助配置操作，不支持写画布或网页 UI 捕获；不能把它与远程服务器的写入能力混为一谈。参见[本地服务器接入](https://developers.figma.com/docs/figma-mcp-server/local-server-installation/)。
- 已核实的官方 Code Connect CLI 用于代码组件与 Figma 设计组件的映射和发布；本轮没有查到通用的官方画布绘制 CLI，不能据此承诺通过 CLI 任意创建或修改画布。参见[Code Connect CLI](https://developers.figma.com/docs/code-connect/cli-reference/)。

本页不记录未核实的套餐、价格或访问额度，也不把“插件可发现”写为“已经连接”。

## 对接口与实际验证的影响

**已核对，无接口变更。** 不新增路由、字段、输入约束、响应、SSE 事件或前端适配要求。原有未提交修改保留；本轮不提交、不推送。

实际验证包括安装步骤中的技能结构与来源元数据校验，以及接口交接阅读、前版清单所列源码的 SHA-256 对比、新归档必需文件、相对链接、历史保留与归档哈希检查；没有运行项目测试、构建、浏览器、模型或 ima。上一版测试及真实运行摘要作为历史材料继承，不计作本轮重验。
