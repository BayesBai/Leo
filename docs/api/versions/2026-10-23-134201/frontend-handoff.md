# 前后端接口交接说明

版本 **2026-10-23-134201**，北京时间 **2026-10-23T13:42:01+08:00**。以上一完整版本 [2026-10-23-130003](../2026-10-23-130003/README.md) 的现行接口为起点；代码基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`，包含工作区未提交实现。

**本版接口有变更，当前前端已同步。** 新增按渠道视频任务、HTML 制作模式、独立 videoBundle、MP4 元数据及 Range 读取；旧 JSON/SSE、完整 RunResult、原图交付和 Canva 接口保留。共享协议见 [shared/types.ts](shared/types.ts)，严格输入见 [server/schemas.ts](server/schemas.ts)，另有[完整 HTTP 样例](api-examples.http)、[纯模拟夹具](fixtures/frontend.mock.json)和[实际验证记录](verification/acceptance.json)。源码快照仅供阅读，不能作为独立可运行工程。

## 1. 启动、配置与边界

Node.js >=22.12；`npm ci`、`npm run setup:render`、`npm run dev`。生产为 `npm run build` 后 `npm start`，默认本机 `http://127.0.0.1:3000`，以终端打印为准。setup:render 下载 Chromium，中文字体随工程保留；可选短视频额外要求 PATH 中存在支持 libx264 的 `ffmpeg` 与 `ffprobe`，已有工具不重复安装，npm 不安装它们。缺少视频工具不妨碍图文。

`server/start.ts` 才读取 .env.local/.env；导入 createApp 不读取本机秘密文件。测试预载 tests/setup.ts：独立临时模拟知识库、数据和渲染目录、假凭证、禁止未模拟外网。网页 `?mock=ok/slow/blocked/error/needs_input/empty/expired/conflict/disconnected/insufficient-images` 是浏览器内存模拟，刷新会清空其模拟服务；真实后端恢复语义由持久队列测试验证。Mock 原生播放示例是明确标识的 240×426／20 秒／30fps 几何 MP4，不代表生产设计效果。

保留当前文本模型、网关与 Key；配置示例仍为 `LLM_MODEL=gpt-6.1-sol`、`LLM_BASE_URL=https://relay.nccnxta.cn/v1`。文本统一 OpenAI 兼容 Chat Completions、Bearer、system/user；生图独立 `IMAGE_MODEL=gpt-image-2.5`、`IMAGE_BASE_URL=https://relay.styxgate.top/v1`，凭证仅留后端。此处为代码默认与契约，不是重新核验本机秘密配置。任何真实调用结论以本版实际验证为准。

服务仍为本机单操作者模式；Host 仅本机或 HOST 显式允许主机，写 Origin 同源，独立 Vite 代理保留 Host。JSON 最大 256KB；strict Schema 拒绝未知字段，非 strict 内嵌对象按 Zod 处理。页面配置仅进程内存，跨网关须同时提交新网关 Key；任务运行/清理期间连接变更409。Key、Secret、Token、PKCE verifier、授权 code/state、真实素材与签名 URL 不进入浏览器存储或文档。

## 2. 工作流与四渠道交付

Brief → 分渠道大纲并行 → 合并 editing → 人工保存或 AI 修改（version+1、撤销确认）→ 确认当前版 → 后台正文、规则、独立审稿、必要且最多一次正文返修与复审 → 独立 ChannelDelivery → 本渠道成品。确认不触发正文；固定标题、段落 ID/顺序/标题、引用与产品图只能返回大纲修改。RunResult 只代表完整稿件集，部分成果使用 ChannelDelivery；一个渠道失败不撤销其他通过渠道。

真实原图数量为小红书1–6、公众号1–4、朋友圈1–3、海报1，均须同型号、不同ID且归属有效；取证后立即检查最低数量，不足422且大纲模型调用0。生成、保存、确认和渲染共用校验，前端按task-options显示要求并禁选超量。小红书3–6张最终卡片不等于必须3张源图，AI背景不能满足原图最低要求。

| 渠道 | 制作源与最终交付 |
| --- | --- |
| 公众号 | 微信兼容内联 HTML、可复制富文本、1200×510 封面、配图及制作源 ZIP；杂志阅读/清单手记两类版式，正文保留真实文字，不转为整张长图。 |
| 小红书 | 固定画幅 HTML/CSS、原图和精确中文分别排版；独立封面加信息分组内页，共3–6张1080×1440 PNG，附标题、正文、话题与制作源，无固定泛化结束页。 |
| 朋友圈 | 自然文案及1–3张同型号原图，format=original，保留原字节、MIME和比例，不生图，不改为文字拼图。 |
| 门店海报 | 保留既有本地重排与 AI背景/真实产品图/精确中文/PPTX/Canva 路线，1080×1920，本轮不改其制作流程。 |

新提交 generate 在持久任务上固定 rendererMode=html，仅作用公众号/小红书；该内部字段不是浏览器提交字段。既有持久任务缺少该字段时继续旧 renderer，不因重启或读取转换、重发请求或改写成品。用户主动“重新排版”显式提交 visualMode=html 才采用新制作源；local/canva 继续兼容。新 HTML/视频 rendererVersion=4；历史 rendererVersion=3 干净成品继续读。读取不会给旧水印成品去标签。

公众号和小红书默认排版不经过秀米或 Canva。模型创作且已配置生图时 HTML 路线可生成无产品/无文字背景，成功后持久复用；规则演示或未配置生图时普通排版使用本地设计背景。背景不充当产品证据。背景过期时普通重排明确410；显式 `visualMode:'html',regenerateVisual:true` 通过“重新生成背景并排版（可能再次计费）”请求新背景，不要求 Canva。模型创作显式重生而缺少Key时409/IMAGE_NOT_CONFIGURED，不将本地排版当作生图成功；规则演示始终不调用付费生图。旧 Canva 重生入口仍单独发送 canva+regenerateVisual。

ZIP 包含图文/文案、来源与审核附件、设计配置以及完整 HTML 制作源；HTML 内嵌完整图片和字体，使 source 文件可脱离临时句柄打开，静态源包另附原图、复用背景、字体及许可。不会把过期本机 URL 当作仍可编辑的源码素材。AI 环境与真实产品图始终分开；画面不嵌入审核水印、“发布前复核/本地资料/检查通过”等标签。必要适用条件仍跟随事实。版式检查文字溢出、图片等比、安全区和可读字号，不能靠截断或不可读缩字强行容纳。

公众号由用户复制富文本到微信，图片未自动上传微信素材库，必要时需独立上传配图再核对换行；不承诺所有图片随粘贴成功。小红书由用户上传 PNG 并粘贴文案。未接微信草稿箱、账号发布或视频平台自动发布。Canva 可编辑工程仅保留在旧版高级入口；OAuth connected 不表示此前 MCP 故障已修复，本轮新路线无需其授权。

## 3. 完整 HTTP 契约

没有统一 data/code 包装。普通错误 `{message}`，补充需求 `{type:'needs_input',message,fields:[{field,question}]}`。异步错误位于 job.error 及所属 channels[].error；提交202或读取200不代表模型、排版或视频已成功。

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
| POST /api/deliveries/:id/rerender | `{idempotencyKey,visualMode?,regenerateVisual?,templateId?}` | **202 `{job}`**；visualMode兼容默认local；前端公众号/小红书显式html；html+regenerateVisual:true独立背景重生，不要求Canva |
| POST /api/deliveries/:id/video | `{idempotencyKey}` | **新增202 `{job}`**；kind=video，固定20秒；要求有效released图文、证据及审核，成功结果在videoBundle |
| POST /api/deliveries/:id/canva/sync | `{idempotencyKey}` | **202 `{job}`**；读取已导入工程并回收导出；内容改变先撤销资格 |
| GET /api/integrations/canva | 无 | **已接入** CanvaConnectionStatus：configured/connected/message/redirectUri? |
| POST /api/integrations/canva/connect | `{}` | **已接入** `{authorizationUrl,expiresAt}`，state/PKCE 有效 10 分钟；账号本人前往授权 |
| GET /api/integrations/canva/callback | OAuth code/state 或 error，由 Canva 重定向 | **已接入** 后端消费一次性 state 并交换令牌，成功 302 到 `/#workbench`；不要手工归档/复用回调查询串 |
| POST /api/integrations/canva/verify | `{}` | **已接入** `{connected:true,checkedAt,tools}`；设计操作只读预检；可先执行一次符合条件的旧 grant 升级，详见第9节，不代表完整设计验收 |
| POST /api/integrations/canva/disconnect | `{}` | **已接入** CanvaConnectionStatus；立即清本机令牌，尽力远端撤销；远端未确认时 message 明示 |
| GET /api/render-templates | 无 | `{templates:RenderTemplate[]}`，公众号画幅变为 1200×510，朋友圈名称更新为原图 |
| POST /api/render | RenderRequest | 兼容同步RenderBundle，html可本机排版；付费背景与Canva须经后台Job，不以同步路由绕过检查点 |
| GET /api/render-assets/:handle | 可选 download=1 | 成品字节；禁正式下载409、过期410；HTML严格CSP；MP4单段Range为206，无效Range416 |
| GET /api/assets/:handle | 无 | 原始素材受控句柄；不接受任意 URL 或本地路径 |

### 3.1 提交、幂等与视频前置

JobSubmit=JobInput+idempotencyKey，key为8–120位字母数字与 `._:-`。kind 包含 outline、outline-revise、generate、render 和新增 video。outline带 brief；outline-revise带 outlineId/version/instructions/platforms?；generate带 outlineId/version/renders?（每所选渠道恰一项，确认标题序号固定0）；render带 RenderRequest；video仅带 deliveryId。队列先原子持久化再202，不在提交连接等待模型或视频。

`POST /api/deliveries/:id/video` body严格为 `{idempotencyKey}`，等价后台 `{kind:'video',deliveryId,idempotencyKey}`；不能附 duration、提示词、任意 HTML、URL 或替代模型。只允许公众号/小红书，需渠道未阻断、当前证据与原图有效、存在 released且未到期静态bundle。静态未交付/过期410，审核/版本冲突409，不支持渠道422。该前置在提交、执行及发布前核对。

同key同输入返回原任务，异输入409；不同key相同输入仍排队/运行时合并别名。提交响应丢失必须先按原key查询，不盲目新建或自动付费重试。cancel只取消指定任务，关闭订阅/切页/刷新不会取消。retry仅failed/interrupted且可重试；不可重试、版本、配置或来源冲突明确返回409/410。视频不调用模型，重试不要求文本凭证指纹一致，但仍核对原渠道/证据/设计指纹。

### 3.2 数据类型与历史兼容

RenderRequest.visualMode新增 `'html'`，原 `'local'|'canva'` 保留；regenerateVisual仍为显式付费视觉重做，不能解释为重写正文。独立rerender HTTP缺省仍local，当前公众号/小红书前端显式传html。JobInput新增 `{kind:'video',deliveryId:string}`；JobStage新增 storyboard/video_render/video_encode，JobChannel.progress可选 `{completedFrames,totalFrames}`，其他状态枚举不变。

RenderArtifact.role新增video、format新增mp4；可选 durationSeconds/fps/frameCount，与既有width/height/sourceImageIds/factIds并存。RenderBundle新增可选kind=`static|video`、sourceFingerprint；缺省kind视作旧静态。ChannelDelivery新增独立videoBundle，原bundle继续只表示图文；BackgroundJob.videoBundle表示视频结果。视频不放入job.renderBundles，不替换静态bundle，不把部分结果伪装为RunResult。getRunBundles及默认RunDetail.renderBundles保持静态集合，渠道详情或显式includeDeliveries可读视频引用。

JobStatus仍queued/running/failed/interrupted/cancelled/completed。普通列表及SSE可detailOmitted=true，省略终态正文、频道成品、calls/renderBundles/videoBundle；前端选中后GET详情，只保留同updatedAt的完整缓存，不用紧凑空数组覆盖有效详情。JobEvent仍 `{type:'snapshot',jobs}`；旧正文SSE progress/result/error/needs_input保持，HTTP200之后仍可能error。

CreativeAsset.kind仍generated-visual，保存模型、网关、Prompt/Skill版本、原图关联及sha256，不混入事实证据。ExternalDesign仍保存受控Canva编辑地址与状态。浏览器只保存选择的任务/记录ID与待确认提交的幂等键，不保存正文、凭证或完整任务输入。

### 3.3 MP4、资源与审核门禁

MP4通过原 `/api/render-assets/:handle` 预览与 `?download=1` 正式下载。MIME=`video/mp4`，返回Accept-Ranges:bytes；无Range为200，合法单段 `bytes=start-end`、`bytes=start-`、`bytes=-suffix` 为206及Content-Range/Content-Length；非法、多段或越界416及`Content-Range:bytes */size`。先执行句柄/期限/审核校验，再处理Range，不能用Range绕过下载门禁。

渠道阻断时正式复制/downloadUrl/zipUrl关闭，直接请求正式下载仍409；撤销渠道会同时关闭静态、视频及ZIP资源。needs_attention保留工作台警告但可交付。预览链接不等同发布授权。资源过期410；未知句柄410/原图不存在404，不能拿全零模拟句柄当有效下载验证。

## 4. 视频执行、设计规则与恢复

视频固定1080×1920、30fps、600帧、20秒、无声H.264/yuv420p/faststart，另有封面。分镜为0–4秒标题、4–16秒最多两个信息点、16–20秒CTA。仅选择已审核完整短句；每条事实携带完整适用条件并同屏呈现。标题/CTA或事实句及条件无法清楚容纳时422/VIDEO_COPY_TOO_LONG，要求精简后重新审核，不偷偷摘掉条件或调用模型压缩。

以HTML/CSS+本地GSAP暂停时间线，通过seek(frame/30)确定性生成600帧；截图按写入背压送FFmpeg。与静态共享Chromium进程，每任务独立context、拒绝所有外网；总页面槽2，视频并发1、占一个槽。另一个静态任务可继续。视频本地上限10分钟，覆盖等待/绘制/编码/探测；取消关闭本任务context、终止编码/探测进程、清理临时目录，不关闭兄弟context。编码后ffprobe校验尺寸、时长、帧数、帧率、编码与无音轨，失败不发布半文件。

视频提交时冻结静态bundle、标题、正文、产品、审核、证据、背景校验值、设计/Skill版本与视频规格指纹；执行与发布再次核对，制作期间重排或审核变化409。视频只复用已有素材，不发文本/生图请求。有效同指纹视频缓存可复用，保持原expiresAt；失败只重跑视频本地阶段，不重写成功正文/审稿/背景。中断本地帧不是付费调用，重启可重做其本地计算；未确认付费步骤仍interrupted，不自动重发。

固定设计规则`virgo-html-1.0.0`与视频`html-gsap-video-1`在服务端实际使用，不靠安装开发客户端Skill宣称接入。premium-animations负责视觉层级/色彩/留白；ui-animation负责节奏/可读性；GSAP官方skills负责可seek时间线；html-animation负责自包含HTML与确定性导出方法。具体上游提交、SHA-256、许可证见 [vendor manifest](server/design/vendor/manifest.json)、[设计说明](server/design/README.md)、[渲染声明](server/render/THIRD_PARTY_NOTICES.md)。不执行这些Skill的登录、发布或其他生图后端。

原文本与生图预算保持：最多4个文本HTTP、2个活跃创作、2个独立排版，生图并发1/300秒；文本单次180秒，配置最高300秒。正常四渠道约12个文本节点；每节点最多2次HTTP，429有限退避与格式纠正共享预算；524/504/网络/断流/未知业务错误不自动重发。共享背景在跨不同render job的素材指纹锁内检查缓存和派发；creativeRequests持久记录未确认派发/失败，未显式重试或重生时不以新任务绕过未知结果再次计费，记录按七天策略清理。HTTP200内JSON/SSE业务错误仍分类、脱敏，usage未提供时未知，不填0。视频新增模型调用数为0。

Canva旧入口继续本人OAuth、REST/PPTX二进制导入与MCP真实读取/编辑/导出；此前授权或REST成功不代表MCP初始化500已解决。本轮不为新HTML路线重试Canva账号授权，不把旧诊断计为本轮新验证。远端签名导出仅内存回收为本机资源。配置指南保留在 [docs/setup/visual-integrations.md](docs/setup/visual-integrations.md)。

## 5. 期限、前端适配与验证

大纲自保存、完整成稿自生成完成、独立渠道正文/审核及Job按既有七天策略保存；每份稿保留确认的大纲快照。读取不续期、旧稿不套用后续大纲。证据、原图、背景、图文/视频/ZIP按三十分钟临时策略保存，视频到期不晚于所复用静态和背景的原期限。重排有效旧成品、缓存命中、重启、读取及同步不延期；背景过期需主动重新生成，不隐式付费。来源变化或过期时历史正文可读，依赖新证据的操作明确410。

`.local-state/`原子JSON、串行写入，无数据库；坏记录保留并报503，不清空。成功阶段检查点持久保存；付费派发标记在HTTP前落盘，只有成功结果原子检查点才清除。重启不会把未完成任务算成功，不重发未知付费结果。新旧renderer选择持久，不能按进程当前默认改写旧排队任务。

前端公众号/小红书默认HTML，提供“下次排版风格”“重新排版”“重新生成背景并排版”和独立“生成视频”。Canva旧入口折叠；海报/朋友圈保持原行为。视频任务/错误/取消/续跑按本渠道显示，不锁复制、图文下载或其他渠道导航；后台完成仅更新所属记录，不抢导航。视频原生controls/playsInline、独立封面、MP4和制作源下载。选新标题需先重排确认静态版本，静态过期按钮明确提示。手机390×844按单列展示按钮和9:16视频。

状态重点：400 Schema/幂等键；403 Host/Origin；409版本/确认/占用/审核门禁/素材绑定；410历史/来源/成品过期；413请求超限；416无效Range；422需求/原图/文字容量/不支持视频渠道；429队列上限；499取消；502/503/504由结构化错误区分上游与缺运行时、损坏记录或本地超时。

最终 `npm test` **308/308通过，0失败、0跳过**，总耗时179407.800毫秒；最终`npm run build`通过（3.76秒，Mock懒加载块569.27kB仅体积警告），`git diff --check`通过。发布前10项门禁/重启/历史/队列定向检查通过。开发阶段首轮290项曾有2项失败，已定位修复后纳入最终308项全量通过，不将首轮失败记作通过。

离线覆盖HTML图文实际渲染、并发上限、跨render job背景单飞/未知结果不绕过、取消、视频版本/来源/过期、Range及附件损坏后撤销。完整纯模拟本机MP4耗时77.612秒、776699字节，1080×1920、30fps、600帧、20秒、H.264/yuv420p、无音轨；8个分镜/转场帧已抽检，模型调用0。存量已审核真实文案无付费本机重排：小红书5张16.711秒、公众号HTML及封面5.002秒，保留needs_attention；同份真实稿视频尝试668毫秒因VIDEO_COPY_TOO_LONG被阻止，**未通过真实稿视频验收**，未影响图文，模型调用0。

无活动任务时服务重启后jobs/history读取200（3个任务、2份历史，活动0）；有效小红书5图仍可读，失败视频仍保留VIDEO_COPY_TOO_LONG且无videoBundle。桌面及390×844手机Mock可切渠道、视频独立完成且20秒文件可解码；公众号手机全页iframe截图空白，仅记录可访问性正文树及独立HTML渲染，**不记为手机正文视觉验收通过**。微信后台粘贴、平台发布、真实ima、指定生图模型可用性及Canva端到端均未验收；本轮真实付费调用0，未修改env/Key，未提交或推送。

默认测试命令`npm test`；定向`node --import tsx --import ./tests/setup.ts --test ...`。本版验证只记录实际执行项，首轮失败及修复经过保留在验收记录，未把未执行平台粘贴、发布、真实ima或真实生图写为通过。完整模拟视频为确定性本机渲染，不是指定生图模型可用性证明；单次耗时不是固定性能承诺。

前端实现入口见 [src/WorkflowApp.tsx](src/WorkflowApp.tsx)、[交付面板](src/ChannelDeliveryPanel.tsx)、[视频面板](src/VideoDeliveryPanel.tsx)、[统一客户端](src/api/client.ts)及兼容 [src/App.tsx](src/App.tsx)。本地归档不等于Git提交或推送；历史版本与首次交接原件保持只读。最终校验见 [manifest.json](manifest.json)。
