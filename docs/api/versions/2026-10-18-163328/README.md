# 真实模型HTTP流程测试

- 北京时间：2026-10-18T16:33:28+08:00；上一版本：2026-10-18-163254。
- 任务：使用当前已配置模型API执行一次真实大纲→确认→正文审稿→视觉成品流程。
- 代码基线：3d3646fddcec77da767b70fdea0d68cc413b80cb；分支：backend/api-handoff，含未提交源码，哈希为准。
- 接口结论：**已核对，无接口变更**。server/index.ts、server/schemas.ts、shared/types.ts及相关流程/前端/渲染源码哈希与上一版一致。
- 兼容性：无新增前端适配。模型模式+本地资料，门店朋友圈单渠道。
- 实际结果：真实HTTP流程完成，审核状态needs_attention，1张PNG及ZIP下载成功。 耗时141秒；详情见去敏摘要。
- 真实服务：使用配置的claude-opus-5模型；没有调用ima、没有自动发布。若为needs_attention，仍需要人工确认来源和实际销售版本。
- 未执行：本轮未重跑89项测试/生产构建、浏览器全流程、微信剪贴板或其他渠道生成，不将历史结果重复记为本轮通过。
- 归档：完整协议、样例、纯模拟夹具与源码快照继承并复核，历史版本与首次原件保持；无凭证、原始知识库、真实事实摘录、临时素材地址写入本版。仅本地新增，未Git提交或推送。

[完整接口](frontend-handoff.md) · [真实测试摘要](live-api-verification.json) · [请求样例](api-examples.http) · [模拟夹具](fixtures/frontend.mock.json) · [校验清单](manifest.json)

代码快照仅供阅读，不是独立可运行工程。
