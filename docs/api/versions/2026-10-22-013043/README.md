# 切回gemini-4-argon与账号池耗尽诊断

北京时间：2026-10-22T01:30:43+08:00；版本：`2026-10-22-013043`；上一版：`2026-10-22-011834`。代码基线`17bd7c9262d584ba21795c0604eb993110a56038`，分支`frontend/workbench`，含既有未提交及并行前端修改；源码快照仅供阅读，运行使用完整根工程。

按用户要求，大纲、AI修改、正文、返修、独立审稿切回 `gemini-4-argon` 与 `https://relay.nccnxta.cn/v1/chat/completions`。本机原子更新URL/model、继续当前Key，凭证和后缀不输出或归档；9756服务已重启并读回新配置。默认值、环境样例、页面兜底、测试与说明同步。

接口路由、字段、HTTP状态及SSE外壳无变化；有兼容错误行为改进：仅在HTTP503 JSON/SSE的error.message精确匹配已知账号池耗尽时，返回明确中文提示并停止本次调用，其他临时错误仍有限重试。前端无需新增协议适配，沿用message展示。原阶段预算、180秒默认超时、取消、结构校验和审核门禁保持。

实际验证：142项测试全部通过，0失败/0跳过；模型单文件28项、TypeScript、生产构建及diff检查通过。验证脚本增强阶段耗时、四渠道/版本绑定、非空成品HTTP和审核下载门禁，摘要不包含私有文案、资源URL或凭证。[本轮本地验证](verification/current-checks.json)。

真实流程仍未跑通：最小适配器及供应方原样例均上游503，原样例明确报错`All available accounts exhausted`；四渠道实际尝试于99232毫秒后在大纲阶段失败，未进入AI修改、正文、返修、审稿和排版，未调用ima。错误识别改善后，真实模型验证于46763毫秒后返回清楚的服务商账号池耗尽说明。[脱敏真实验证](verification/gemini-retry.json)。该模型线路需由服务商恢复；没有自动换模型或用规则结果冒充成功。

当前已解决上一域名Cloudflare403入口问题，但新阻断是nccnxta报告的gemini可用账号池耗尽，不能从本机代码恢复服务商容量。模型目录200并列出别名不代表可生成。供应方恢复后运行 `npx tsx scripts/verify-relay-workflow.ts` 重验。

没有重做浏览器历史、微信粘贴或平台发布验收。继承的旧模型成功、styxgate403、旧测试/浏览器/Figma文件均为历史，本版结论以本说明、完整协议第13节及本轮两份验证JSON为准。历史版本和首次原件保持只读，保留docs/** -text -filter；未暂存、提交或推送，提交前仍需核对暂存字节。

[完整协议](frontend-handoff.md) · [HTTP样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [共享类型](shared/types.ts) · [模型配置](model-configuration-guide.md) · [清单](manifest.json)。
