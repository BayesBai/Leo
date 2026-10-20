# DeepSeek Flash 配置与更换模型

本项目继续使用Anthropic Messages协议。DeepSeek官方提供兼容入口，使用如下公开配置（密钥为占位）：

```dotenv
LLM_BASE_URL=https://api.deepseek.com/anthropic
LLM_MODEL=deepseek-flash
LLM_API_KEY=YOUR_DEEPSEEK_API_KEY
LLM_THINKING=disabled
```

模型ID及入口依据[DeepSeek首次调用文档](https://api-docs.deepseek.com/zh-cn/)和[Anthropic兼容说明](https://api-docs.deepseek.com/guides/anthropic_api/)。请求由server/model.ts组装为POST /anthropic/v1/messages，使用x-api-key，stream:true，解析Messages文本和SSE。无需新建OpenAI协议适配。

LLM_THINKING是本版新增的后端环境选项，只支持default（或留空）与disabled。default不发送thinking字段，沿用服务默认行为；disabled发送thinking:{type:"disabled"}。其他值在读取模型配置时抛MODEL_CONFIG，HTTP状态或生成流按原错误处理返回，避免静默误配。此变量不是/api/connections/settings字段，不写进AppStatus；前端协议不变。依据[DeepSeek思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode/)，服务默认开启思考；原16token连接测试实际触发输出上限，本次通过显式关闭思考后验证成功。

本机.env.local已切换DeepSeek，用户在本地填写自己的官方密钥；旧赛事配置备份留在Git忽略的本机目录，实际值不进入本归档。没有把原赛事密钥用于DeepSeek。实例已在http://127.0.0.1:9755/重启，刷新页面并选择模型创作后使用。重启前的内存大纲/正文句柄会失效，需重新生成。

持久配置编辑.env.local后重启。dotenv override:false，Shell已存在的同名变量优先；本次启动显式移除了继承的LLM配置覆盖，加载本地文件。页面配置仅服务端内存，重启后恢复环境配置。域名白名单仍固定为赛事域名与启动配置域名，页面不接受任意新域名；未放宽该策略。ima凭证独立，未修改或验证ima。

如仍用同一服务与模型，仅换Key只需改LLM_API_KEY；换地址或模型同步修改对应变量。若服务只支持其他协议，仍需另外适配server/model.ts，不能只改地址。

本轮完成模拟路径与请求核对、91项测试、生产构建及最小真实连接检查；没有用DeepSeek重跑完整产品营销任务、四渠道排版或浏览器全流程。不将短文本验证记为全流程验收。
