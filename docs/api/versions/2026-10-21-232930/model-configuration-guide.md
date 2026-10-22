# 当前模型配置

所有大纲、AI修改、正文、返修和独立审稿统一使用 `https://relay.nccnxta.cn/v1/chat/completions`、Bearer鉴权和模型标识 `gemini-4-argon`。仅在本机 `.env.local` 配置 `LLM_API_KEY`，不把密钥写入交接或浏览器。`LLM_BASE_URL` 填 `https://relay.nccnxta.cn/v1`，`LLM_MODEL` 填 `gemini-4-argon`。

保留180秒超时和有限重试，采用OpenAI兼容Chat Completions；不发送旧Messages的thinking参数，不自动切换模型。协议参考[OpenAI官方流式文档](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)。

本轮模型目录200并含该标识，但真实生成503，尚未完成新模型端到端验收。见[本轮真实验证](verification/relay-generation.json)。`deepseek-connection-verification.json`等继承文件是历史记录，与本轮新配置无关。
