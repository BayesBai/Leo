# 商城接口研究任务归档

- 北京时间：2026-10-18T15:49:04+08:00；上一版本：2026-10-18-153034。
- 任务：查询商城信息读取 API，保留实测结果与接入建议。
- Git 基线：`bd179010c1175eb362cdecf990e804f6805211e1`；分支：`backend/api-handoff`。归档含已有未提交工作区变化，以源文件哈希为准。
- 本次研究操作：已核对，无接口变更，未添加 Vmall 路由、适配器、依赖或来源枚举。
- 相对上一归档：工作区已新增任务选项、配置设置、连接测试、大纲和成品渲染路由，共享类型与校验也已变化。本版补齐文档与模拟结构，不将这些变化归为本次研究实现。
- 前端适配：商城研究无需适配；当前已有的新流程需按大纲版本、正文版本与下载协议接入，旧直接生成入口保留。

## 交付内容

[商城接口研究](vmall-information-api-research.md) · [公开请求观察记录](fixtures/vmall-public-api-observations.json) · [完整接口说明](frontend-handoff.md) · [请求样例](api-examples.http) · [模拟数据](fixtures/frontend.mock.json)

项目研究入口：[docs/research/vmall-information-api-research.md](../../../research/vmall-information-api-research.md)。本版继承完整交接资料，刷新三份必需代码快照，并为旧设计资料增加实现状态说明。历史版本与首次原件保留原字节。

## 核查与验证

核对路由、输入校验、共享类型及生成、大纲、配置、选项、渲染、前端请求代码。相对上一归档变化的源文件：server/index.ts, server/schemas.ts, shared/types.ts, server/pipeline.ts, server/prompts.ts, server/outlines.ts, server/connections.ts, server/task-options.ts, server/render/index.ts, src/App.tsx, src/api.ts, src/RenderPanel.tsx, package.json, package-lock.json。目录时间为资料版本，不是 API URL 版本。

商城商品展示匿名返回 success=true、code=0、11 个 SKU；旧商品返回 50004；参数请求返回 10100。未把 HTTP 200 一律当作业务成功，记录不含完整商品响应、账号或凭证。

执行必需文件、相对链接、历史与原件哈希、代码快照和模拟输入结构核验；manifest 的 checks 记录实际结果。没有执行工作台端到端、模型或 ima 调用、渲染或平台发布，源码存在不等于运行验收通过。

归档仅本地保存，未 Git 提交或推送。完成后目录只读。
