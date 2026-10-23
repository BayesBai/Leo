# 前后端接口交接说明

版本 **2026-10-23-160001**，北京时间 **2026-10-23T16:00:01+08:00**。以上一完整版本[2026-10-23-155558](../2026-10-23-155558/README.md)为起点；代码基线`d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支`frontend/workbench`，保留既有未提交工作区。

**已核对，无接口变更。** 用户隐藏录入后，本轮加载ima配置并完成真实连接与一个型号图文取证。现有settings/verify均HTTP200，最终configured/verified均true；10条事实、6张原图的来源/产品绑定、图片字节/MIME/尺寸及证据期限检查通过。未使用本地资料替代。凭证仅由受控程序读取和使用，不回显或归档；原文/图片不进入交接版本，临时私有文件已删除。

本轮不修改业务代码、共享协议或前端，不调用文案/生图模型，不重启、部署或执行Git操作。完整现行协议保留如下。源码快照供阅读，运行使用完整项目。[本轮验收](verification/acceptance.json) · [ima指南](docs/setup/ima-knowledge-base.md) · [检查记录](ima-audit.md)。[原部署规划](deployment-plan.md)仍未实施；[生图迁移说明](image-provider-migration.md)及[其历史验收](verification/previous-image-acceptance.json)仅为上一轮证据。

## 1. 启动、配置与边界

Node.js >=22.12；`npm ci`、`npm run setup:render`、`npm run dev`。生产为 `npm run build` 后 `npm start`，默认本机 `http://127.0.0.1:3000`，以终端打印为准。setup:render 下载 Chromium，中文字体随工程保留；可选短视频额外要求 PATH 中存在支持 libx264 的 `ffmpeg` 与 `ffprobe`，已有工具不重复安装，npm 不安装它们。缺少视频工具不妨碍图文。

`server/start.ts` 才读取 .env.local/.env；导入 createApp 不读取本机秘密文件。测试预载 tests/setup.ts：独立临时模拟知识库、数据和渲染目录、假凭证、禁止未模拟外网。网页 `?mock=ok/slow/blocked/error/needs_input/empty/expired/conflict/disconnected/insufficient-images` 是浏览器内存模拟，刷新会清空其模拟服务；真实后端恢复语义由持久队列测试验证。Mock 原生播放示例是明确标识的 240×426／20 秒／30fps 几何 MP4，不代表生产设计效果。

保留当前文本模型、网关与 Key；配置示例仍为 `LLM_MODEL=gpt-6.1-sol`、`LLM_BASE_URL=https://relay.nccnxta.cn/v1`。文本统一 OpenAI 兼容 Chat Completions、Bearer、system/user；生图独立默认 `IMAGE_MODEL=doubao-seedream-5-0-pro-260628`、`IMAGE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3`，凭证仅留后端。此处为代码默认与契约，不是重新核验本机秘密配置。任何真实调用结论以本版实际验证为准。

服务仍为本机单操作者模式；Host 仅本机或 HOST 显式允许主机，写 Origin 同源，独立 Vite 代理保留 Host。JSON 最大 256KB；strict Schema 拒绝未知字段，非 strict 内嵌对象按 Zod 处理。页面配置仅进程内存，跨网关须同时提交新网关 Key；任务运行/清理期间连接变更409。Key、Secret、Token、PKCE verifier、授权 code/state、真实素材与签名 URL 不进入浏览器存储或文档。

## 2. 工作流与四渠道交付

Brief → 分渠道大纲并行 → 合并 editing → 人工保存或 AI 修改（version+1、撤销确认）→ 确认当前版 → 后台正文、规则、独立审稿、必要且最多一次正文返修与复审 → 独立 ChannelDelivery → 本渠道成品。确认不触发正文；固定标题、段落 ID/顺序/标题、引用与产品图只能返回大纲修改。RunResult 只代表完整稿件集，部分成果使用 ChannelDelivery；一个渠道失败不撤销其他通过渠道。

真实原图数量为小红书1–6、公众号1–4、朋友圈1–3、海报1，均须同型号、不同ID且归属有效；取证后立即检查最低数量，不足422且大纲模型调用0。生成、保存、确认和渲染共用校验，前端按task-options显示要求并禁选超量。小红书3–6张最终卡片不等于必须3张源图，AI背景不能满足原图最低要求。

| 渠道 | 制作源与最终交付 |
| --- | --- |
| 公众号 | 微信兼容内联 HTML、可复制富文本、1200×510 封面、配图及制作源 ZIP；杂志阅读/清单手记两类版式，正文保留真实文字，不转为整张长图。 |
| 小红书 | 固定画幅 HTML/CSS、原图和精确中文分别排版；独立封面加信息分组内页，共3–6张1080×1440 PNG，附标题、正文、话题与制作源，无固定泛化结束页。 |
| 朋友圈 | 自然文案及1–3张同型号原图，format=original，保留原字节、MIME和比例，不生图，不改为文字拼图。 |
| 门店海报 | 一张API原生1024×1536整图，含文字与产品外观。当前不输入参考图；预览无水印，三项人工核对后才开放正式PNG及来源ZIP，不附发布文案。 |

新提交generate持久固定rendererMode=html-v2：公众号/小红书HTML，海报poster-image，朋友圈原图。内部rendererMode不是提交字段。既有html/legacy任务按保存值读取；不能因重启自动转换或重发。外部设计任务已搁置，不继续执行，旧成功结果可读；旧失败任务不允许retry。用户主动按新模式另建任务。新海报rendererVersion=5，HTML保持4，视频使用html-gsap-video-2。

公众号/小红书可复用无产品/文字背景，真实原图及中文本机独立层。规则演示或未配置背景生图时可用本地背景；背景过期普通重排410，显式html+regenerateVisual:true才重新请求。显式live背景重生缺Key为409 IMAGE_NOT_CONFIGURED。海报与此不同：必须live且有独立IMAGE配置，整图API不传参考图片，不能假称产品外观被原图锁定；demo海报不调用付费服务，返回POSTER_REQUIRES_LIVE。

适用的ZIP包含图文/文案、来源与审核附件、设计配置以及完整 HTML 制作源；HTML 内嵌完整图片和字体，使 source 文件可脱离临时句柄打开，静态源包另附原图、复用背景、字体及许可。不会把过期本机 URL 当作仍可编辑的源码素材。HTML路线的AI环境与真实产品图分开；整图海报由模型同时绘制产品和文字，必须另行核对；画面不嵌入审核水印、“发布前复核/本地资料/检查通过”等标签。必要适用条件仍跟随事实。版式检查文字溢出、图片等比、安全区和可读字号，不能靠截断或不可读缩字强行容纳。

公众号由用户复制富文本到微信，图片未自动上传微信素材库，必要时需独立上传配图再核对换行；不承诺所有图片随粘贴成功。小红书由用户上传 PNG 并粘贴文案。未接微信草稿箱、账号发布或视频平台自动发布。网站不再提供外部编辑/授权/同步入口。旧ExternalDesign字段仅为历史兼容，不展示品牌状态、链接或可续跑按钮。

## 3. 完整 HTTP 契约

没有统一 data/code 包装。普通错误 `{message}`，补充需求 `{type:'needs_input',message,fields:[{field,question}]}`。异步错误位于 job.error 及所属 channels[].error；提交202或读取200不代表模型、排版或视频已成功。

| 方法与路径 | 输入 | 响应/语义 |
| --- | --- | --- |
| GET /api/status | 无 | AppStatus；可选image，当前省略canva，不含凭证；configured不等于完整验收 |
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
| POST /api/jobs/:id/retry | `{}` | `{job}`；仅failed/interrupted，另允许cancelled且script-v2视频继续；成功检查点复用；不可重试/配置或版本冲突409 |
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
| GET /api/deliveries/:id | UUID | **已接入** `{delivery}`；七天独立正文、审核、有效静态/视频成品及可选posterApproval |
| POST /api/deliveries/:id/rerender | `{idempotencyKey,visualMode?,regenerateVisual?,templateId?}` | **202 `{job}`**；visualMode兼容缺省local；公众号/小红书显式html，海报显式poster-image；regenerateVisual:true明确再生成 |
| POST /api/deliveries/:id/poster/approve | `{bundleId,artifactId,sha256,checks:{text,product,facts}}` | **新增200 `{delivery}`**；三项必须全true；原preview指针+hash绑定，正式PNG新句柄、无文案ZIP，TTL不续期 |
| POST /api/deliveries/:id/video | `{idempotencyKey}` | **新增202 `{job}`**；kind=video，固定20秒；要求有效released图文、证据及审核，成功结果在videoBundle |
| POST /api/deliveries/:id/canva/sync | `{idempotencyKey}` | **410** `EXTERNAL_DESIGN_PAUSED`；已搁置、零外呼，不返回授权链接/设计结果 |
| GET /api/integrations/canva | 无 | **410** `EXTERNAL_DESIGN_PAUSED`；已搁置、零外呼，不返回授权链接/设计结果 |
| POST /api/integrations/canva/connect | `{}` | **410** `EXTERNAL_DESIGN_PAUSED`；已搁置、零外呼，不返回授权链接/设计结果 |
| GET /api/integrations/canva/callback | OAuth code/state 或 error，由 Canva 重定向 | **410** `EXTERNAL_DESIGN_PAUSED`；已搁置、零外呼，不返回授权链接/设计结果 |
| POST /api/integrations/canva/verify | `{}` | **410** `EXTERNAL_DESIGN_PAUSED`；已搁置、零外呼，不返回授权链接/设计结果 |
| POST /api/integrations/canva/disconnect | `{}` | **410** `EXTERNAL_DESIGN_PAUSED`；已搁置、零外呼，不返回授权链接/设计结果 |
| GET /api/render-templates | 无 | `{templates:RenderTemplate[]}`，公众号画幅变为 1200×510，朋友圈名称更新为原图 |
| POST /api/render | RenderRequest | 兼容同步RenderBundle，html可本机排版；付费背景及整图海报须经后台Job；canva模式直接410，不以同步路由绕过检查点 |
| GET /api/render-assets/:handle | 可选 download=1 | 成品字节；禁正式下载409、过期410；HTML严格CSP；MP4单段Range为206，无效Range416 |
| GET /api/assets/:handle | 无 | 原始素材受控句柄；不接受任意 URL 或本地路径 |

### 3.1 提交、幂等与视频前置

JobSubmit=JobInput+idempotencyKey，key为8–120位字母数字与 `._:-`。kind 包含 outline、outline-revise、generate、render 和新增 video。outline带 brief；outline-revise带 outlineId/version/instructions/platforms?；generate带 outlineId/version/renders?（每所选渠道恰一项，确认标题序号固定0）；render带 RenderRequest；video仅带 deliveryId。队列先原子持久化再202，不在提交连接等待模型或视频。

`POST /api/deliveries/:id/video` body严格为 `{idempotencyKey}`，等价后台 `{kind:'video',deliveryId,idempotencyKey}`；不能附 duration、提示词、任意 HTML、URL 或替代模型。只允许公众号/小红书，需渠道未阻断、当前证据与原图有效、存在 released且未到期静态bundle。静态未交付/过期410，审核/版本冲突409，不支持渠道422。该前置在提交、执行及发布前核对。

同key同输入返回原任务，异输入409；不同key相同输入仍排队/运行时合并别名。提交响应丢失必须先按原key查询，不盲目新建或自动付费重试。cancel只取消指定任务，关闭订阅/切页/刷新不会取消。retry仅failed/interrupted且可重试，另允许已取消script-v2视频继续；不可重试、版本、配置或来源冲突明确返回409/410。新视频调用文本模型写短稿和独审，绑定提交配置；成功短稿及审核检查点可复用，编码重试不重新调用模型。同delivery及同文本/事实/审核指纹失败、中断或取消的v2再次POST仅alias原job，不自动派发；必须明确retry继续。显式retry可在文本指纹不变时重新绑定当前有效静态bundle，重新本地绘帧；首次排队/运行期间换版仍拒绝。取消有unknown调用时继续仍提示可能已付费。旧VIDEO_COPY_TOO_LONG须新key提交新video Job，不retry旧算法。

### 3.2 数据类型与历史兼容

RenderRequest.visualMode新增 `'poster-image'`，`'html'|'local'`继续；旧`'canva'`只保留类型但运行410；regenerateVisual仍为显式付费视觉重做，不能解释为重写正文。独立rerender HTTP缺省仍local，当前公众号/小红书前端显式传html。JobInput新增 `{kind:'video',deliveryId:string}`；JobStage增加video_script/video_review/video_repair/video_recheck，原storyboard/video_render/video_encode保留，JobChannel.progress可选 `{completedFrames,totalFrames}`，其他状态枚举不变。

RenderArtifact.role新增video、format新增mp4；可选 durationSeconds/fps/frameCount，与既有width/height/sourceImageIds/factIds并存。RenderBundle新增可选kind=`static|video`、sourceFingerprint；缺省kind视作旧静态。ChannelDelivery新增独立videoBundle，原bundle继续只表示图文；BackgroundJob.videoBundle表示视频结果。视频不放入job.renderBundles，不替换静态bundle，不把部分结果伪装为RunResult。getRunBundles及默认RunDetail.renderBundles保持静态集合，渠道详情或显式includeDeliveries可读视频引用。

JobStatus仍queued/running/failed/interrupted/cancelled/completed。普通列表及SSE可detailOmitted=true，省略终态正文、频道成品、calls/renderBundles/videoBundle；前端选中后GET详情，只保留同updatedAt的完整缓存，不用紧凑空数组覆盖有效详情。JobEvent仍 `{type:'snapshot',jobs}`；旧正文SSE progress/result/error/needs_input保持，HTTP200之后仍可能error。

CreativeAsset.kind仍generated-visual，保存模型、网关、Prompt/Skill版本、原图关联及sha256，不混入事实证据。ExternalDesign仅历史兼容，不在网站展示编辑链接。PosterApproval挂在bundle和delivery，包含status、bundleId、原始artifactId、sha256、contentFingerprint、createdAt/expiresAt、approvedAt/checks、requiredCopy、factChecks、referenceImages及notice。VideoScript/Review可选挂在job和channels，供展开阅读，不提供用户修改短稿接口。浏览器只保存选择的任务/记录ID与待确认提交的幂等键，不保存正文、凭证或完整任务输入。

### 3.2.1 方舟默认值与用量兼容字段

`GET /api/status`的image对象仍为configured/name/baseUrl，默认name精确为doubao-seedream-5-0-pro-260628、baseUrl为https://ark.cn-beijing.volces.com/api/v3；configured不代表已真实验证。显式旧运行配置仍优先，新Key必须通过本机隐藏输入配置，不会把旧网关Key自动送到新主机。normalizeImageBaseUrl接受官方根域或/api/v3，拒绝/v1、混拼、完整endpoint及带凭证/query/fragment地址。

后台方舟请求为单图非流式、PNG、response_format=b64_json、watermark=false，省略n/stream/sequential_image_generation/image等字段。size显式保留1024x1536/1536x1024/1024x1024，按实际图像字节保存；没有参考图或图层拆分请求。x-tt-logid进入脱敏requestId；ModelCallRecord.usage新增可选generatedImages（generated_images），并兼容output_tokens/total_tokens映射，未提供不填0。浏览器不新增请求字段，不提供绕过队列与检查点的生图代理。

### 3.3 MP4、资源与审核门禁

MP4通过原 `/api/render-assets/:handle` 预览与 `?download=1` 正式下载。MIME=`video/mp4`，返回Accept-Ranges:bytes；无Range为200，合法单段 `bytes=start-end`、`bytes=start-`、`bytes=-suffix` 为206及Content-Range/Content-Length；非法、多段或越界416及`Content-Range:bytes */size`。先执行句柄/期限/审核校验，再处理Range，不能用Range绕过下载门禁。

渠道阻断时正式复制/downloadUrl/zipUrl关闭，直接请求正式下载仍409；撤销渠道会同时关闭静态、视频及ZIP资源。needs_attention保留工作台警告但可交付。预览链接不等同发布授权。资源过期410；未知句柄410/原图不存在404，不能拿全零模拟句柄当有效下载验证。

## 4. 海报、视频与恢复

### 4.1 海报候选与人工核对

`poster-image`只接受海报渠道及独立deliveryId。先校验证据、真实原图可读性、正文审核和live/IMAGE配置；设计简报版本virgo-poster-image-1.0.0编译必需文字、事实与完整条件、画幅/构图/色彩/光线/产品外观约束。请求当前配置生图模型生成1024x1536整张图，保留模型返回像素尺寸，不本机裁切、缩放或叠字。没有输入产品参考图片，工作台referenceImages仅供人核对；生图不能冒充产品证据。

成功先发布publication=preview、status=visual_pending，只有一张干净PNG、空copyText、无downloadUrl/zipUrl。PosterApproval.artifactId永远指向被查看的原始预览，sha256对应该图片字节；人工必须核对文字、型号外观、事实条件三项。approve输入严格，false/缺字段422，错误图片或hash/已替换候选409，过期410，渠道阻断或来源变化拒绝。批准后同bundleId、同原始approval指针，正式PNG有新handle并新增来源ZIP；旧预览的download=1仍409。重复同版本确认幂等，不创建新句柄，不延长TTL。新图生成重置核对；不通过审批清掉事实来源warning。网站在阻断、来源非ready和过期时禁用核对并说明动作。

整图付费派发前保存marker和调用账本，成功素材及hash落盘后确认。结果不确定暂停，不让另一个同指纹任务自动绕过再付费。显式重生或用户主动retry才进入新轮；图片已返回而本机保存未知为IMAGE_PERSISTENCE_UNKNOWN，明确可能已计费。403非JSON且可识别的网关/Cloudflare拦截页分类为IMAGE_GATEWAY_BLOCKED；这是前置访问拦截，不据此断言Key失效或模型不存在，不自动重发。素材过期不隐式重新生成。整个PNG及来源检查分别验收，API200不等于事实与外观通过。

### 4.2 独立视频短稿、审核与本地编码

新video任务持久videoMode=script-v2，首先用当前审核事实和完整条件生成VideoScript(version=video-script-v2)，独立模型审稿；正常2个文本节点，必要时一次定向repair及recheck，最多4节点，每节点HTTP预算仍最多2次。VideoScript包含title/cta、最多两个scene及factIds/conditions/sourceFingerprint；condition模式display完整同屏显示，scope必须说明为何该限定条件不适用于本句，服务端规则及模型复核。不能把必要条件删掉来强行放入视频。短稿失败仅阻断新video，不修改或撤销静态文章。

short-script/review检查点持久，配置或来源指纹变化拒绝沿用，未知付费结果重启不重发。帧绘制/编码retry复用成功短稿与审稿，不重写正文、不重发背景。旧videoMode缺省继续legacy；旧VIDEO_COPY_TOO_LONG在网站提示按新版流程另建video Job，不重试旧长文算法。

审核通过后固定1080×1920、30fps、600帧、20秒、无声H.264/yuv420p/faststart，附封面。0–4秒标题、4–16秒最多两个信息点、16–20秒CTA；HTML/CSS+暂停GSAP通过seek(frame/30)确定性绘帧，背压写FFmpeg，ffprobe校验后才发布。静态/视频共享Chromium进程但每任务独立context，页面总限2、视频限1；拒绝外网，最长10分钟覆盖等待/绘帧/编码/探测。取消回收本任务页面和进程，不影响其他渠道。视频绑定当前静态bundle/标题/正文/审核/证据/背景，发布前再次验证，变更409；到期不晚于原静态和背景，缓存命中不续期。

固定设计规则virgo-html-1.0.0、视频html-gsap-video-2、海报virgo-poster-image-1.0.0及Skill固定提交、SHA-256/许可证见[vendor manifest](server/design/vendor/manifest.json)、[设计说明](server/design/README.md)、[第三方声明](server/render/THIRD_PARTY_NOTICES.md)。premium-animations、ui-animation、GSAP官方和html-animation规则本机实际编译执行，不开启其登录或发布流程。

文本最多4个HTTP、2个活跃创作、2个本地排版；生图并发1/300秒。文本默认180秒、可调最高300秒；429有限退避与格式纠正共用节点2次HTTP预算，524/504、断流、网络/未知业务错误不自动重发。HTTP200 JSON/SSE业务错误仍分类、脱敏、保存诊断号和可用usage，缺少usage不填0。旧外部设计公开端点/新提交/重试统一410，旧未知派发标记保留，不因搁置伪装确定失败。

## 5. 期限、前端适配与验证

大纲自保存、完整成稿自生成完成、独立渠道正文/审核及Job按既有七天策略保存；每份稿保留确认的大纲快照。读取不续期、旧稿不套用后续大纲。证据、原图、背景、图文/视频/ZIP按三十分钟临时策略保存，视频到期不晚于所复用静态和背景的原期限。重排有效旧成品、缓存命中、重启、读取不延期；背景过期需主动重新生成，不隐式付费。来源变化或过期时历史正文可读，依赖新证据的操作明确410。

`.local-state/`原子JSON、串行写入，无数据库；坏记录保留并报503，不清空。成功阶段检查点持久保存；付费派发标记在HTTP前落盘，只有成功结果原子检查点才清除。重启不会把未完成任务算成功，不重发未知付费结果。新旧renderer选择持久，不能按进程当前默认改写旧排队任务。

前端公众号/小红书左发布正文、右排版图片，右侧不重复文案；朋友圈单区自然文案+原图，海报单区一张图，无发布文案、复制、标题编号或字数。当前渠道needs_attention显示“可交付·N项发布提醒”，列具体原因及动作；不是待点确认。外部设计网站入口/品牌状态/外链/同步全部移除，旧阶段中性标示搁置且无retry。独立视频短稿/审稿可展开，旧VIDEO_COPY_TOO_LONG按钮提交新任务，失败清除陈旧完成提示，视频不锁图文或抢导航。历史海报即使曾用其他标题序号，也显示其原有效图片；公众号/小红书的标题变化仍要求匹配排版版本，兼容不会恢复过期资源。手机390×844按钮单列，原生controls/playsInline预览与9:16显示。

状态重点：400 Schema/幂等键；403 Host/Origin；409版本/确认/占用/审核门禁/素材绑定；410历史/来源/成品过期；413请求超限；416无效Range；422需求/原图/文字容量/不支持视频渠道；429队列上限；499取消；502/503/504由结构化错误区分上游与缺运行时、损坏记录或本地超时。

本轮真实ima验收通过：现有后端连接设置/verify均HTTP200，最终configured/verified均true；一个型号取得10条事实和6张原图，全部来源及产品绑定一致，图片字节/MIME/实际尺寸与证据期限检查通过。验证禁用本地知识库回退，使用独立临时状态与工作目录，结束后删除私有临时文件。没有生成业务任务，没有调用文案/生图模型。详见[实际验收](verification/acceptance.json)。

本轮未运行单元测试、类型检查、构建、浏览器发布或部署；先前ima18项模拟测试、上一版生图分组测试和真实海报成功均属于历史，不计为本轮通过。上一版生图记录保存在[历史验收](verification/previous-image-acceptance.json)。没有人工核对产品外观、所有产品或未来配额。

前端实现入口见 [src/WorkflowApp.tsx](src/WorkflowApp.tsx)、[交付面板](src/ChannelDeliveryPanel.tsx)、[视频面板](src/VideoDeliveryPanel.tsx)、[统一客户端](src/api/client.ts)及兼容 [src/App.tsx](src/App.tsx)。本地归档不等于Git提交或推送；历史版本与首次交接原件保持只读。最终校验见 [manifest.json](manifest.json)。

## 6. 自有服务器部署规划

现有接口面向本机单操作者。少量熟人访问仍需入口身份保护；当前Host/Origin、SSE和本机存储约束需要在正式部署前适配。2 GiB同机渲染未经验证，不承诺现有默认并发和视频能力。全部待实施事项见[部署规划](deployment-plan.md)，本轮仅通过现有接口更新本机ima进程连接配置；不改变接口、默认并发、服务监听或云服务器状态。

## 7. ima配置、读取与部署前验收

运行 `python3 scripts/configure-ima.py` 隐藏输入Client ID、API Key；可选准确库名，空白保留。仅写项目私密`.env.local`，权限600，两套别名同值，其他配置保留。页面保存仍仅进程内存；外部进程环境优先，需在任务结束后按原模式重启服务。不要把密钥发到前端或归档。

`GET /api/status` 的ima.configured只说明两项非空；`POST /api/connections/verify` 的ima.verified只验证唯一库名查找与库元数据请求，不调用文本或生图。其后实际型号取证还需原文、至少三个事实和该渠道所需真实原图；无图不以本地图替代，PDF/Office事实原文不支持。只有live模式允许ima来源，真实生成仍调用文本模型。

本轮用户已隐藏录入，受控本机程序读取新配置并经现有settings接口只应用ima字段。当前进程加载成功，无需本轮重启；持久文件留供后续启动，未改其内容。verify与最终status均成功。另以独立进程完成一个型号10条事实、6张原图的真实读取，并检查字节、MIME、尺寸、来源绑定与证据期限；本地知识库禁用，临时媒体已删除。不回显或归档凭证，不存私有原文或临时URL。

此结论仅限本机当时及一个型号，仍需在目标服务器独立注入秘密、验证出网与配额，并适配公网身份/Host/Origin和渲染运行时。本轮未调用文案/生图、未部署、未重启或执行Git操作；前端无需适配。完整步骤见[ima指南](docs/setup/ima-knowledge-base.md)，已知缺口见[检查记录](ima-audit.md)，实际范围见[验收](verification/acceptance.json)。
