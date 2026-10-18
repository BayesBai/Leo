# 自有模型API配置说明核对

- 北京时间：2026-10-18T16:36:16+08:00；上一版本：2026-10-18-163328。
- 任务：解释是否只改一个环境变量即可切换自有API，补全协议、地址、模型、密钥与重启条件。
- 代码基线：8574709cb9fd8faf0d022c1b80484138e11f02d5；分支：backend/api-handoff。
- 接口结论：**已核对，无接口变更**。新增配置指南，协议、类型、校验、SSE与错误行为保持，前端无需适配。
- 实际验证：只读检查server/model.ts、server/connections.ts、server/index.ts、server/schemas.ts、shared/types.ts、src/WorkflowApp.tsx及.env.example；核对源文件/快照SHA-256、历史原件保护与相对链接。
- 未执行：没有修改.env.local或当前内存配置，没有重启实例，没有调用模型/ima、运行测试/构建；新服务兼容性尚未验证。
- 新版本保留完整交接、样例、Mock、代码快照及之前研究。源码快照仅供阅读，不是独立工程。未写入凭证或真实资料，未Git提交或推送。

[完整协议](frontend-handoff.md) · [更换模型配置指南](model-configuration-guide.md) · [请求样例](api-examples.http) · [模拟夹具](fixtures/frontend.mock.json) · [校验清单](manifest.json)
