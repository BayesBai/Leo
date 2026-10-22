# API网关访问诊断

北京时间：2026-10-22T01:18:34+08:00；版本：`2026-10-22-011834`；上一版：`2026-10-22-011211`。代码基线`17bd7c9262d584ba21795c0604eb993110a56038`，分支`frontend/workbench`，工作区含既有未提交及并行前端修改；快照供阅读，不是独立可运行工程。

用户要求对照nccnxta文档检查失败原因，并核对当前Key后四位。本轮未修改源码、环境配置或运行时设置；密钥和后缀均不写入归档。**已核对，无接口变更**：核对server/index.ts、server/schemas.ts、shared/types.ts及模型、连接、大纲、pipeline链路，HTTP/SSE、输入输出、审核下载门禁及历史行为保持，前端无需新增适配。

实际对比：同一当前Key、同一gpt-6.1-sol和相同最小请求，styxgate的生成/模型目录均为Cloudflare403 HTML；nccnxta的目录200含目标别名，生成200 SSE，正常解析OK，耗时10789毫秒。故障定位styxgate入口访问层；当前Key和已检查的调用格式在文档网关最小生成成功。[脱敏诊断](verification/gateway-diagnosis.json)。

当前服务仍按上一轮指定的styxgate+gpt-6.1-sol运行，没有自动回切或改为示例gpt-5.4。最小成功不表示完整大纲、四渠道、返修、审稿或ima验收通过。本轮未重跑应用测试或构建；继承的138项测试、旧模型结果及浏览器记录只作为历史。[本轮范围](verification/current-checks.json)。

历史归档及首次交接原件保持只读，保留docs/** -text -filter；SHA-256清单不包含凭证或环境文件值。未暂存、提交或推送，提交仍需核对暂存字节。

[完整协议](frontend-handoff.md) · [HTTP样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [类型](shared/types.ts) · [清单](manifest.json)。
