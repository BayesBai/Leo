# ima真实连接与图文取证验收

北京时间：2026-10-23T16:00:01+08:00；版本 `2026-10-23-160001`；上一完整版本 [2026-10-23-155558](../2026-10-23-155558/README.md)。代码基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`，保留既有未提交工作区。

用户已通过隐藏终端脚本录入ima配置。本轮受控程序读取私密配置供请求使用，仅输出布尔状态和计数，不回显或归档凭证。确认文件权限600、两套别名一致、无继承环境冲突；当前后端原先尚未加载，且无待运行任务，故经既有连接设置接口只应用ima配置，HTTP200，再经既有verify接口成功返回HTTP200。最终status为configured=true、verified=true。未重启服务，未改文本/生图配置，未改环境文件。

独立进程通过现行业务模块从ima取得一个型号的10条事实和6张原图。全部事实/图片来源为ima，产品绑定一致，六图字节格式、MIME与实际尺寸验证通过，证据期限校验通过。本地知识库回退已禁用，状态目录、工作目录及媒体与现有服务隔离，验证结束已删除临时私有文件。没有保存原文、图片、句柄、签名URL或私有ID到交接文档；不将字节验证表述为人工外观确认。

**已核对，无接口变更。** 本轮没有业务源码、HTTP路由、请求/响应、SSE或共享类型修改，前端无新增适配。实际范围见[验收记录](verification/acceptance.json)；本轮没有执行模拟测试、类型检查、构建、文案/生图模型、视频、正式部署或Git操作。此前18项ima测试与上一版生图验收均仅作为历史，不能记作本轮测试。

此结果证明本机当时的连接及一个型号读取可用，不代表全部型号、未来配额或云服务器通过。验证状态和证据有三十分钟期限。服务器的秘密注入、出网、身份保护、Host/Origin及渲染运行时仍需部署阶段验收。

[完整交接](frontend-handoff.md) · [ima配置指南](docs/setup/ima-knowledge-base.md) · [检查记录](ima-audit.md) · [HTTP样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [共享类型](shared/types.ts) · [输入](server/schemas.ts) · [前端快照](src/App.tsx) · [实际验收](verification/acceptance.json) · [SHA-256清单](manifest.json)

[原部署规划](deployment-plan.md)继续保留，尚未部署。[生图迁移说明](image-provider-migration.md)与[其历史验收](verification/previous-image-acceptance.json)属于上一轮，本轮没有新生图。历史版本及首次交接原件只读，源码快照供阅读，不是独立可运行工程。没有暂存、提交或推送。
