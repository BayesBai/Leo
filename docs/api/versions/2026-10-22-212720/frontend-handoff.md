# 前后端接口交接说明

版本 **2026-10-22-212720**，北京时间 **2026-10-22T21:27:20+08:00**。代码基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`；实现为此基线上的工作区变更。以上一版 [2026-10-22-205701](../2026-10-22-205701/README.md) 的完整协议为起点。

**本轮为既有 Canva 预检失败响应新增安全诊断字段，不新增路由；OAuth 目标和分层验证加强。** 已同步冻结源码。257 项离线测试、类型检查和生产构建通过；新目标 OAuth 已连接；项目客户端和独立官方 SDK 均在 MCP 初始化返回 HTTP 500，具体根因未确认，真实设计验证未进入。

用户已配置应用并完成旧目标 OAuth，旧令牌的 REST 读取成功而 MCP 初始化失败。修正 canonical resource 后账号本人已重新授权，但新目标 MCP 初始化仍失败；旧 OAuth 成功不等于分层文件可导入、图片/中文可编辑、实际导出或字体/换行质量通过。本轮加强付费前的实时工具 Schema/REST 只读预检和可编辑图片层核验；详见本版新增的第 8 节。

共享数据见 [shared/types.ts](shared/types.ts)，输入约束见 [server/schemas.ts](server/schemas.ts)，[HTTP 样例](api-examples.http)和[纯模拟夹具](fixtures/frontend.mock.json)。源码快照供阅读，不是独立运行工程。实际验证、费用统计及未完成项见 [本版 README](README.md) 和 [验收记录](verification/acceptance.json)。

## 1. 启动、配置与本机边界

Node.js >=22.12；安装 `npm ci`，准备本地渲染 `npm run setup:render`，开发 `npm run dev`，生产 `npm run build` 后 `npm start`。现行本机地址为 `http://127.0.0.1:3000`。`server/start.ts` 读取 `.env.local`/`.env`，不覆盖已有进程环境；单独导入 `createApp` 不读取本机秘密文件，也不监听端口。开发监听排除 `.local-state/`、`.cache/`、`output/` 和历史归档。

| 能力 | 后端配置及请求 | 本轮行为 |
| --- | --- | --- |
| 大纲、AI 修改、正文、返修、独立审稿 | `LLM_BASE_URL=https://relay.nccnxta.cn/v1`，`LLM_MODEL=gpt-6.1-sol`，`LLM_API_KEY` | 保留现有文本网关和 Key；统一 Chat Completions |
| AI 环境/主视觉 | `IMAGE_BASE_URL=https://relay.styxgate.top/v1`，`IMAGE_MODEL=gpt-image-2.5`，`IMAGE_API_KEY` | 独立凭证；精确原样发送模型别名，不替换变体；Images API `/images/generations` |
| Canva | `CANVA_CLIENT_ID`、`CANVA_CLIENT_SECRET`、`CANVA_REDIRECT_URI` | 用户开发应用启用 REST APIs 和 MCP，后端完成 OAuth、刷新和设计操作 |

本机隐藏输入命令：`python3 scripts/configure-visual.py image` 与 `python3 scripts/configure-visual.py canva`。脚本原子写 `.env.local`，权限 600，保留文本与其他设置；重启前确认无运行任务。具体开发门户步骤、权限和回调见 [本机视觉配置指南](docs/setup/visual-integrations.md)。Key、Secret、Access/Refresh Token、PKCE verifier 都不能进入浏览器存储、Job DTO、URL、日志或交接归档。仅 OAuth 返回的 `authorizationUrl` 临时用于账号本人授权。

Canva 当前官方 MCP 入口为 **`https://api.canva.com/connect/v1/mcp`**，不是第三方 MCP 代理。REST 为 `https://api.canva.com/rest/v1`。默认本机回调必须在开发门户完整登记为 `http://127.0.0.1:3000/api/integrations/canva/callback`。所需权限：`design:content:read`、`design:content:write`、`design:meta:read`。Canva Pro 开发账号选择 Public 应用做自己的开发测试；本轮不发布应用，不调用 Canva 生图。安装 Codex 插件不能替代本项目后端 OAuth。

服务保持本机单操作者模式。Host 仅允许本机或 HOST 显式允许主机；写请求的 Origin 须同源，命令行可以省略；独立 Vite 代理保留 Host。JSON 请求最大 256KB。strict 输入对象拒绝未知字段，Brief 等非 strict 内嵌对象依 Zod 剥离未知字段。页面文本设置只改后端进程内配置；跨 origin 切换必须同时提交新的对应 Key，不能沿用旧网关凭证。后台排队/运行/取消清理期间修改连接返回 409。

## 2. 工作流、独立交付与成品内容

填写需求 → 后台分渠道大纲 → 合并 editing → 人工保存/AI 修改 → 人工确认当前 version → 加入生成队列。各渠道随后独立执行：正文 → 规则校验 → 独立审稿 → 必要且最多一次正文返修与复审 → 建立 `ChannelDelivery` → 本渠道成品制作与交付。确认不触发正文；固定标题、段落 ID/顺序/标题、引用和源图只能返回大纲修改。

**每渠道独立审核、独立导出。** 一个渠道的审稿/视觉失败不阻塞其他已通过渠道。`RunResult` 仍只代表完整所选渠道稿件集；部分成果用 `ChannelDelivery` 表示，不以缺少稿件的 RunResult 冒充完整任务。完整稿件集聚合检查仍保存，但每个渠道有自己的审核结论与导出门禁。

| 渠道 | 成品与制作 |
| --- | --- |
| 小红书 | 一张独立封面及按实际信息分组的正文卡，总计 3–6 页、1080×1440；无泛化结束页，CTA 合并末信息页。真实产品图、中文文字和 AI 环境背景为独立层；Canva 项目可编辑。 |
| 公众号 | 微信兼容内联样式 HTML，保留文字、段落、必要适用条件和原图；1200×510 横向封面经 Canva 导出，复用合适的主视觉重新构图。正文不拍平成长图。 |
| 朋友圈 | 自然文案与 1–3 张精选同型号原图；`RenderArtifact.format=original`，下载保留原图字节和真实 MIME，不再强制拼文字卡，不调用生图。 |
| 门店海报 | 结构化简报 → AI 背景 → 真实产品原图及精确中文层 → Canva 读取/编辑/导出；1080×1920，一个主标题、产品主体、最多三个卖点与行动区。 |

正常 live 四渠道共两份 AI 素材：共用主视觉（小红书/公众号）和海报背景。共享素材独立于另一个渠道审稿成功与否，单飞调度、持久检查点复用；同轮早失败与晚到渠道也不能自动重新生图。普通重排复用仍有效的素材；用户主动 `regenerateVisual:true` 才明确要求重生成。过期缓存不会偷偷续期或自动重新计费。

所有新 PNG 和公众号 HTML **不再嵌入审核水印、审核页脚、固定“本地资料/检查通过”等标签**。审核状态、来源、风险提示留在工作台和 ZIP 的独立 `来源与审核.md`。产品事实必须的适用条件仍原样保留。`publication=preview` 的兼容预览也不加水印；它仍不可正式复制/下载。`blocked` 既不提供 `downloadUrl`/`zipUrl`，服务端直接下载仍返回 409；更改外部文字/产品素材后撤销已发渠道资源，兼容接口也不能新建句柄绕过门禁。`needs_attention` 保留警告但可交付，不表示事实全部已无风险。

旧水印作品不会因读取而修改。渠道“重新排版”从保存的正文和有效来源本地重制，使用 rendererVersion 3 与新句柄；不再请求文案模型。有效旧成品的迁移沿用原 expiresAt；缓存命中不续期。失效资源需明确主动重排/重生成，来源变化或已过期时先重新取证。

## 3. HTTP 接口完整清单

本节包含上一版已接入的队列、独立交付和视觉能力；本轮没有新增路由，仅扩展既有 Canva verify 失败诊断并收紧授权目标。下文完整类型清单中相对旧版的扩展，不代表全部是本轮新增。

响应没有统一 `data/code` 包装。常规错误 `{message}`；必要输入为 `{type:'needs_input',message,fields:[{field,question}]}`。Job 提交/读取成功不表示模型和视觉已经成功，异步失败见 `job.error` 和所属 `channels[].error`。

| 方法与路径 | 输入 | 响应/语义 |
| --- | --- | --- |
| GET /api/status | 无 | AppStatus；可选 image、canva，不含凭证；configured/connected 不等同真实完整验收 |
| GET /api/products | 无 | `{products:Product[]}`；使用实际 product.id |
| GET /api/task-options | 无 | TaskOptions；包含当前渠道原图数量上下限 |
| POST /api/connections/settings | 可选 baseUrl/model/apiKey/imaClientId/imaApiKey/imaKbName | AppStatus；空白保留；运行任务时 409；不设置 IMAGE 或 Canva Secret |
| POST /api/connections/model/verify | `{}` | `{verified,message}`，真实最小文本调用，共享模型限额 |
| POST /api/connections/verify | `{}` | ima 验证后的 AppStatus，仍不保证后续取证配额 |
| POST /api/jobs | JobSubmit | **202 `{job}`**；输入先持久化，不等待模型/导出完成 |
| GET /api/jobs | 可选 idempotencyKey | `{jobs}`；普通列表最近最多 100 条，紧凑输出；按精确 key 返回完整对象 |
| GET /api/jobs/events | 无 | SSE `data:{type:'snapshot',jobs}`；15 秒注释心跳，订阅断开不取消任务 |
| GET /api/jobs/:id | 无 | `{job}` 完整详情；七天后 410 |
| POST /api/jobs/:id/cancel | `{}` | `{job}`；显式取消本任务，完成渠道不撤销 |
| POST /api/jobs/:id/retry | `{}` | `{job}`；仅 failed/interrupted；成功正文、审稿、视觉检查点继续复用；已知不可重试/配置或版本冲突时 409 |
| POST /api/outlines | Brief | 兼容 OutlineResult，缺图预检先于模型 |
| GET /api/outlines/:id | 无 | 当前 OutlineResult + history，读取不续期 |
| PUT /api/outlines/:id | `{version,platforms}` | 全部渠道完整保存；version+1、editing、撤销确认 |
| POST /api/outlines/:id/revise | `{version,instructions}` | 兼容同步 AI 修改；指定渠道时定向，否则保守覆盖 |
| POST /api/outlines/:id/confirm | `{version}` | confirmed，版本不增加；同记录占用或版本冲突 409 |
| POST /api/generate-from-outline | `{outlineId,version}` | 旧 SSE progress/result/error/needs_input，仍要求已确认 |
| POST /api/generate | Brief | 旧 SSE 直接流程，仅为兼容 |
| POST /api/revise | `{runId,instructions,platforms?}` | 旧 SSE，创建新 runId/revision，不覆盖旧稿 |
| GET /api/sample | 无 | 旧 demo RunResult，需有可用本地资料 |
| GET /api/history | 可选 `includeDeliveries=1` | 默认 `{items:HistoryItem[]}` 不变；显式参数新增 `deliveries:ChannelDelivery[]` |
| GET /api/runs/:id | 可选 `includeDeliveries=1` | 默认 `{result,outlineSnapshot?,history,renderBundles}` 不变；显式参数新增 deliveries |
| GET /api/runs/:id/deliveries/:platform | platform 枚举 | **已接入** `{delivery}`；已有完整旧稿可按快照惰性建立独立交付，不调用文案模型 |
| GET /api/deliveries/:id | UUID | **已接入** `{delivery}`；七天独立正文、审核、有效成品及外部设计状态 |
| POST /api/deliveries/:id/rerender | `{idempotencyKey,visualMode?,regenerateVisual?,templateId?}` | **202 `{job}`**；visualMode 默认 local，canva 走专业视觉；regenerateVisual 默认不重生成，仅显式 true 再生图 |
| POST /api/deliveries/:id/canva/sync | `{idempotencyKey}` | **202 `{job}`**；读取已导入工程并回收导出；内容改变先撤销资格 |
| GET /api/integrations/canva | 无 | **已接入** CanvaConnectionStatus：configured/connected/message/redirectUri? |
| POST /api/integrations/canva/connect | `{}` | **已接入** `{authorizationUrl,expiresAt}`，state/PKCE 有效 10 分钟；账号本人前往授权 |
| GET /api/integrations/canva/callback | OAuth code/state 或 error，由 Canva 重定向 | **已接入** 后端消费一次性 state 并交换令牌，成功 302 到 `/#workbench`；不要手工归档/复用回调查询串 |
| POST /api/integrations/canva/verify | `{}` | **已接入** `{connected:true,checkedAt,tools}`；只读验证 REST 元数据权限及 MCP 实时工具参数，不代表完整设计验收 |
| POST /api/integrations/canva/disconnect | `{}` | **已接入** CanvaConnectionStatus；立即清本机令牌，尽力远端撤销；远端未确认时 message 明示 |
| GET /api/render-templates | 无 | `{templates:RenderTemplate[]}`，公众号画幅变为 1200×510，朋友圈名称更新为原图 |
| POST /api/render | RenderRequest | 旧同步本地 RenderBundle；Canva 后台执行优先使用 /api/jobs，不把旧同步接口当作外部设计调度器 |
| GET /api/render-assets/:handle | 可选 download=1 | 成品字节；禁正式导出 409、过期 410；HTML 严格 CSP，未终审清洁预览依然受下载门禁 |
| GET /api/assets/:handle | 无 | 原始素材受控句柄；不接受任意 URL 或本地路径 |

### 3.1 输入、幂等与冲突

`JobSubmit = JobInput + idempotencyKey`，key 为 8–120 位字母数字及 `._:-`。kind=outline 带 brief；outline-revise 带 outlineId/version/instructions 及可选 platforms；generate 带 outlineId/version 及可选 renders（每所选渠道恰一项；确认大纲标题序号固定 0）；render 带 request。新 RenderRequest 可选 deliveryId、visualMode、canvaSync、regenerateVisual，参见类型快照。Canva/生图凭证不属于任务输入。

同 key/同输入返回原任务，异输入 409；不同 key/相同输入且仍排队运行合并别名。提交响应丢失先按 key 查回原任务，不盲目创建新付费任务。读取/订阅只查看任务；刷新、切换渠道、新建需求或历史阅读不会取消后台执行。只有显式 cancel 传播取消。

同一大纲在旧 SSE、Job 排队/运行以及取消清理中互斥；修改、确认、重试或重复生成返回 409。AI 修改只影响实际变更渠道，成功后 version+1，必须重新人工确认。正文与模型返修不能修改固定结构/事实引用/产品原图；结构错误 resolution=edit_outline，来源错误 refresh_evidence，不能通过无效正文返修解决。

### 3.2 数据与阶段

JobStatus 保持 queued/running/failed/interrupted/cancelled/completed。JobStage 新增 design/image/compose/canva_import/canva_edit/canva_export，仍保留 retrieve/outline/write/review/repair/recheck/render/publish。界面按渠道 stage/error 显示，不把另一个渠道错误挂在当前面板。

JobChannel 新增 deliveryId/delivery；BackgroundJob 新增 deliveryVersion=1 标识新交付行为。普通列表/SSE 可含 detailOmitted=true，前端必须 GET 详情后合并，不用缺省空数组覆盖已缓存正文/成品。JobEvent 仍是全局 snapshot，无部分 RunResult 事件。旧 SSE 的 progress/result/error/needs_input 名称不变，HTTP 200 也可能后续出现 error。

ChannelDelivery 含 id/runId/jobId?/platform/revision/createdAt/updatedAt/expiresAt/product/brief/draft/review/outline/copyText/evidenceStatus，status=ready/blocked/visual_pending，bundle 只返回有效的本渠道 rendererVersion=3 成品。正文审稿已通过但视觉失败为 visual_pending，保留文案供该渠道读取/复制；阻断渠道 copyText 为空。bundle.externalDesigns 和 delivery.externalDesigns 记录可编辑工程，设计导入成功后即保存引用，导出失败仍能恢复。RenderArtifact 新增 original；RenderBundle 新增 rendererVersion、deliveryId、externalDesigns、creativeAssets；preview/released/blocked 枚举保持兼容。

CreativeAsset.kind 固定 generated-visual，记录指定模型/网关、promptHash、skillVersion、关联 sourceImageIds、sha256、创建与到期时间；它与 EvidenceBundle 的真实来源图片分开存储，绝不充当同型号产品证据。ExternalDesign 含 id/editUrl/platform/status（imported/verified/exported/changed）、contentHash?/syncedAt?/expiresAt?。临时资源过期不会删除七天历史正文，也不会让读取自动续期。

## 4. 调用预算、业务错误与恢复

文本统一 Bearer + system/user + stream:true Chat Completions，读取 choices[0].delta.content，兼容非流式 JSON。单次默认 180 秒、配置最高 300 秒；排队时间不算调用时间。全局最多 4 个文本 HTTP，创作任务 2、独立排版任务 2；渲染内部 2 槽，小红书页面总并发 2；共享 Chromium、每任务独立 context、拒绝外网。生图独立并发 1，单次最多 300 秒；它使用 `/images/generations`，单次 n=1，不调用文本接口冒充生图。

正常四渠道文本约 12 次（大纲/正文/独立审稿各 4），AI 修改、返修、格式纠正与显式重试另计；不承诺费用下降。每文本节点 HTTP 尝试最多 2 次，429 退避和必要 JSON 格式纠正共享预算。已知账号池/额度/鉴权故障明确停止；524/504、断流、超时、网络和未知业务响应不自动重放。生图每次用户动作一次 HTTP 尝试，失败后不以另一个渠道为由自动重发。同任务重启不重复已确认成功素材，不因 HTTP 200 就当作结果已落盘。

HTTP 200 的 JSON `error`、失败业务状态及 SSE `error` 会解析具体服务商错误。`JobError` 新增可选 category/providerCode/providerType/providerMessage/requestId/diagnosticId，均经脱敏限长，区分 authentication/quota/rate_limit/capacity/protocol 等类别；未知错误可能 outcomeUnknown=true，用户主动重试可能再计费。ModelCallRecord 保留 queueMs、firstResponseMs、firstContentMs、maxIdleMs、totalMs、attempt、upstreamStatus、requestId 与可用 usage；上游未提供即缺省，界面显示未知，不能填 0。

正文、审稿、设计简报、图片、PPTX、Canva 导入、MCP 编辑与导出分别持久检查点。审稿失败只续审稿，不重写正文；视觉失败只续视觉，不重写成功文本。视觉和文本配置独立指纹，新增 IMAGE Key 不使朋友圈或已成功文本失效。检查点与模型、渠道内容、完整事实条件、来源绑定、Prompt/Skill 版本及文件校验值匹配；不一致明确冲突，不静默复用旧文件。

付费派发标记在 HTTP 前同步提交；HTTP 成功但未保存有效结果仍属不确定。重启未派发步骤可继续；已派发而结果未落盘标 interrupted，需显式 retry。Canva 导入已派发但没拿到远端 job ID，或编辑/导出提交未确认，不自动重复提交。令牌刷新未知时要求重新授权。导出失败保留远端设计与原始 expiresAt，可用同步入口恢复，不重新生图。

## 5. Canva 与专业视觉实现

`server/design/` 内固定版本 `virgo-visual-1.0.0` 的运行时模块实际编译 Prompt。保留 canvas-design（Apache-2.0）、meitu-poster（MIT）、baoyu-xhs-images 与 baoyu-markdown-to-html（MIT）的上游原件、提交和许可证；启动校验 SHA-256。只采用构图、创意简报、系列卡片与微信排版方法；不调用它们的登录、发布或其他生图后端。

设计简报必填受众、场景、目标、渠道画幅、页面职责、视觉概念、产品/标题/正文区域、安全边距、阅读顺序、色板、字体层级、光线材质、一致性和禁止项；缺字段 422。图片模型只输出无产品/无文字/无 Logo 的场景背景。中文标题、正文、行动区和真实产品原图由 pptxgenjs 分层构建。产品原图等比放置，不重画机型；背景跨画幅通过保比例裁切重构，不拉伸。

后台通过 Canva 官方 REST 二进制导入 PPTX，不把 localhost 文件伪装为公开导入 URL。随后 MCP 实际读取设计内容、开启编辑事务、替换独立标题占位层为精确中文、提交事务、再核对中文与图片层并导出。签名导出 URL 仅在内存中立即回收为本机 PNG/ZIP，不保存为长期成品地址。远端响应“200”或OAuth connected 都不能替代字体/换行/真实图层/导出文件验收。

“在 Canva 编辑”打开受控官网 editUrl。“同步编辑结果”比较文本与产品/图片层内容指纹；只改变版式可复用正文审稿，文字或产品素材变化先撤销该渠道导出，再返回大纲重新核对与审稿。同步不会扩大原有效期，不自动发布到微信、小红书或朋友圈。

## 6. 图片校验、历史与临时资源

当前真实原图边界：小红书 1–6、公众号 1–4、朋友圈 1–3、海报 1。源图必须同产品、不同 ID、有效且归属正确。取证后立即验证最低数量，失败 422，模型大纲调用为 0；生成/保存/确认/渲染共用校验。小红书成品 3–6 页不等同源图最少 3 张，背景不能增加源图数量；前端展示 /task-options 的数量要求、禁选超量、无效时禁确认。

`.local-state/` 原子 JSON、单写者锁；不新增数据库。大纲从成功保存保留 7 天，完整成稿从生成完成起保留 7 天，渠道正文/审核独立保存 7 天，Job 从提交起 7 天；历史绑定实际确认的大纲快照，不用当前新版本替换。读取不续期。坏记录保留并报错，不清空历史，不覆盖旧版。

成品、生成素材、Canva 导出/导入本机临时文件和 ima 证据保持 30 分钟原始期限；重启、读、缓存、迁移或同步均不自动续期。记录仍有效的原始expiresAt，清理在受控目录进行；历史正文与素材出处元数据可保留，但过期图片字节不冒充有效资源。本地资料/原图变动或 ima 过期后历史仍可读，依赖新证据的操作返回 410/明确提示；重新策划创建新大纲，不覆盖旧稿。

## 7. 错误、前端适配和验证

| 状态 | 典型含义 |
| --- | --- |
| 400 | Schema/未知字段/非法幂等键/OAuth state |
| 403 | Host、同源写保护或上游权限 |
| 409 | 版本/确认/同记录占用、绑定配置变化、下载门禁、外部内容改变、未知操作待同步 |
| 410 | 历史/成品/来源/素材过期或来源改变 |
| 413 | JSON 超过 256KB |
| 422 | 缺必填需求或同型号原图、Canva 未配置、文字容量不足 |
| 429 | 旧接口并发或排队上限 |
| 499 | 显式取消 |
| 502/503/504 | 上游协议/网络、损坏存储/缺渲染运行时、本地渲染上限；以 JobError 区分网关 524 与本机超时 |

前端须新增 JobStage 映射，按 `channel.delivery` 展示成果，隔离本渠道错误；不能等整组 completed 才开放已完成渠道，也不能因 visual_pending 丢弃成功正文。原图 original 不按拼图画幅渲染；遍历 artifacts；公众号复制富文本，封面单独下载。Canva 接入设置只显示状态并打开授权链接，浏览器不读/写 Secret 或 Key。参考 [src/ChannelDeliveryPanel.tsx](src/ChannelDeliveryPanel.tsx)、[src/CanvaConnection.tsx](src/CanvaConnection.tsx)、[src/WorkflowApp.tsx](src/WorkflowApp.tsx)、[src/BackgroundTasks.tsx](src/BackgroundTasks.tsx) 与 [src/api/client.ts](src/api/client.ts)。

默认测试必须经 `tests/setup.ts`：每 worker 临时模拟库、独立数据目录、无真实 .env.local，未模拟外网禁止。运行 `npm test`；单文件用 `node --import tsx --import ./tests/setup.ts --test ...`。新增用例覆盖 HTTP 200 业务错误/脱敏、图片并发及未知结果、Canva OAuth/MCP/导入编辑导出、独立门禁/旧稿清理/原图字节、PPTX 分层与完整 Prompt。只执行离线 Mock 并不能宣称真实 OAuth 或模型别名已经可用。最终实际结果与未完成事项以 [README](README.md) 及 [本轮验收记录](verification/acceptance.json) 为准。

[205701 完整交接](../2026-10-22-205701/frontend-handoff.md) 保留独立交付落地时的协议与历史验证；更早的全渠道门禁和水印以各旧版原件为准。每份历史归档只读；本轮未自动 Git 提交或推送。

## 8. 本轮实时预检、账号绑定与真实验收

本轮不新增浏览器裸生图代理，也不绕过队列。既有 `POST /api/integrations/canva/verify` 将连接实时 MCP、检查所需工具 input schema，并执行 REST 只读能力验证。服务端校验 REST 元数据读取、MCP 初始化与工具实时参数；只读预检不得创建、修改、导入或导出设计，也不得触发生图。

付费派发前再次核对当前 Canva 账号授权身份。排队等待期间重新授权/换账号时，不把旧任务转交新账号或消耗生图；已成功正文与检查点保持。可编辑图片层必须有真实 editable 标志及可定位 element_id；仅图像数量或 API 200 不能证明产品层可编辑。本轮代码要求可定位且可编辑的图片层数至少达到预期图片层数（最低为 1）；不再只凭任意一层可编辑就通过。对应真实导入结果仍须另行验证。编辑后继续核对图片与文字内容，发生不可确认变化时阻断交付。

计划的一次真实四渠道联调尚未开始，必须在本人完成新目标授权并通过预检后，才可统计阶段耗时、调用次数、首预览、审核、Canva 导入/MCP 读取/一次实际编辑/导出回收与产品/中文图层验证。未实际发生的步骤必须记录未执行；OAuth 已连接不能代替它们。只接收脱敏汇总，不归档原产品素材、成稿正文、主本地状态、OAuth code/state/授权链接、令牌或临时资源地址。

实际测试、付费情况、真实端点结果和限制已写入 [verification/acceptance.json](verification/acceptance.json)。当前状态是离线通过、新目标 OAuth 已连接但 MCP 初始化仍返回上游 500；真实付费与设计写入调用为 0；此处准备流程不算真实验收通过。

### 8.1 预检诊断响应

`POST /api/integrations/canva/verify` 成功形状保持 `{connected:true,checkedAt,tools}`；Canva 类型失败由原 `{message}` 兼容扩展为包含 code、diagnosticId、phase?、upstreamStatus?、providerCode?、requestId?、retryable、outcomeUnknown 的 `CanvaVerificationError`。phase 标识 OAuth/REST/MCP 的安全失败阶段，requestId 只返回服务商提供且通过安全格式校验的请求号；未提供时省略，不编造值。共享类型和接口实现已按本轮冻结源码同步；真实阶段结论另见验收记录。普通错误处理仍保留 `{message}`，不能假设所有 HTTP 错误都有完整诊断字段。当前只读预检的上游 5xx 会标为可主动重试，`outcomeUnknown=false` 表示没有设计写入结果待确认，不代表预检成功；不自动重试。

响应只返回安全分类/状态/限长代码和本机诊断号，不回传原始 provider body、令牌、用户设计列表或资源 URL。预检中的 MCP initialize/tools-list 与 REST designs 元数据读取都属于只读；502/503 等仍不能直接证明哪项设计写入能力已经通过。


本轮旧目标中间实测：Canva REST 元数据读取返回 200；MCP initialize 在 `2025-03-26`、`2025-06-18`、`2025-11-25` 三个协议版本下均返回上游 HTTP 500 / internal_error，未到 tools/list。因此未发起生图、设计导入、编辑或导出。具体网关/应用原因仍待确认，不把这组错误归因于单个协议版本，也不把已授权记为 MCP 完整验收。


### 8.2 MCP 授权目标与旧授权兼容

后端固定使用 `resource=https://api.canva.com/connect/v1/mcp`，在授权 URL、授权代码交换和刷新请求三处携带；配置指纹包含该目标、`mcp-resource-v1` 授权版本和三个 scopes。authorizationResource、authorizationVersion 只作为后端绑定信息，不把 Token 交给浏览器。目标与权限绑定依据 [MCP 授权规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#resource-parameter-implementation)。

升级前缺少上述目标/版本的令牌与 pending state 保留原记录，但不自动升级、不自动刷新，也不计为已连接。`GET /api/integrations/canva` 返回 `configured=true,connected=false` 和重新授权提示；`POST /api/integrations/canva/verify` 在此状态返回 422/CANVA_NOT_CONNECTED，不能绕过它先消耗生图。旧回调不满足新配置指纹/目标时返回 400/CANVA_OAUTH_STATE，从工作台重新发起连接并由账号本人允许一次；不需要重新输入现有生图 Key 或应用 Secret。

同一授权会话刷新 Token 保持 connectionId，重新授权产生新的身份。视觉队列在创建及实际生图派发前核对绑定；账号、目标或应用配置变化会停止旧任务，不静默转交到另一账号。已成功的正文和审稿不因此重写。

旧 OAuth 与 REST 成功不能证明新目标授权已经成功，也不能确定原 initialize 500 的最终原因。加入 resource 修复本地协议缺口；是否消除上游错误以重新授权后的实际 MCP 预检为准。配置文件优先级、隐藏输入和具体操作见 [本机配置指引](docs/setup/visual-integrations.md)。

### 8.3 一次真实验收脚本与离线复验

新增 [scripts/verify-visual-workflow.ts](scripts/verify-visual-workflow.ts) 仅连接已运行的本机服务，不读取环境密钥、不重启后端、不额外探测生图、不自动失败重试。先 `--execute` 做只读预检并生成待确认大纲，阅读本机私有输出后，显式 `--execute --confirm-outline` 才确认该版本并继续同一组任务。持久幂等键、未知提交查回与运行锁避免重复整组派发；重复执行读取/恢复同一组，不盲目重建付费任务。脚本内容本身不算真实验收已经执行。

脚本的运行状态、真实产品、正文和成品只写入 Git 忽略的 `output/visual-verification/`，不复制到接口归档；归档仅保存由主代理明确脱敏的统计。本轮真实进展为旧目标预检失败；用户随后完成新目标授权，后端确认 connected=true，但新目标 MCP 初始化仍返回 500。未发生付费文本/图片或 Canva 导入/编辑/导出，最后官方 SDK 只读对照也在 initialize 返回 500，未进入工具发现。

`npm test` 现为 `--test-concurrency=2`，用于限制独立测试 worker 并发，缓解并行 Chromium 页面加载超时；生产模型 4 槽、创作 2 槽、排版 2 槽与生图 1 槽没有变化。初次全套超时、单文件复验和受限并发完整复验分别记录；最后一轮 257/257、失败 0、跳过 0，耗时 73216.638403ms。真实产品质量仍未验收。可人工参考 [Canva 支持摘要](verification/canva-support-summary.md)；本轮没有自动发送工单。


### 8.4 本版最终验证与未完成事项

完整离线 257/257、失败 0、跳过 0；随后顺序生产构建（含 tsc）通过。初次全并发并行构建时的 Chromium setContent 超时（254/255）、单文件 6/6 和最终受限并发通过分别保留为实际过程，不把初次超时当作最终测试失败。测试 worker 并发 2 不改变业务并发。

真实情况：用户确认同一开发应用 MCP 开启后，旧授权 21:42:07 只读预检仍在 2185ms 返回本机 502/上游 500、internal_error、mcp.initialize；此前 REST 元数据 GET 200。新 resource 代码加载后一度为 `configured=true,connected=false`；用户随后完成新授权并确认 connected=true。北京时间 21:57:50 的预检耗时 2416ms，仍返回本机 502/上游 500、internal_error、mcp.initialize，outcomeUnknown=false；未到 tools/list。本轮付费文本/生图、Canva 导入/读取设计内容/真实编辑/导出均未执行，不再要求循环授权。不能从旧 REST 成功、离线测试或准备好的验收脚本推断新目标授权、MCP 或四渠道真实品质通过。


最终独立对照：官方 `@modelcontextprotocol/sdk@1.32.1`、协议 `2025-11-25`，北京时间 22:07:13.403，仅一次 POST initialize，HTTP 500／1211ms，总耗时 1270ms；现有 Token 只在内存头中使用，没有 OAuth 或刷新，未完成初始化或进入 tools/list，业务工具 0。SDK 仅数值 code=500，未提取 providerCode，不沿用项目客户端的 internal_error 字段。对照记录见 [安全 SDK 统计](verification/canva-sdk-comparison.json)；根因仍未确认，未继续循环授权或请求付费试验。257 项离线测试和生产构建通过不能替代未发生的 Canva 真实导入、编辑、导出或四渠道品质验收。
