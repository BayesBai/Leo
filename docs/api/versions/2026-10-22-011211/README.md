# gpt-6.1-sol 与 styxgate 网关切换交接

北京时间：2026-10-22T01:12:11+08:00；版本：`2026-10-22-011211`；上一版本：`2026-10-22-000043`。

大纲、AI修改、正文、返修和独立审稿统一切换到 `https://relay.styxgate.top/v1/chat/completions`，模型精确使用 `gpt-6.1-sol`。按操作者本轮明确授权，本机后端继续使用原有Key，仅原子更新URL/model；凭证未输出或归档。同步后端默认值、页面兜底、环境样例、验证脚本、测试及说明，原有阶段预算、超时、取消与有限重试保持。

**已核对，无接口变更。** 核对了`server/index.ts`、`server/schemas.ts`、`shared/types.ts`、模型适配、连接策略、大纲和pipeline调用链。路由、输入/输出、SSE、审核门禁、七天历史与临时资源时效保持，前端无需新增协议适配。页面跨域切换仍须新的Key，服务端本轮同Key迁移有单独明确授权。

实际验证：138项测试通过，0失败/0跳过；新增五阶段统一网关整合回归；TypeScript、生产构建及diff检查通过。原9756服务已重启，状态接口读回新网关、新模型及已配置状态。[本轮验证摘要](verification/local-checks.json)。

真实调用未通过：生成与模型目录均被Cloudflare HTTP403 HTML页阻断，尚未得到模型协议响应，不能据此认定Key或模型权限有误。真实四渠道脚本在大纲阶段失败（应用500，上游403，3363毫秒），没有进入后续创作和排版，未调用ima。[脱敏调用结果](verification/relay-generation.json)。服务方恢复API访问后用 `npx tsx scripts/verify-relay-workflow.ts` 重验。

代码基线：`17bd7c9262d584ba21795c0604eb993110a56038`，分支`frontend/workbench`，包含既有未提交工作。工作区另有前端视觉并行修改，未由本后端任务设计或验收；归档保留保存时源码供阅读，不是独立可运行工程。继承的Figma、DeepSeek/Claude/gemini、旧HTTP/浏览器和其他verification资料均为历史，只有本说明、完整协议第13节及本轮两份验证JSON代表本次结果。

历史版本和首次交接原件保持只读；未暂存、提交或推送。保留`.gitattributes`对`docs/**`的`-text -filter`；提交仍须核对暂存字节与清单。

[完整协议](frontend-handoff.md) · [HTTP样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [共享类型](shared/types.ts) · [模型配置](model-configuration-guide.md) · [校验清单](manifest.json)。清单记录归档文件（不含自身）及核对源文件SHA-256，不含真实凭证、环境变量值、原始知识库或真实生成文案。
