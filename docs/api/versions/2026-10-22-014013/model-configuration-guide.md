# 当前模型配置与验证边界

当前源码默认Base URL为`https://relay.nccnxta.cn/v1`，模型为`gpt-6.1-sol`，所有大纲／AI修改／正文／返修／独立审稿共用同一OpenAI兼容Chat Completions适配层。运行时状态以服务端配置为准，浏览器不直连网关，凭证不进入前端存储或归档。

Bearer、system/user、stream=true、阶段输出预算、180秒默认超时、取消、结构校验与有限重试保留。仅HTTP503 JSON/SSE的error.message精确匹配已知账号池耗尽时显示中文容量说明且停止本次立即重试；不回显其他上游原文，也不把200正文中的相同词误判为错误。页面跨origin更换密钥保护没有放宽。

本版最终142测试和构建已在当前GPT默认值上重新通过；这不等于付费模型完整生成成功。本前端任务的真实模型HTTP旧时段停在大纲500／上游503，规则local四渠道成功单独记录，ima未配置。之后并行GPT真实联调另属后端任务，不在本版推断其结论。[本版说明](README.md) · [完整协议](frontend-handoff.md) · [此前Gemini容量诊断](../2026-10-22-013043/README.md)。
