# gemini-4-argon 接入、流程修复与七天历史交接

北京时间：2026-10-21T23:29:30+08:00；版本：`2026-10-21-232930`；上一版：`2026-10-21-225459`。

本轮按已确认计划统一切换大纲、AI修改、正文、返修和独立审稿到 `https://relay.nccnxta.cn/v1/chat/completions`，模型标识 `gemini-4-argon`。新增本机七天历史、刷新/重启恢复，提前拒绝缺图，避免固定结构的无效自动返修，默认测试不再依赖私有环境与知识库。

接口有变化：新增 GET /api/history、GET /api/runs/:id；OutlineResult.history与ReviewIssue.target/resolution为可选增量字段；配图数量在策划前及保存/确认阶段严格校验，422可更早出现。旧HTTP路由、SSE事件、确认版本和全局审核门禁保留。前端已同步历史、旧版快照、配图上下限和处理动作，其他前端应按[完整交接](frontend-handoff.md)适配。

实际验证：137项测试通过，0失败/0跳过；TypeScript与生产构建通过。真实本地HTTP使用纯模拟知识库完成页面生成、排版、刷新及后端重启恢复，PNG200且原到期时间不变，桌面和390px无横溢。另有[状态/重启验证摘要](verification/local-checks.json)及[浏览器恢复摘要](verification/local-http-history.json)。

真实新网关模型目录200且包含目标模型标识，但生成请求经过有限重试仍为HTTP503；按供应方原样例也503。[真实四渠道尝试](verification/relay-generation.json)在大纲生成失败（应用500，上游503，约101秒），未进入正文/审稿/排版，未调用ima。因此本版完成接入代码与本地验收，不能声明新模型真实全链路跑通。服务恢复后可用 `npx tsx scripts/verify-relay-workflow.ts` 重验。

大纲成功保存后留存7天、成稿自完成留存7天；读取不续期。ima证据、临时原图及成品仍30分钟，重启不重计时；资料变化需重新取证。单机原子JSON不是云端备份、多用户服务或永久作品库。

代码基线：`17bd7c9262d584ba21795c0604eb993110a56038`，分支 `frontend/workbench`，包含本轮及既有未提交工作区修改。源码快照供阅读，运行使用根目录完整工程。本版继承的旧研究/DeepSeek/Claude/Figma验证文件仅为历史资料，当前结论以本说明与完整交接第13节为准。

历史版本及首次交接原件未改动；未暂存、提交或推送。`.gitattributes`的docs/** -text -filter保持，提交时仍需核对暂存字节与清单。

[完整协议](frontend-handoff.md) · [HTTP样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [共享类型](shared/types.ts) · [校验清单](manifest.json)。清单记录版本文件（不含清单自身）及核对源文件的SHA-256，不含凭证、环境变量值或原始知识库。
