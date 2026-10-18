# 海报出图调用链核对

- 北京时间：2026-10-18T16:48:16+08:00；上一版本：2026-10-18-164339。
- 用户任务：说明当前海报生图调用什么。
- 代码基线：8574709cb9fd8faf0d022c1b80484138e11f02d5；分支：backend/api-handoff。
- 接口结论：**已核对，无接口变更**。补充文案模型、证据原图、Satori布局与Sharp输出的分工；前端无需适配。
- 实际核对：读取server/index.ts、server/schemas.ts、shared/types.ts、server/render/index.ts、server/render/layouts.ts及server/model.ts相关逻辑；GET /api/status返回200，当前模型名称deepseek-flash、configured为true。源文件哈希与上一版一致。
- 未执行：本轮未生成文案/海报、调用模型/ima、运行测试/构建或浏览器验收。既往91项测试与成品记录仅继承，不重新记为本次通过。
- 新版本包含完整交接、样例、纯模拟夹具、阅读快照、README和manifest。历史及首次原件字节保持。无密钥、原始知识库或临时图片地址入档；仅本地归档，未Git提交或推送。

[完整交接](frontend-handoff.md) · [海报调用链](poster-rendering-explanation.md) · [请求样例](api-examples.http) · [模拟夹具](fixtures/frontend.mock.json) · [校验清单](manifest.json)
