# 前后端接口交接说明

版本 **2026-10-22-205701**，北京时间 **2026-10-22T20:57:01+08:00**。代码基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`；本次实现是此基线上的未提交工作区变更。以上一版 [2026-10-22-192658](../2026-10-22-192658/README.md) 的完整协议为起点更新。

**本次接口有变化**：新增独立渠道交付、视觉重排与 Canva 接入/同步；扩展任务阶段、错误诊断、生图与外部设计元数据；更新图片下限、原图交付及下载门禁。旧 Job、HTTP/SSE、大纲和历史默认响应继续兼容，旧消费者需适配新增枚举和独立交付语义。

本版只记录实际代码与纯模拟样例，不包含凭证、OAuth code、签名导出地址、真实产品原资料或真实运行任务。源码快照供阅读，不是独立可运行工程。最终测试、构建、手工检查与真实联调结果见 [本版 README](README.md)；未完成的真实授权/生图不计作通过。上一版的实测和截图仍在其原始归档，不作为本轮重跑。

共享数据见 [shared/types.ts](shared/types.ts)，输入约束见 [server/schemas.ts](server/schemas.ts)，完整请求见 [api-examples.http](api-examples.http)，全部新旧状态样例见 [fixtures/frontend.mock.json](fixtures/frontend.mock.json)。

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

响应没有统一 `data/code` 包装。常规错误 `{message}`；必要输入为 `{type:'needs_input',message,fields:[{field,question}]}`。Job 提交/读取成功不表示模型和视觉已经成功，异步失败见 `job.error` 和所属 `channels[].error`。

| 方法与路径 | 输入 | 响应/语义 |
| --- | --- | --- |
| GET /api/status | 无 | AppStatus；新增可选 image、canva，不含凭证；configured/connected 不等同真实完整验收 |
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
| GET /api/runs/:id/deliveries/:platform | platform 枚举 | **新增** `{delivery}`；已有完整旧稿可按快照惰性建立独立交付，不调用文案模型 |
| GET /api/deliveries/:id | UUID | **新增** `{delivery}`；七天独立正文、审核、有效成品及外部设计状态 |
| POST /api/deliveries/:id/rerender | `{idempotencyKey,visualMode?,regenerateVisual?,templateId?}` | **新增 202 `{job}`**；visualMode 默认 local，canva 走专业视觉；regenerateVisual 默认不重生成，仅显式 true 再生图 |
| POST /api/deliveries/:id/canva/sync | `{idempotencyKey}` | **新增 202 `{job}`**；读取已导入工程并回收导出；内容改变先撤销资格 |
| GET /api/integrations/canva | 无 | **新增** CanvaConnectionStatus：configured/connected/message/redirectUri? |
| POST /api/integrations/canva/connect | `{}` | **新增** `{authorizationUrl,expiresAt}`，state/PKCE 有效 10 分钟；账号本人前往授权 |
| GET /api/integrations/canva/callback | OAuth code/state 或 error，由 Canva 重定向 | **新增** 后端消费一次性 state 并交换令牌，成功 302 到 `/#workbench`；不要手工归档/复用回调查询串 |
| POST /api/integrations/canva/verify | `{}` | **新增** `{connected:true,checkedAt,tools}`；只读校验 MCP 连接与所需工具，不代表完整设计验收 |
| POST /api/integrations/canva/disconnect | `{}` | **新增** CanvaConnectionStatus；立即清本机令牌，尽力远端撤销；远端未确认时 message 明示 |
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

默认测试必须经 `tests/setup.ts`：每 worker 临时模拟库、独立数据目录、无真实 .env.local，未模拟外网禁止。运行 `npm test`；单文件用 `node --import tsx --import ./tests/setup.ts --test ...`。新增用例覆盖 HTTP 200 业务错误/脱敏、图片并发及未知结果、Canva OAuth/MCP/导入编辑导出、独立门禁/旧稿清理/原图字节、PPTX 分层与完整 Prompt。只执行离线 Mock 并不能宣称真实 OAuth 或模型别名已经可用。最终实际结果与未完成事项以 [README](README.md) 及 [验证记录](verification/offline-validation.json) 为准。

[上一版交接原件](../2026-10-22-192658/frontend-handoff.md) 保留当时的全渠道门禁、水印和旧图数描述，本版改动以上文为准。每份历史归档只读；本轮未自动 Git 提交或推送。
