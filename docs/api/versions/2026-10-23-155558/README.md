# 火山方舟Seedream5.0pro生图迁移

北京时间：2026-10-23T15:55:58+08:00；版本`2026-10-23-155558`；上一完整版本[2026-10-23-155111](../2026-10-23-155111/README.md)。代码基线`d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支`frontend/workbench`，保留既有未提交工作区。

**相对155111已核对，无新增运行路由或DTO字段。** 本任务实现了方舟生图默认值与可选`usage.generatedImages`统计，代码已先被并行155111归档同步；本版补齐本轮迁移协议、配置和真实成功验收。`status.image.name/baseUrl`默认使用官方Seedream5.0pro，文本模型、文本网关与Key保持原配置。

所有新生图默认`https://ark.cn-beijing.volces.com/api/v3`，精确Model ID `doubao-seedream-5-0-pro-260628`。单图非流式，PNG/Base64、watermark=false，省略旧图片协议n及组图/stream参数；海报仍请求1024×1536并保存实际返回像素。Key通过隐藏输入脚本独立配置，不迁移或发送旧中转站Key。

显式旧provider配置只作历史兼容，新默认无旧域回退；旧任务绑定提交配置、缓存/失败/未知派发检查点不被读取动作重写。海报三项人工核对、图文/视频独立门禁与7天/30分钟期限保持。没有新Key时不声称官方服务真实连通或图片交付成功。

最终定向分组全部通过：根单位43/43（文本model28、隐藏配置脚本3、生图adapter12），HTML+jobs HTTP+queue集成26/26（117.131秒），工作流25/25及末轮3/3、cache-bound2/2，前端20/20；工作流分组存在重叠，不相加虚构总数。本轮未运行全量`npm test`。类型检查通过，最终`npm run build`通过（4.72秒，仅Mock懒加载块660.81kB体积提示），`git diff --check`通过。

用户通过隐藏输入脚本配置了本机新方舟Key，代理未代替输入、读取或输出Key。服务已重启，公开status核对image为精确模型、官方`/api/v3`、configured=true与300秒上限；文本保持gpt-6.1-sol及原relay。没有把真实Key、临时URL或原始响应写入文档。

唯一真实Seedream整图海报成功返回：任务50.254秒，1次生图HTTP请求49.531秒、HTTP200/succeeded，无自动重试及第二张生成。PNG为1024×1536、3098999字节；预览200，人工核对状态pending，核对前直接正式下载409，原30分钟期限不续期。实际查看只确认图片可解码且有画内中文与产品构图，**没有将逐字、型号外观或参数事实的人工核对记为通过，也未批准正式交付**。提供商返回completionTokens6144、totalTokens6144、generatedImages1；输入用量未提供，保持未知，不填0或推断费用。

本轮没有新的文本、视频或外部设计调用。旧Cloudflare403仅是旧提供商历史，不能作为方舟状态证明；方舟本次连通结论来自上述唯一真实请求。部署规划仍未实施，微信平台粘贴、发布、真实ima及海报三项人工核对未验收。没有额外生成图片，没有Git暂存、提交或推送。

归档执行前发现最新入口已被并行ima专项更新为155111，已以该版重基，保留ima审计、指南、CLI和测试原件；它的18项测试作为历史引用，不计入本轮分组。相对155111运行路由/DTO无新增，其已同步本任务部分方舟代码；本版补齐完整协议与真实验收。

[上一版ima专项检查](ima-audit.md)、[ima配置指南](docs/setup/ima-knowledge-base.md)、CLI及测试原样保留；其18项测试属于155111历史，见[原验收](verification/ima-previous-acceptance.json)，不计本轮测试。[部署规划](deployment-plan.md)仍未实施；[Cloudflare403排障](cloudflare-403-troubleshooting.md)原文仅是旧提供商历史，不代表已切换的方舟状态。两份文件字节原样保留，当前迁移边界见[迁移说明](image-provider-migration.md)。

[完整交接](frontend-handoff.md) · [HTTP样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [共享类型](shared/types.ts) · [输入](server/schemas.ts) · [前端快照](src/App.tsx) · [本次验收](verification/acceptance.json) · [SHA-256](manifest.json)

只包含公开源码、明确纯模拟样例与安全验收汇总；不复制.env.local、运行时状态、真实Key/任务ID/图片/临时签名链接。旧版本及首次交接原件只读，未自动暂存、提交或推送。可选第三方Skill原文快照省略范围沿用上一版，固定上游哈希与许可证保留。
