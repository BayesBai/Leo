# gemini-4-argon当前配置与容量故障

全部模型阶段统一使用Base URL `https://relay.nccnxta.cn/v1`、Endpoint `/chat/completions`、模型标识`gemini-4-argon`、Bearer与system/user消息、stream=true。本轮按操作者要求继续使用原Key，在本机环境文件原子更新URL/model；Key只保留后端，未输出或归档，文件权限600。页面跨域换Key保护没有放宽。

本轮最小调用、供应方原样例和完整大纲入口均出现上游503。原样例（单user、stream=true，不带system/max_tokens）明确返回`All available accounts exhausted`，因此故障定位服务商当前模型账号池，没有证据表明改请求参数就能恢复。模型目录200含目标标识，仅表示列出别名。

新增有界识别：仅HTTP503、JSON/SSE的error.message严格匹配该已知容量消息时，返回中文说明并停止本次调用；不会回显其他上游原始内容，不把正常200正文中的相同词误判为容量错误。其他临时状态仍最多额外重试一次。默认180秒超时、取消、原阶段预算和结构校验保持。

四渠道真实尝试在大纲阶段失败，未进入AI修改、正文、审稿和排版；真实ima未调用。没有自动切回gpt-6.1-sol或旧网关。服务商恢复gemini线路后可运行 `npx tsx scripts/verify-relay-workflow.ts` 重验；脚本严格验证四渠道、绑定、非空成品HTTP及审核下载门禁，不将技术完成当发布通过。

[本轮脱敏结果](verification/gemini-retry.json) · [完整协议](frontend-handoff.md)。继承的gpt/nccnxta最小成功、styxgate403和旧测试都只是历史资料，不算本轮gemini真实流程通过。
