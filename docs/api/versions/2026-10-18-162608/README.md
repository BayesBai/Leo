# 启动实例与接口核对

- 北京时间：2026-10-18T16:26:08+08:00；上一版本：2026-10-18-162358。
- 任务：按用户要求启动当前代码的本机生产实例并提供检查入口。
- 代码基线：3d3646fddcec77da767b70fdea0d68cc413b80cb；分支：backend/api-handoff，包含未提交源码，哈希见manifest。
- 接口结论：**已核对，无接口变更**。核对server/index.ts、server/schemas.ts、shared/types.ts及流程/前端/渲染源码，36项源文件哈希与上一版一致。
- 实例：http://127.0.0.1:9755/，由Node/tsx运行生产模式，保留运行供用户检查；原9754已占用，未终止原服务。
- 实际验证：首页与构建脚本200，status/products/task-options/render-templates成功；10个产品、8类场景、8个模板，本地资料可用。模型/ima只读取配置状态，不调用真实服务。
- 兼容性：无新增适配，完整协议继承上一版。请求样例仅将本版预览baseUrl改为9755。
- 未执行：本轮未重跑测试/构建/生成/排版/浏览器视觉验收；此前89项测试和四渠道排版记录保留为历史证据。Codex浏览器打开请求已提交，返回queued，不声称已完成视觉检查。
- 归档校验：历史文件及首次原件SHA-256保持；代码快照与源文件一致；不含配置值或实际产品摘录。仅本地新增，未Git提交或推送。

[完整交接](frontend-handoff.md) · [请求样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [启动核验](preview-verification.json) · [校验清单](manifest.json)

快照仅供阅读，不是独立可运行工程。历史版本全部保留。
