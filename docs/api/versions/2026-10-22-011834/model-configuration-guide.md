# 当前配置与网关诊断

当前本机环境与9756服务仍为Base URL `https://relay.styxgate.top/v1`、模型`gpt-6.1-sol`，实际Endpoint为`/chat/completions`，采用标准Bearer与system/user消息、stream=true。大纲、AI修改、正文、返修和独立审稿共用该适配层。本轮未修改配置或密钥。

与操作者文档中的`https://relay.nccnxta.cn/v1`对比：同一当前Key、同一模型、同一请求格式下，styxgate为Cloudflare403 HTML；nccnxta为HTTP200 SSE，正常返回OK，约10.8秒。最小调用已证明当前Key和已检查协议在文档地址可用，故障定位styxgate入口访问层。两域名不能仅因文档格式相同而假定相同访问策略。

本轮只检查和报告，没有自动切回文档网关。示例中的gpt-5.4不覆盖上一轮明确指定的gpt-6.1-sol。未验证完整四渠道创作或ima；模型别名仍是网关路由标识，不证明上游真实模型身份。

[本轮脱敏验证](verification/gateway-diagnosis.json) · [当前完整协议](frontend-handoff.md)。继承的其他验证均是历史，不能当作本轮通过项。完整密钥与用户要求查看的后缀均未写入交接。
