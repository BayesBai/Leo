# 当前模型配置

大纲、AI修改、正文、返修和独立审稿统一使用 `gpt-6.1-sol`，Base URL `https://relay.nccnxta.cn/v1`，Endpoint `/chat/completions`，Bearer、system/user messages、stream=true。按本轮要求仅更新模型，网关及当前Key原值保持；凭证只留本机后端，不输出或归档。9756服务已重启并通过状态读回。

原阶段输出预算（大纲/AI修改6500、正文/返修3500、审稿3000）、180秒默认超时、取消传播、JSON校验及有限重试保持。上一版容量错误识别继续生效：仅HTTP503的JSON/SSE error.message严格匹配已知账号池耗尽时给出中文说明并停止本次调用，不回显未知上游正文，不误判200正常文本。

模型名作为网关路由标识发送，不等于已核实上游真实模型身份。真实业务结果、总耗时、审稿与返修、成品HTTP见[本轮脱敏联调](verification/sol-retry.json)和[完整交接第13节](frontend-handoff.md)。仅最小OK、模型目录200或配置存在不能当完整流程通过；旧Gemini失败与旧GPT最小成功属于历史。

默认测试隔离真实环境、知识库与外网。真实验证脚本为 `npx tsx scripts/verify-relay-workflow.ts`，使用本地已授权资料，不使用ima；严格核对版本、四渠道、审核实际执行、成品非空HTTP和下载门禁，技术完成不代表内容可直接发布。
