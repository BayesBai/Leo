# 前端技能安装与 Figma 调研交接

- 北京时间：2026-10-20T16:30:40+08:00；版本：`2026-10-20-163040`；上一归档：`2026-10-20-123417`。
- 本轮任务：安装前端设计与动效技能，介绍 Figma 官方 MCP/Code Connect 能力，完成接口核对与完整新版本归档。
- 代码基线：`17bd7c9262d584ba21795c0604eb993110a56038`，分支 `frontend/workbench`；已合并后端 `5008332`。沿用原有未提交工作区，不提交或推送。
- 接口结论：**已核对，无接口变更**。本轮没有应用源码、项目依赖或 HTTP/SSE 协议变化；无需前端适配，既有兼容性与运行边界沿用上一版。

## 本轮交付与相对上一版变化

用户级目录 `/Users/maxchen/.codex/skills` 成功新增 11 个技能：Emil Design Engineering、8 个 GSAP 技能、Transitions.dev 与安装名为 `design-taste-frontend` 的 Taste Skill；原有 Impeccable 字节不变。上游固定提交、目录和保留许可见[工具准备记录](frontend-tools-setup.md)。这些技能下一轮可用，没有安装项目 npm 依赖。

介绍 Figma 用于品牌与页面设计、远程 MCP 读写、桌面 MCP 的设计读取与部分辅助配置操作及 Code Connect CLI 组件映射；桌面 MCP 不支持写画布或网页 UI 捕获。Figma 插件已发现可安装，本轮没有安装或连接，没有访问设计文件或写入画布；不记录未核实套餐信息。

完整复制上一版交接与阅读快照作为本版起点，仅更新本版说明、交接页和清单，并增加工具准备记录。原有历史版本及首次交接原件保持只读；所有代码快照仅供阅读，运行请使用项目根目录工程。

## 实际验证与未执行项目

- 安装步骤已确认 11 个技能的 `SKILL.md`、frontmatter 名称、保留许可证及 `INSTALL_SOURCE.json`，并生成用户级安装收据；仅做结构与来源元数据校验，未执行技能脚本。
- 已阅读固定接口入口、上一版交接、说明与清单，并对照 HTTP 路由、输入校验、共享类型、前端流程与 API 入口。
- 上一版 `reviewedSourceFiles` 所列 56 个文件与当前工作区 SHA-256 一致；其中 `server/index.ts`、`server/schemas.ts`、`shared/types.ts`、`src/App.tsx`、`src/WorkflowApp.tsx`、`src/api.ts` 同时与上一版快照逐字节一致。此比较发生在本轮更新固定索引前；新索引的新哈希单独记录。
- 本版必需文件、版本内相对链接、清单覆盖、文件 SHA-256、已核对源文件 SHA-256、旧归档和首次原件保留结果见 [manifest.json](manifest.json)。清单不对自身做循环哈希。
- 未运行 TypeScript 检查、应用测试、构建、浏览器或部署；没有调用真实模型、ima 或原始知识库。未暂存，暂存区一致性留待实际提交前核对；保留 `docs/** -text -filter`。

## 继承材料的使用范围

第 1–15 节协议、110 项测试及既有浏览器/真实模型摘要属于上一版或更早阶段的历史记录，不计为本任务通过结果。`verification/` 中的截图和摘要为继承材料，不能当作技能安装后的新验收；历史模型+本地资料单渠道结果仍为 `needs_attention`，ima 仍未在本轮验收。

[完整交接](frontend-handoff.md) · [工具准备记录](frontend-tools-setup.md) · [请求样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [上一版历史验证摘要](verification/local-checks.json) · [校验清单](manifest.json)
