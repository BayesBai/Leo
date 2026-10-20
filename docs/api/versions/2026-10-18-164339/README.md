# DeepSeek Flash 配置与验证

- 北京时间：2026-10-18T16:43:39+08:00；上一版本：2026-10-18-163616。
- 用户任务：把当前项目配置为自己的DeepSeek Flash API。
- 代码基线：8574709cb9fd8faf0d022c1b80484138e11f02d5；分支：backend/api-handoff；本地修改以manifest源哈希为准。
- 接口结论：前端HTTP字段、路由、响应和SSE无变更；新增后端环境项LLM_THINKING(default/disabled)，默认保持原行为，非法配置提前报错。前端无需新增适配。
- 配置：本机.env.local使用官方Anthropic兼容入口与Flash模型；用户在本地填写Key。旧配置仅保存在忽略目录。没有跨服务复用赛事Key，ima配置未改。
- 实际验证：请求路径/协议模拟核对；91项测试全部通过（0失败/0跳过）；TypeScript和生产构建通过；重启9755实例；最小真实模型验证HTTP200。第一次真实检查因默认思考与16token预算触发长度上限，增加显式关闭思考配置后复验通过。
- 未执行：DeepSeek完整营销生成/审稿/四渠道成品、ima和浏览器端到端本轮均未验收；历史结果不重记为本轮通过。
- 归档校验：历史文件和首次原件SHA-256保留、当前阅读快照/源文件对齐、相对链接与凭证排除。环境文件、Key、备份、原始知识库不在归档内。仅本地新增，未Git提交或推送。

[完整交接](frontend-handoff.md) · [配置指南](model-configuration-guide.md) · [去敏验证](deepseek-connection-verification.json) · [请求样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [校验清单](manifest.json)

代码快照仅供阅读，不构成独立可运行项目。刷新http://127.0.0.1:9755/后选择模型创作使用新配置；重启前的内存任务需重新生成。
