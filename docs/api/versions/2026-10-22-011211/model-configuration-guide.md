# 当前模型配置

大纲、AI 修改、正文、返修和独立审稿统一请求 `https://relay.styxgate.top/v1/chat/completions`，模型精确使用 `gpt-6.1-sol`，使用 Bearer 和 system/user messages。`LLM_BASE_URL` 可填 `https://relay.styxgate.top` 或 `https://relay.styxgate.top/v1`，后端规范化为 `/v1`。

本轮用户明确授权继续使用当前 Key，因此仅在本机后端环境文件中保留 Key 并更新地址/模型；文件权限600，未输出或归档密钥。其他本机配置保留，已重启原9756服务，状态接口读回目标模型及新地址。网页跨域换网关仍须新 Key，未放宽该保护。

原 Chat Completions 流式协议、各阶段输出预算、180秒默认超时、取消传播、有限重试不变。模型名是网关路由标识，不代表已核实上游模型身份。

本轮最小生成与真实四渠道尝试均为上游403，POST响应及模型目录响应均为Cloudflare HTML拦截页（Attention Required!）。尚未得到模型生成响应，不能据此判定Key无效、模型不存在或模型本身不支持该协议。真实ima未调用。

[本轮脱敏验证](verification/relay-generation.json)；服务方恢复API访问后可运行 `npx tsx scripts/verify-relay-workflow.ts` 重验。继承的DeepSeek/Claude/gemini与旧浏览器验证只作为历史记录。
