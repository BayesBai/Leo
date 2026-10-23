# 本地启动、GitHub密钥核对与当前模型

北京时间：2026-10-22T19:26:58+08:00；版本2026-10-22-192658，上一版2026-10-22-190058。代码基线d12b55b8026138dd65c887f400a7fc0152a9baa8，分支frontend/workbench。本次新增归档在本地保存，未提交或推送。

**已核对，无接口变更。** 只读核对server/index.ts、server/schemas.ts、shared/types.ts、server/start.ts、server/model.ts与接入配置流程；没有业务代码、环境变量或凭证修改。

- 已用npm run dev在 http://127.0.0.1:3000 启动最新项目。旧9756服务在无待运行任务时正常停止，并保留原历史。
- 前端入口和status/products/jobs共4项读取均200；10个产品、53张本地图片，待运行任务0。
- 当前模型API网关： https://relay.nccnxta.cn/v1 ；配置模型路由名：gpt-6.1-sol；模型Key已配置，ima未配置。项目未记录网关运营公司名称，路由名不能证明真实上游身份。
- 上次提交d12b55b及全部1108个可达Git对象精确匹配当前本地凭证，命中0；.env.local未跟踪，当前API密钥未一起push。
- 未发起真实模型/ima请求、未重跑测试/构建。上一版201测试与构建、旧浏览器证据均保持为历史结果。
- 保留旧归档与首次原件；新版本相对链接、清单SHA和当前源快照在任务结束前核对。

[完整交接第11节](frontend-handoff.md#11-本轮本地启动密钥推送核对与模型说明) · [运行回读](verification/local-startup.json) · [Git凭证核对](verification/current-secret-git-audit.json) · [HTTP样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [清单](manifest.json)。

未知已轮换旧凭证未纳入精确匹配结论；本版没有凭证值、环境变量私密值、签名URL、原始知识库或私有运行资料。代码快照供阅读，不是独立运行工程；运行使用项目根完整代码。
