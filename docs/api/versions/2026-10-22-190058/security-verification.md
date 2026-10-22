# 安全与异常验证记录

北京时间：2026-10-18T16:23:58+08:00；基线 3d3646fddcec77da767b70fdea0d68cc413b80cb，分支 backend/api-handoff。

| 范围 | 修复及实际证据 |
| --- | --- |
| 本机HTTP | 恶意Host、不同Origin协议/主机/端口、cross-site标志均拒绝；JSON解析失败/超限带no-store及nosniff；4项HTTP专用测试通过 |
| 配置与取消 | 模拟4个已取消但尚未清理的调用，配置仍409、超额操作429，清理完成恢复；启动域名策略固定 |
| 模型读取 | 3项新增测试覆盖重试凭证快照、配置改变后的错误脱敏、非流响应超限立即取消；无真实模型调用 |
| SSE与前端 | 9项新增测试覆盖中文分片、CRLF/多行/心跳、终态关闭、错误/缺失/错绑结果、取消和接收上限 |
| 渲染 | 7项专用测试覆盖HTML/外链注入、字面模板字符、受控PNG、预取消、导出脱敏、实际XHS图片、写入后的取消/失败文件清理 |
| 完整流程 | 全部89项测试通过、0失败/0跳过；TypeScript及生产构建通过 |
| 实际成品 | 本地规则模式：公众号HTML+1200×900封面、小红书6张、朋友圈2张、海报1张，各含ZIP；尺寸记录与海报视觉检查完成，均needs_attention |
| 依赖 | Mermaid固定11.16.1，npm audit剩5项moderate、0high、0critical；未调用front-matter依赖链仍需跟进，不记作零漏洞 |

本轮未执行真实模型/ima服务验证、浏览器全流程重验、富文本剪贴板或微信粘贴验收、20组并发压力测试及公开部署验收。上一阶段的真实服务记录仅作继承信息。成品、原始事实和测试临时资料只留忽略目录，没有写入本归档。审核待确认仍需人工复核。

测试代码：[HTTP](tests/http-security.test.ts)、[SSE](tests/frontend-api.test.ts)、[渲染](tests/render-security.test.ts)、[模型](tests/model.test.ts)。[完整协议](frontend-handoff.md)、[第三方声明](rendering-notices/THIRD_PARTY_NOTICES.md)。
