# 更换自有模型API配置

当前代码并非任意模型协议自动适配。server/model.ts固定使用Anthropic Messages格式：POST <baseUrl>/v1/messages，x-api-key与anthropic-version头，读取Messages JSON或SSE文本。

| 变更情况 | 需要修改 |
| --- | --- |
| 同一服务、同一模型，仅更换密钥 | LLM_API_KEY |
| 同一协议，更换地址或模型 | LLM_BASE_URL、LLM_MODEL、LLM_API_KEY中实际变化的项 |
| 新服务只支持其他协议，例如/v1/chat/completions | 除配置外，还需修改server/model.ts适配请求、认证、响应和流式事件；不能仅改地址 |

持久设置编辑项目根.env.local（本说明未读取或修改此凭证文件），然后重启后端。Base URL使用服务根地址或以/v1结尾的基础路径，不填完整/messages或/chat/completions；当前代码会去除末尾/v1，再拼接/v1/messages。已有Shell环境变量优先于.env.local（dotenv override:false），修改文件未生效时需检查旧进程及Shell环境。

纯占位示例：

```dotenv
LLM_BASE_URL=https://your-provider.example
LLM_MODEL=YOUR_MODEL_ID
LLM_API_KEY=YOUR_API_KEY
```

页面接入表单也可临时更新，保存后只驻留服务端内存，重启恢复环境配置。新域名需先在.env.local配置并重启，因为页面域名白名单固定为赛事域名和服务启动配置域名；页面只接受HTTPS及默认443端口。配置时不要在聊天或交接文档填写真实密钥。前端选择模型创作才能调用模型；ima凭证独立，不随模型Key自动修改。

本次只读核对现有代码并补充说明，未更换服务、修改环境文件、重启实例或调用模型验证。新服务兼容性需要其Base URL、模型名称和接口文档才能确认。
