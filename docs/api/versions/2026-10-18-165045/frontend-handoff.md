# 前后端接口交接说明

版本：2026-10-18-165045。北京时间：2026-10-18T16:50:45+08:00。Git基线 8574709cb9fd8faf0d022c1b80484138e11f02d5，分支 backend/api-handoff，源文件哈希见manifest。

本次核查四渠道项目实际接入范围，并解释文案和版式同质化。**已核对，无接口变更**。真实调用Wenyan、MIT小红书框架/Playwright、Satori/Sharp，但不等于四套独立成熟渠道系统已全量接入；共用布局与粗粒度内容规则存在明确不足，详见[接入与同质化审计](channel-integration-and-homogeneity.md)。

本次只读源码和研究对照，另使用纯模拟fixture执行四个单渠道规则生成对比；没有修改运行代码、调用真实模型/ima或生成图片。改造建议尚未实施。以下完整协议与历史验证继承上一版本，不记作本次重跑。

## 1 分工与启动

后端主要维护 server/、共享类型和校验；前端队友主要维护 src/ 的页面与交互。此 Demo 已接通功能，队友可沿用协议重新设计视觉。改字段或行为时建立新的交接归档，不能覆盖本版及旧版本。

```powershell
npm ci
npm run setup:render
npm run build
npm start
```

需要 Node.js >=22.12。Express 同时提供页面与 /api，相对请求无需 CORS。默认端口 3000，本次独立预览端口 9755，以终端为准。独立 Vite 前端必须将 /api 代理到后端并保留 Host（changeOrigin:false）；图片和成品路径也经过同一代理。写入不支持直接跨端口 fetch。示例：server: { proxy: { "/api": { target: "http://127.0.0.1:9755", changeOrigin: false } } }。实际 target 使用后端监听地址。

新克隆不含 .env.local、原始知识库、.cache/ 或 output/。无本地资料时 products 仍返回公开型号元数据，但不生成伪造事实。使用本地生成需有权放置资料；模型 + ima 模式需模型凭证、共享库权限与实际读取额度。模拟夹具只能用于页面联调，不能将其中 ID 提交到正式接口。夹具中的 PNG/SVG 明确是示意素材。

## 2 页面与状态

```text
欢迎/接入 → 产品 → 场景与目标客户 → 渠道 → 补充要求
→ 大纲 editing → 保存/AI修改（版本+1，重新 editing）
→ 确认 confirmed → SSE 正文与审稿 → 视觉预览/导出
```

操作者固定为销售员；audience 表示文案面向的客户。任务业务场景和渠道分开记录。切换场景不静默覆盖已选客户。新增 task-options 提供八类赛题建议场景、人群、目标与渠道规格；场景 id 用于目录/界面识别，提交 Brief 时 scene 仍是显示文字，自定义也提交文字，兼容原字段。

更改任何 Brief 条件需要新大纲。前端有未保存修改时禁用确认和生成；后端仍验证版本。手动保存与 AI 修改都取消旧确认。确认只对 outlineId + version 有效，不表示产品事实或发布审核通过。

正文开始时复制已确认大纲与证据；进行中再编辑不会改变这次生成。返回结果带 outline: {id,version}。正文每次生成有新的 id，本流程 revision 从1开始；旧 /revise 的新 id 对应 revision+1。渲染绑定正文 id/revision、平台、选定标题和模板；标题/正文变化时清空旧预览。历史作品与大纲的关联必须检查，不把别的作品的大纲当作当前修改对象。

## 3 全部运行接口

JSON 直接返回对象，不使用统一 data/code 外壳。错误主要为 {message}，缺必要任务字段为 {type:'needs_input',message,fields}。不要解析中文错误文本做业务分支。

为容纳完整双平台可编辑大纲，JSON 请求体上限从原32 KB提高为256 KB；超限返回413，各字段仍按Zod限制校验。

| 方法/路径 | 输入 | 返回/用途 |
| --- | --- | --- |
| GET /api/status | 无 | AppStatus：模型配置状态、ima 状态、本地资料统计 |
| GET /api/products | 无 | {products: Product[]}，稳定本系统 ID，系统/年份不可混用 |
| GET /api/task-options | 无 | TaskOptions，固定销售员身份、八类场景与建议客户、目标、购买阶段、四渠道图片规格 |
| POST /api/connections/settings | 可选接入字段 | AppStatus，更新后端进程内存，不回传密钥 |
| POST /api/connections/model/verify | {} | {verified:true,message}，最小真实模型调用，有接口用量 |
| POST /api/connections/verify | {} | 验证现有 ima 配置后返回 AppStatus |
| POST /api/outlines | Brief | OutlineResult，检索证据后生成大纲；长请求可取消 |
| GET /api/outlines/:id | 无 | 当前完整 OutlineResult |
| PUT /api/outlines/:id | {version,platforms} | 保存后 version+1、status=editing |
| POST /api/outlines/:id/revise | {version,instructions} | AI 修改后 version+1、status=editing |
| POST /api/outlines/:id/confirm | {version} | status=confirmed，版本不加一，返回 confirmedAt |
| POST /api/generate-from-outline | {outlineId,version} | SSE：按已确认快照写正文、审核与有限修订 |
| GET /api/render-templates | 无 | {templates:RenderTemplate[]}，八个受控模板 |
| POST /api/render | RenderRequest | RenderBundle，单渠道同步排版，不接受客户端正文/HTML/URL/路径 |
| GET /api/render-assets/:handle | 可选 ?download=1 | HTML、PNG 或 ZIP 实际字节；下载有正确 MIME/文件名 |
| GET /api/assets/:handle | 无 | 原始证据图字节，访问生命周期由知识连接器维护 |
| GET /api/sample | 无 | 原有本地规则示例 RunResult；不是新流程大纲 |
| POST /api/generate | Brief | 原有直接生成 SSE，保留兼容，新页面不使用 |
| POST /api/revise | {runId,instructions,platforms?} | 原有正文修订 SSE，保留兼容，新页面走重新编辑/确认大纲 |

新流程必须使用 generate-from-outline。保留的旧接口没有新增确认要求，不能调用旧路径同时声称完成了大纲确认门禁。

## 4 配置与选项

settings 的全部可选字段：baseUrl（URL，<=300）、model（1–100）、apiKey（<=500）、imaClientId（<=300）、imaApiKey（<=500）、imaKbName（1–120）。字符串会 trim，未知字段拒绝；空白密钥保留原值。浏览器表单只展示已配置/未配置并在保存后清空输入，不持久化密钥。

配置只存本地后端内存；不写 .env.local，重启恢复环境设置。持久配置由使用者在本机编辑 .env.local。模型仅允许 HTTPS 的赛事域名或启动时配置的当前域名，不能有用户信息、查询参数、fragment 或非443端口；新域名须由后端配置后重启。有进行中的修改/生成/渲染/验证请求时配置更新返回409；取消连接后，直到后端异步清理真正完成才释放锁。

此 Demo 默认仅监听本机，没有多用户鉴权。Host 只接受 localhost、127.0.0.1、[::1] 或服务端明确配置的 HOST；非法 Host 的读写均403。写入 Origin 必须与请求协议、Host及端口一致，Sec-Fetch-Site:cross-site也拒绝；不信任客户端转发头。命令行可不带Origin。不要直接对外开放或在客户端嵌入后端凭证。模型验证与 ima 验证只表示对应连接检查，不代表后续每次读取额度或内容审核通过。

Brief 的字段/约束沿用原协议：productId <=180，audience <=120，scene <=250，goal <=160（默认到店体验），buyingStage <=80（默认对比选择），instructions <=2000，platforms 为1–2个不同平台。mode=demo/live，knowledgeSource=local/ima；demo+ima 拒绝。productId/audience/scene 不完整返回422补充问题。产品 ID 必须来自目录，不用名称替代。

## 5 大纲协议与编辑规则

OutlineResult：id、version、status(editing/confirmed)、createdAt、可选 confirmedAt、brief、product、evidence、platforms、warnings。evidence 和 RunResult 一样包含事实、支持原文、限制、公开图片及资料标题；不返回 sources.text 完整原始文档。

每个 PlatformOutline 有 platform、title、angle、intro、sections、imageIds、cta。sections 为有序数组，每项 {id,heading,points,factIds}。保存的是完整 platforms 数组，不是 JSON Patch。编辑不能改变 Brief 或平台集合；修改任务需重新 POST /outlines。

| 字段 | 约束 |
| --- | --- |
| title | trim 后1–140字符 |
| angle / intro / cta | <=300 / <=1000 / trim后1–500 |
| sections | 1–8；poster最多3；段落ID在平台内不能重复 |
| section.id / heading | 1–40 / <=100 |
| points | 1–4项，每项trim后1–650；不把多行空项提交给后端 |
| factIds | 最多10；每项必须属于本次 supported 事实 |
| imageIds | 最多6，不重复，必须是当前产品的本次素材 |
| version | 整数 >=1，必须等于服务器当前版本 |
| AI修改 instructions | trim 后1–2000 |

保存和确认校验平台集合、段落唯一性、引用和图片归属，语义事实审核在正文阶段独立进行。当前大纲允许无事实的场景段落，不能因此把无引用的产品断言视为已审核。图片数量按平台规则在正文审核/渲染再次检查。

本地演示不调用大模型：用规则构造可编辑大纲，AI 修改入口明确只支持“精简/缩短/压缩/更短”。其他改动可手动编辑，或重新选择模型模式；不静默冒充 AI 修改。模型模式由结构化模型输出并校验。

正文标题、段落ID/顺序/小标题、factIds与imageIds由服务端按确认快照构造，模型仅返回对应段落的文本、展开的导语、CTA与话题。返修也使用同一结构。引用编号不等于语义支持，因此仍执行逐句独立审稿。

大纲最多40条，闲置30分钟失效；同一大纲在 AI 修改中锁定，其他读取/确认/修改返回409。取消不会保存未完成版本，也不会清除之前已保存或已确认的版本。确认时 ima 证据已经过期则410，要求重新检索。

## 6 SSE、取消和失败

generate、revise、generate-from-outline 的成功流 Content-Type 为 text/event-stream。每帧 data 后跟一个 StreamEvent JSON，以空行结束；可能跨网络分片，不能用每个 reader.read 当作一帧。支持 CRLF。注释心跳约15秒一次，不是业务事件。

```text
data: {"type":"progress","entry":{"step":"write","label":"按确认大纲写作","status":"running","detail":"纯模拟进度","at":"2026-10-18T08:00:00Z"}}

data: {"type":"result","result":{"此处以fixtures中的完整result为准":"纯模拟"}}

```

事件类型保留 progress、result、error、needs_input。progress 携带 TraceEntry，result 携带完整 RunResult；error 为失败信息，needs_input 携带字段问题。正文修订后再审稿，结果可能 passed、needs_attention 或 blocked。收到 error 或连接中断后不得把旧稿当作本次完成。

前端用 AbortController 取消长 JSON 请求、SSE 和渲染；服务器在连接关闭后传播取消到模型/ima/Chromium。客户端取消后通常没有 HTTP JSON 响应，应本地提示已停止，保留已保存的大纲与上次正文。流开始前的校验以 HTTP 状态返回；流开始后的错误使用 error 事件，不能只检查 response.ok。

正文最多两个并发，渲染最多两个并发；已注册的API修改/验证/生成/渲染操作总在途请求最多四个，超额429。不排队时应允许用户稍后重试。新流程 SSE 解码参考 src/api.ts：校验text/event-stream、完整事件/结果形状及大纲id/version绑定，终态后关闭reader，取消时丢弃缓冲结果；单帧上限2 Mi字符，总接收上限8 MiB。

## 7 视觉排版接口

RenderRequest 精确字段：{runId,revision,platform,selectedTitleIndex,templateId}。revision>=1整数；selectedTitleIndex 为0–2，默认0，同时必须是该稿件实际已有标题。未知字段拒绝，包括 html、图片URL、脚本或路径。大纲流程保持已确认标题，通常仅索引0；旧稿可能有备选标题。

| 模板 ID | 渠道 | 输出 |
| --- | --- | --- |
| wechat-editorial / wechat-warm | wechat | 排版文章 HTML + 1200×900封面PNG |
| xhs-cream / xhs-sage | xiaohongshu | 3–6张1080×1440 PNG，封面/内容/总结 |
| moments-square | moments | 1–3张1080×1080 PNG |
| moments-portrait | moments | 1–3张1080×1440 PNG |
| poster-paper / poster-ink | poster | 一张1080×1920 PNG，最多三个卖点 |

模板目录的 wechat width/height 用于模板规格，不是文章高度；文章是流式长文，实际封面尺寸以 artifact.width/height=1200×900为准。

RenderBundle 有 id、runId、revision、selectedTitleIndex、platform、templateId、artifacts、reviewStatus、warnings、copyText、可选 zipUrl、expiresAt。成品 Artifact 有 id、role(article/cover/card/poster)、format(wechat-richtext/png)、name、previewUrl、可选downloadUrl、可选width/height、sourceImageIds、factIds。ID为本系统标识，不是 ima 内部媒体ID。

生产 previewUrl/downloadUrl 均为同源 /api/render-assets/UUID；下载增加 ?download=1。不要猜测文件路径或拼接 ima 地址。图片实际 MIME image/png，文章 text/html; charset=utf-8，整包 application/zip。下载有 UTF-8文件名，前端可以 fetch 后下载 Blob，非2xx读取JSON message，在页面内保留现有结果。

图片从服务端已保存证据解析，通过原始句柄获取同型号图片，等比缩放，不重绘设备。公众号要求2–4张不同来源图、小红书3–6、朋友圈1–3、海报1。数量不足、重复或错型号返回422；不复制图片充数。小红书页数3–6不等于额外产品源图数量，信息卡不算新原图。

每页保留原文与限制，尝试调整字号；仍溢出返回422，提示回到大纲精简。不会偷偷截断。渲染超时90秒返回504；缺 Chromium 返回503。Chromium 拒绝所有外部请求，文字先转义，仅使用自有受控模板。

成品至多20组，30分钟过期并清理；原任务不存在或过期时不能开始渲染。开始有效排版会刷新正文任务触达时间，返回成品按创建时间保留30分钟，ima 证据过期仍需重新获取。重启后旧句柄不可访问。选择新标题、换模板或正文任务改变时前端应中止旧请求、清空旧 bundle，并检查返回的绑定信息，不能把旧预览显示为新版本。

## 8 审核与渠道发布边界

- blocked：带“审核阻断·仅供预览”标记的成品可看；没有 downloadUrl/zipUrl，直接以 ?download=1 请求也返回409，复制按钮禁用。
- needs_attention：保留待确认标记、来源模式和问题，允许下载人工复核；不把下载等同正式发布通过。
- passed：表示相应内容检查通过，仍保留发布前复核提示，不代表账号发布/印刷验收。
- demo/local：保留本地演示或本地资料标记，不改成 ima 来源。

公众号 iframe 使用 sandbox 和受限 CSP；文章为内联样式 HTML，可用 ClipboardItem 同时写 text/html 与 text/plain。Clipboard 写入需发生在用户点击中，并处理浏览器不支持/拒绝情况。图片为嵌入式预览，尚未上传微信素材库，需粘贴后逐张上传或替换。当前没有真实微信账号编辑器粘贴验收，不声称已经发布就绪。

小红书、朋友圈、海报的 PNG 为实际二进制文件，支持逐张放大与下载。ZIP 附文案及“来源与审核.md”，将引用映射为依据序号、图片名和资料标题，不含凭证、签名链接、原始知识库全文或服务器路径。Markdown 是方案附件，不能代替视觉成品。

## 9 HTTP 状态与前端处理

| 状态 | 常见原因 | 前端处理 |
| --- | --- | --- |
| 400 | 结构/长度错误、重复平台、未知模板/标题、无效引用或句柄、配置域名不允许 | 定位输入并保留当前编辑 |
| 403 | 非允许Host、跨站/跨端口/协议不符的写入来源 | 使用本地同源或保留Host的开发代理；不靠伪造转发头绕过 |
| 404 | 未知路由；原始素材失效 | 检查路径或重新获取原图 |
| 409 | 版本过旧、未确认、大纲修改中、配置与任务冲突、阻断下载 | 载入当前大纲（先提示未保存内容），重新保存并确认，或先处理审核问题 |
| 410 | 大纲/正文/成品/ima证据过期，源图不可读 | 回到相关阶段重新检索或排版 |
| 413 | JSON请求体超过256 KB | 减少大纲要点或附加要求 |
| 422 | 必填任务缺失、图片不足、文字溢出、规则演示不支持自由AI改写 | 展示字段问题或明确调整建议 |
| 429 | 并发已满、模型/知识接口限制 | 稍后重试，不自动换模式 |
| 502/503 | ima业务/额度/权限错误、缺渲染运行时等 | 展示实际 message，检查服务或安装Chromium |
| 504 | 渲染超时 | 保留正文，缩短内容或重试 |
| 500 | 其他模型/渲染失败 | 保留已保存内容与错误信息，不以占位文件冒充成功 |

模型自身超时或网关异常目前沿原错误处理返回500或 SSE error；不要假设都为504。真实 ima 业务码根据连接器转换，读取额度不足可为502，不能一律当429重试。

## 10 历史验收与限制（本版新增验证见第12节）

本轮完成 TypeScript 检查、生产构建和89项测试（0失败、0跳过），包含新增23项安全及异常回归。测试含旧知识/模型协议、版本确认、固定结构返修、进行中取消释放锁、输入安全、中文PNG、溢出拒绝、HTTP确认门禁、审核阻断下载及ZIP来源。模拟模型/ima响应不当作真实服务验收。

已实际使用授权本地资料生成公众号文章与封面、小红书六页、朋友圈两图和海报一张，并核对 PNG 尺寸、打开图片检查中文与设备比例。文件位于被忽略的 output/four-channel-demo/；不进入交接版本。浏览器走通欢迎、型号、人群、双渠道、大纲手动编辑保存v2、确认、正文及小红书实际预览。公众号HTML/封面在独立浏览器流程中生成并显示完整文章；IAB富文本剪贴板写入与真实微信编辑器粘贴尚未完成验证。

真实模型 + 本地资料已调用大纲、正文、独立审稿与必要修订，保留实际审核状态，并验证阻断稿只提供标记预览。具体最新结果见本版 README。真实 ima 在本轮返回“资料获取次数已达上限”，因此本轮未完成新流程的 ima 端到端验证，不使用本地图冒充。

未实现自动发布、账号登录、印刷PDF、在线图层编辑、多用户鉴权与持久化数据库。依赖审计剩余项及关闭的可选入口记录在第三方声明中。89项测试/文件可渲染不表示事实全部通过、发布通过或印刷通过。


补充行为：大纲生成应用任务中的精简与卖点排除要求；模型策划接收平台规则。报告撰写时应检查实际输出，不能仅根据提示词认定规则全部满足。


## 11 本轮安全修复与前端适配

接口没有新增字段或路由；403与409保护更严格。正常同源七步流程兼容，独立前端需配置保留Host的代理。错误保留message形状，但不再回显枚举输入、未知字段名、实际密钥或本地路径；不要依赖旧错误文案。

公众号仅把随机占位符送给文颜public core，在排版后按HTML实体编码插入全部原文与换行，再嵌入同型号PNG；文案中的HTML、Markdown、Mermaid、front-matter和链接保持字面文本。小红书模板只展开原始槽位一次，$&、$'、$`及用户写入的模板字样不触发二次替换。渲染底层拒绝外部URL/file/SVG输入；HTTP仍只接受RenderRequest。导出来源说明的链接、路径、句柄和疑似密钥过滤更严格。

前端校验RenderBundle与当前runId/revision/platform/selectedTitleIndex/templateId一致；模板异步载入可补默认值，过期清空成品，切换任务/模板会取消旧请求与资源下载。历史作品显示自身来源，返回大纲必须检查关联。blocked稿下载/复制入口维持禁用。

模型请求开始时捕获凭证供重试；非SSE响应在读取过程中限制为2,000,000字节，超限停止并释放reader。模型域名白名单从服务启动环境固定，不随页面更新扩大。成品缓存维护串行执行，仅发布新成品时执行容量淘汰，取消/失败会移除未发布文件。

本轮实际重跑本地四渠道排版；未额外调用真实模型或ima，未重复浏览器全流程或微信剪贴板验收。前述真实模型/浏览器记录继承上一实现阶段，不能算作本轮重新通过。依赖审计剩5项中危（未调用的front-matter依赖链），无高危/严重报告；未完成20组并发压力测试或公开部署验收。


## 12 DeepSeek Flash 与思考模式配置

前端HTTP路径、请求字段、响应类型、输入约束和SSE事件均无变化；本版新增后端环境选项LLM_THINKING，留空/default不发送思考参数，disabled发送thinking:{type:"disabled"}，其他值在发起网络调用前报配置错误。此选项不可通过settings接口提交；修改需重启。当前DeepSeek使用官方Anthropic兼容入口与deepseek-flash，具体见[配置指南](model-configuration-guide.md)。

真实短文本连接已返回HTTP200，有效文本由现有模型适配层读取；91项测试（含新增2项）及生产构建通过。此验证没有发送产品事实/图片，没有重跑DeepSeek完整营销流程、ima、四渠道或浏览器验收。历史claude调用与89项测试记录保留为前次阶段证据。域名/密钥隔离和审核门禁保持。


## 13 海报输出实现说明

海报排版调用Satori生成SVG，再由Sharp转PNG；使用证据包中的真实产品原图，不调用AI图片生成API。模型创作下的文案由当前DeepSeek Flash生成，本地演示仍为规则。模板、1080×1920尺寸、审核/溢出/过期行为保持，详见[调用链](poster-rendering-explanation.md)。
