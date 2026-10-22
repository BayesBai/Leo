# 前后端接口交接说明

版本：`2026-10-22-013043`；北京时间：2026-10-22T01:30:43+08:00；代码基线`17bd7c9262d584ba21795c0604eb993110a56038`，分支`frontend/workbench`。以上一完整交接版`2026-10-22-011834`为起点。

本轮按明确要求，将大纲、AI修改、正文、返修和独立审稿切回 `gemini-4-argon` 和 `https://relay.nccnxta.cn/v1`，继续使用原有后端Key；同步默认值、环境样例、页面兜底、测试与说明，并重启9756服务。没有更改模型标识、改用其他模型或规则输出冒充模型成功。

接口路由、字段、HTTP状态及SSE结构无变化；兼容行为调整为：仅在HTTP503的JSON/SSE错误中精确识别服务商已知账号池耗尽消息，返回明确中文说明且不立即重复调用。其他503/502/504/429保持有限重试。前端无需新增字段适配，继续展示`message`并保留已保存内容。

真实验证未跑通：文档最简请求返回503，服务商明确报错`All available accounts exhausted`（可用账号池耗尽）；四渠道流程在大纲阶段失败，未进入正文和出图。模型目录200/含标识不等于生成可用。该供应方容量问题需恢复对应模型线路；本轮未降低审核、确认或配图门禁。

协议类型见 [shared/types.ts](shared/types.ts)，输入约束见 [server/schemas.ts](server/schemas.ts)，[请求样例](api-examples.http)与[纯模拟夹具](fixtures/frontend.mock.json)只展示协议，不包含真实产品资料、凭证或实际访问句柄。交接中的源码快照供阅读，运行使用根目录完整工程。

## 1 分工、启动与测试

后端主要维护 `server/`，前端主要维护 `src/`。共享类型、输入校验、HTTP/SSE 行为改变时双方同步本次交接；历史版本和首次交接原件均不可覆盖。

```sh
npm ci
npm run setup:render
npm run build
npm start
```

需要 Node.js >=22.12。`npm start` 和 `npm run dev` 均通过 `server/start.ts` 启动：先载入 `.env.local`、再载入 `.env`，已有进程环境不被覆盖，然后动态导入应用。生产模式要求已有 `dist/`；开发模式挂载 Vite。直接导入 `server/index.ts` 仅获得 `createApp()`，不会再自动读取本机环境文件或监听端口。默认监听 `127.0.0.1:3000`，以实际终端地址为准。

Express 同时提供页面和 `/api`，浏览器使用相对请求。独立 Vite 前端须代理 `/api`、图片与成品路径，保留 Host：`changeOrigin:false`。写入不支持直接跨端口 fetch；代理的 target 使用实际后端地址。

`setup:render` 下载官方 Chromium 到被忽略的 `.cache/ms-playwright/`，已有字体与许可随工程提供。macOS 使用完整 Chromium 的新无头模式，其他系统沿用默认无头启动；没有新增可执行文件路径输入，也没有关闭外部请求拒绝。海报/朋友圈/公众号封面由本地 Satori、Sharp 等受控渲染，小红书使用受控 Chromium 模板，公众号文章使用 Wenyan；均不调用 AI 生图 API。

默认测试命令为 `npm test`，通过 `tests/setup.ts` 预载隔离环境：每个测试工作进程建立纯模拟知识库和临时状态目录，覆盖真实凭证与知识库路径，禁止未显式模拟的外部网络请求。不读取真实 `.env.local`，不需要私有产品库，也不把 Mock 或模拟 PNG 当成真实模型/ima 验收。单文件测试也须保留相同预载方式。`npm run check` 只做 TypeScript 检查，`npm run build` 包含类型检查和生产构建。

新克隆不含 `.env.local`、`.local-state/`、原始知识库、`.cache/` 或 `output/`。没有本地资料时目录仍可返回公开型号元数据，但不会捏造事实或图片。使用本地资料需具有授权；使用 ima 需有效凭证、共享库权限与实际读取额度。

## 2 页面、任务与 Agent 执行链

```text
填写任务（产品、客户、场景、1–4 渠道；更多要求折叠；接入设置独立）
→ 大纲 editing → 保存或 AI 修改（version+1、撤销确认）
→ 确认 confirmed → SSE 写作、审稿及最多一次有效返修
→ 文案与成品（预览、依据、审核、逐渠道排版与导出）
```

操作者固定为销售员，`audience` 是面向的客户。业务场景与渠道分开记录；场景目录 ID 只用于选项识别，Brief.scene 仍提交显示文字，可自定义。切换场景不应静默覆盖客户选择。`task-options` 提供八类场景及客户、目标、购买阶段、渠道图片规格。

当前 Agent 为后端固定编排流水线。取证、事实提取、版本管理、数量检查与渲染由代码执行；live 模式的大纲、AI 大纲修改、正文、返修、独立语义审稿统一使用同一模型适配层和模型配置。独立审稿是单独请求，并不表示另外配置了审稿厂商或模型。新流程已确认大纲直接转为策略，不额外调用旧策略模型；各渠道正文并发独立写作。正常四渠道首轮为一次大纲、四次正文、一次审稿；必要纠正、结构化重试和限流重试另计。demo 模式全程规则生成，不调用模型。

更改 Brief 的任何条件需要重新生成大纲。有未保存编辑时禁止确认和生成；保存或 AI 修改都撤销旧确认。确认只绑定 `outlineId+version`，不表示事实、销售配置或发布审核通过。

正文开始时复制已确认大纲及证据，进行中再编辑不改变这次生成。RunResult 带 `outline:{id,version}`；每次正文生成有新 id，确认大纲流程 revision 从 1 开始，旧 `/revise` 新 id 对应 revision+1。渲染绑定 runId/revision/platform/selectedTitleIndex/templateId；标题、模板或任务改变时中止旧请求并清空旧预览。

## 3 全部 HTTP 接口

JSON 直接返回对象，不使用统一 data/code 外壳。错误主要为 `{message}`；必要任务字段缺失为 `{type:'needs_input',message,fields}`，fields 项为 `{field,question}`。前端按状态、类型及新增动作字段处理，不解析中文错误文本。JSON 请求体上限 256 KB，超限 413，单字段仍受 Zod 限制。

| 方法/路径 | 输入 | 返回/用途 |
| --- | --- | --- |
| GET /api/status | 无 | AppStatus：模型配置状态、ima 状态、本地资料统计；不返回凭证 |
| GET /api/products | 无 | `{products:Product[]}`；稳定系统 ID，不混用型号、系统、年份 |
| GET /api/task-options | 无 | TaskOptions：固定销售员身份、场景/客户建议、目标、购买阶段、渠道规格 |
| POST /api/connections/settings | 可选接入字段 | AppStatus；只更新当前后端进程环境，不回传密钥 |
| POST /api/connections/model/verify | `{}` | `{verified:true,message}`；最小真实模型调用，有用量 |
| POST /api/connections/verify | `{}` | 验证 ima 后返回 AppStatus |
| POST /api/outlines | Brief | OutlineResult；先取证与图片预检，再策划大纲 |
| GET /api/outlines/:id | 无 | 当前最新版 OutlineResult，含可选 history 元数据 |
| PUT /api/outlines/:id | `{version,platforms}` | 完整保存，version+1、status=editing |
| POST /api/outlines/:id/revise | `{version,instructions}` | AI 修改，version+1、status=editing |
| POST /api/outlines/:id/confirm | `{version}` | status=confirmed，不加版本，返回 confirmedAt |
| POST /api/generate-from-outline | `{outlineId,version}` | SSE；仅已确认当前版可用 |
| GET /api/history | 无 | `{items:HistoryItem[]}`；七天内大纲与正文摘要，按 updatedAt 倒序 |
| GET /api/runs/:id | 无 | RunDetail：历史正文、当次大纲快照、历史元数据、尚有效成品 |
| GET /api/render-templates | 无 | `{templates:RenderTemplate[]}`；八个受控模板 |
| POST /api/render | RenderRequest | RenderBundle；单渠道同步排版，不接受客户端正文/HTML/路径/URL |
| GET /api/render-assets/:handle | 可选 `?download=1` | HTML、PNG、ZIP 实际字节 |
| GET /api/assets/:handle | 无 | 证据原图字节；校验原始素材有效性 |
| GET /api/sample | 无 | 旧本地规则示例 RunResult，非新流程大纲 |
| POST /api/generate | Brief | 旧直接生成 SSE，保留兼容 |
| POST /api/revise | `{runId,instructions,platforms?}` | 旧正文修订 SSE，保留兼容 |

新页面必须使用 `generate-from-outline`。旧 `/generate` 和 `/revise` 没有新增大纲确认要求，不能通过这些接口宣称完成了新流程确认。

## 4 配置、网关与本机安全

全部模型阶段默认 Base URL 为 `https://relay.nccnxta.cn/v1`，模型别名为 `gemini-4-argon`；实际调用 `POST https://relay.nccnxta.cn/v1/chat/completions`，采用 OpenAI 兼容 Bearer 鉴权及 system/user messages，`stream:true`。这是第三方中转入口；别名不等于已经验证了上游真实模型身份、权限或生成可用性。浏览器不直接访问该网关。

后端配置项为 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`、可选 `LLM_TIMEOUT_MS`。Base 可填写根域名或以 `/v1` 结尾的 API 根地址，后端规范化后再拼 `/chat/completions`；不能填写完整 `/chat/completions`、`/messages` 或 `/responses` 调用路径，不能带用户信息、查询参数或 fragment。HTTP 仅供显式本机测试配置使用，页面配置仍只允许 HTTPS。旧 `LLM_THINKING` 不再控制新协议请求，不再发送 Anthropic thinking 参数；旧 `/v1/messages` 与 DeepSeek Anthropic 配置不适用于本版。

LLM_TIMEOUT_MS 默认 180000 毫秒，限制在 5000–300000 毫秒。429/502/503/504 最多额外重试一次，Retry-After 等待限制约 0.5–3 秒；结构化 JSON 或 schema 不合规最多纠正一次。若 HTTP 503 的有界 JSON/SSE 错误明确为 `All available accounts exhausted`，立即抛出容量错误，提示服务商模型账号池耗尽，本次不立即重试；其他临时错误仍按原上限处理。不回传未经筛选的上游错误正文。网络失败、超时、拒绝、截断、工具调用和协议错误都不能变成演示成功。读取只接受正常结束的文本，忽略 reasoning 等非正文；长度截断、内容过滤或不完整完成标记会报错。上游响应有大小限制，拒绝跳转以免转发凭证。

settings 可选字段：baseUrl（URL，<=300）、model（trim 后 1–100）、apiKey（trim 后 <=500）、imaClientId（trim 后 <=300）、imaApiKey（trim 后 <=500）、imaKbName（trim 后 1–120）。未知字段拒绝；空白密钥保留原值，模型占位密钥拒绝。baseUrl 会规范化；页面只允许默认中转 origin 或启动时已配置的 origin，不能靠运行期设置扩大允许域。更换 origin 必须同时提供该服务的新密钥，不能沿用旧服务密钥；原子校验失败时其他设置也不写入。

本轮同 Key 的跨域迁移有操作者明确授权，已在本机 `.env.local` 原子更新 URL/model、保留 Key 原值，并重启服务加载；页面跨域新 Key 要求仍然适用。页面保存只改变后端内存，不写 `.env.local` 或浏览器存储，重启恢复启动环境。长期设置由操作者在本机终端/环境文件维护；凭证不进入交接、源码、历史 JSON、请求样例或浏览器 localStorage。有修改/验证/生成/渲染进行时更新配置返回 409；客户端取消后，直到异步清理真正结束才释放配置锁。

Demo 仍为本机单操作者，无多用户登录。Host 只允许 localhost、127.0.0.1、[::1] 或服务端明确配置的 HOST；非法 Host 的读取和写入都 403。写入 Origin 必须与请求协议、Host、端口完全一致，`Sec-Fetch-Site:cross-site` 也拒绝；不信任客户端转发头，命令行可不带 Origin。不要把服务直接作为公开多用户后台部署。

模型 verified 只表示最小调用返回有效文本，不要求内容精确等于 OK，更不代表后续结构化创作、审稿或 ima 可用。AppStatus.model.configured 只表示配置存在，不能替代真实调用验证。

## 5 Brief 与可编辑大纲

Brief 字段：productId<=180、audience<=120、scene<=250、goal<=160（默认“到店体验”）、buyingStage<=80（默认“对比选择”）、instructions<=2000、platforms 为 1–4 个不同平台、mode=demo/live、knowledgeSource=local/ima。productId/audience/scene 缺失或空白返回 422 needs_input；demo+ima 拒绝。产品 ID 取自目录，不用显示名称代替。默认未指定 mode/source 时为 demo/local。

OutlineResult 包含 id、version、status(editing/confirmed)、createdAt、可选 confirmedAt、brief、product、evidence、platforms、warnings，以及可选 history。evidence 包含 facts 的 statement/quote/qualifiers、图片和来源标题，不返回 sources.text 原始全文。每个 PlatformOutline 为 platform/title/angle/intro/sections/imageIds/cta；sections 为有序 `{id,heading,points,factIds}` 数组。PUT 提交完整 platforms，不是 JSON Patch，不能改变 Brief 或平台集合。

| 字段 | 约束 |
| --- | --- |
| title | trim 后 1–140 字符 |
| angle / intro / cta | <=300 / <=1000 / trim 后 1–500 |
| sections | 1–8；海报最多 3；平台内段落 ID 不重复 |
| section.id / heading | 1–40 / <=100 |
| points | 1–4 条，每条 trim 后 1–650；不要提交空行 |
| factIds | 最多 10；必须属于本次 supported 事实 |
| imageIds | 最多 6、不重复、同型号/同来源/有可用 URL，且满足渠道数量 |
| version | 整数 >=1，必须等于服务端当前版本 |
| AI 修改 instructions | trim 后 1–2000 |

渠道源图数量统一为公众号 2–4、小红书 3–6、朋友圈 1–3、海报 1。取证后若现有素材总量不足请求渠道最低数，立即返回 422，尚未调用大纲模型；保存与确认也检查已选数量。模型选择错误的平台、引用、图片、数量在结构化 schema 内校验，可走一次纠正重试；素材本身不足不会通过重试生图或复制图片补齐。前端展示上下限，达到上限后禁选其他图片，数量或归属无效时禁保存/确认/生成。

live 大纲还要求不同渠道标题不同、公众号至少 3 段、小红书至少 2 个清单点、朋友圈 1 段、海报最多 3 段；手动编辑仍按表中 1–8/海报最多 3 段处理，不能把模型规划建议误当所有编辑的新段数硬约束。场景段落可以没有 factIds，确认仍不等于其语义事实审核通过。

demo 用规则生成可编辑大纲；大纲 AI 修改只支持“精简/缩短/压缩/更短”，其他要求 422，改用手动编辑或模型创作，不冒充 AI。正文的标题、段落 ID/顺序/标题、factIds、imageIds 都由已确认快照构造，模型只填导语、对应段落文本、CTA 和 tags。返修也不能改确认结构；想改标题、引用、配图应返回大纲保存新版本并重新确认。

同一大纲 AI 修改时锁定，其他读取、保存或确认 409。取消不提交未完成的新版本，之前保存/确认版本保留。过期或变化的证据不能继续保存、AI 修改、确认、写作或新排版；历史读取仍可用。

## 6 SSE、取消与模型失败

generate、revise、generate-from-outline 成功响应为 `text/event-stream; charset=utf-8`。每帧 `data:` 后一个 StreamEvent JSON，以空行结束，支持 LF/CRLF，可跨 reader.read 分片。约 15 秒的 `: heartbeat` 注释不是业务事件。业务事件仍为 progress、result、error、needs_input，没有新增终态事件。

```text
data: {"type":"progress","entry":{"step":"write","label":"按确认大纲写作","status":"running","detail":"纯模拟进度","at":"2030-01-01T00:00:00Z"}}

data: {"type":"error","message":"纯模拟失败；本次没有完整结果。"}

```

progress.entry 为 TraceEntry：step/label/status(running/done/error)/detail/at，可选 elapsedMs；result.result 为完整 RunResult。RunResult 包含 id/createdAt/brief/product/evidence/strategies/drafts/review/trace/revision/notice，确认大纲流程还有 outline 引用。needs_input 带 fields。收到 error 或流中断不得把旧稿当新完成稿；流开始前按 HTTP 状态返回校验失败，流开始后按 SSE error 返回，不能只看 response.ok。

前端唯一 transport/SSE 解码实现位于 `src/api/client.ts`，`src/api.ts` 保留兼容导出。校验响应 Content-Type、结果必要结构、全部渠道集合及 outline id/version；终态后取消 reader，取消时丢弃缓冲结果。单帧上限 2 Mi 字符，总接收上限 8 MiB。ApiError 保留 kind/status/fields，HTTP 与流内错误分别处理。

所有长 JSON、大纲修改、SSE、渲染使用 AbortController；后端将断连取消传播到模型、ima 子进程和 Chromium。客户端取消通常没有可读取的 JSON 响应，应提示停止并保留已保存大纲与上次完整正文。正文最多两路并发，渲染最多两路，已注册修改/验证/生成/渲染操作总计最多四路；超额 429，不自动排队或重复提交。

上游模型 HTTP 503 等目前由 ModelError 映射为应用 HTTP 500 或流内 error，错误消息说明上游状态；模型超时也不保证应用返回 504。不得声称所有模型故障都能按 HTTP 429/504 统一重试；实际错误与已保存内容需保留。

## 7 审核、处理动作与渠道差异

ReviewReport 的 status 为 passed/needs_attention/blocked，reviewedBy 为 rules 或 rules+model。任何类别的 error 都 blocked，规则硬错误不能被模型审稿清除；保留 source、fact、image、compliance、platform 五类检查。本地来源持续带 source 警告，因此模型+本地资料通常为 needs_attention，不等于生成失败。ima 已取原文也保留 SKU/授权/时效人工复核提示。

ReviewIssue 保留 id/severity/category/message/suggestion，以及可选 platform/factId/blockId，新增两个可选字段：

| 字段 | 值与含义 |
| --- | --- |
| target | title、intro、heading、body、cta、tags、images、references、structure、source；问题所在字段 |
| resolution | auto_text、edit_outline、refresh_evidence、manual_review；服务端决定的处理动作 |

模型只可建议 target，不能决定最终 resolution。固定标题、小标题、引用、图片与结构问题为 edit_outline；资料本身缺失或不适用为 refresh_evidence；来源提示、无法定位的语义疑点等为 manual_review。正文等可写字段可标 auto_text，但这个字段表示处理能力，不保证本次已触发返修或已修好，实际执行看 trace 和最终审核。

自动返修最多一次，仅处理 resolution=auto_text 且为 error，或 fact/image/platform warning 的问题，并只重写受影响渠道，然后重新规则与独立模型审稿。全部问题位于不可变结构/资料时不再花模型请求盲修或重复审稿，保留真实审核状态并提示回大纲或重新取证。旧历史可能没有 target/resolution，前端仍展示 message/suggestion，不猜动作或把缺字段当通过。

title/intro/CTA/tags 不承载无引用产品参数；段落引用编号不等于语义支持，逐句核对 quote 与限定。禁止价格/补贴/库存捏造、虚构亲测、夸大排名、混用型号系统与删掉必要条件。普通“最好亲手/先/到店核对”的待执行建议不单因“最好”二字判成广告保证。

| 渠道 | 内容与成品组织 |
| --- | --- |
| 公众号 | 选择困惑、分维度解释、决策建议；横向编辑封面与分节长文、穿插原图 |
| 小红书 | 可收藏行动/到店清单与互动话题；大字封面、编号清单内页、深色收尾 |
| 朋友圈 | 销售员自然聊天、一个核心看点、私信邀请；一张照片拼图与便签式信息 |
| 海报 | 短场景主张、1–2 个精选看点且最多 3 段、短 CTA；竖幅产品舞台与行动条 |

跨渠道重合检查比较标题、intro、段落标题、CTA，排除完整型号和原文事实/条件，重合度 >=0.76 添加 platform warning；这是启发式提示，不能证明语义原创。已确认框架引起的相似度问题须回大纲，不能偷偷改标题。

## 8 七天本地历史与证据有效性

状态保存于被忽略的 `.local-state/state.v1.json`；可由后端 `AGENT_STATE_DIR` 指定目录，不接受客户端路径。使用单进程同步原子 JSON：临时文件、fsync、rename；目录 700/文件 600，单写者锁。存储损坏、版本不支持或保存失败不会静默重置历史，可能返回 503 或阻止启动；应先保留原文件检查。未新增数据库、云端账号或多租户权限。

正文留存至 createdAt+7 天；大纲在每次成功创建、保存、AI 修改、确认后从该次写入起保留 7 天。读取、历史列表和新排版不会延长正文留存，也不延长证据/成品期限。大纲热缓存最多 40 条，磁盘历史不因热缓存淘汰提前消失。到期清理发生在启动、历史查询及每分钟维护；到期记录即使尚未物理清理也不可继续读取使用。

HistoryMetadata 为 `{expiresAt,evidenceStatus,interrupted?}`，expiresAt 是 ISO 时间，evidenceStatus 为 ready/refresh_required，interrupted 为可选 true。OutlineResult.history 使用此形状。

HistoryItem 继承此元数据，再含 kind(outline/run)、id、productName、audience、scene、platforms、createdAt、updatedAt、可选 version/revision/reviewStatus。GET history 仅返回摘要，按 updatedAt 倒序；没有分页或删除接口。摘要不含事实全文、原图字节、密钥、内部路径或配置指纹。

RunDetail 为 `{result,outlineSnapshot?,history,renderBundles}`：result 是公共 RunResult；outlineSnapshot 是当次生成使用的不可变确认快照，旧兼容稿可能没有；renderBundles 只含该正文尚未到期的成品。读取历史不进行模型或 ima 调用。缺少可信 binding 的旧持久记录仍可读，但 evidenceStatus=refresh_required，不能继续生成/排版。

浏览器 localStorage 仅记录所选 `{kind,id}`；内容来自后端。刷新后按 ID 恢复，不保存正文、Brief、凭证或图片。历史大纲继续读取最新版；历史正文返回自己的旧版大纲快照，与当前版本不一致时只读，允许载入当前大纲或按原 Brief 重新策划，不覆盖后续版本、不复活旧确认。未保存的手动修改不在恢复承诺内。

进行中修改/生成用独立 token 标记。重启后的旧 runtime token 提示上次操作中断，清除内存 busy，不自动重发模型请求；再次成功完成相关操作后可清除该目标旧中断标记，同目标仍在进行的其他 token 不被误删。首次大纲尚未成功时没有可恢复成品。

本地证据记录资料文件、索引和相关原图 SHA-256 与根目录绑定。继续编辑、确认、生成、旧修订或新排版前核对；文件改动、缺失或根目录改变时旧正文仍可读，继续操作 410，并使目录缓存失效以重新读取资料。旧图片句柄不会把改动后的图片冒充原图。

ima 证据与原图仍为获取后 30 分钟，不随历史读取或重启续期。凭证/库名的服务端配置指纹改变时旧证据需重新获取，指纹不返回前端。重启只恢复未过期、配置一致的临时原图与有效句柄；旧来源快照可随历史正文阅读，不代表当前权限或资料已重新验证。

refresh_required 不删除历史正文和原审核结论；前端禁继续 AI 修改、确认、生成和新排版，提供按原任务重新取证策划。已有成品只按其独立 30 分钟有效期和原审核门禁读取，正文七天留存不保证原图或 PNG/ZIP 七天可下载。重新策划会显式发起资料/模型请求，返回新的大纲 ID。

## 9 视觉排版、资源与导出

RenderRequest 精确为 `{runId,revision,platform,selectedTitleIndex,templateId}`。revision>=1 整数；selectedTitleIndex 为 0–2，默认 0，且必须实际存在。未知字段拒绝，包括任意 html、正文、脚本、图片 URL 或路径。大纲正文通常只有确认标题索引 0，旧稿可能有备选标题。

| 模板 ID | 渠道 | 输出 |
| --- | --- | --- |
| wechat-editorial / wechat-warm | wechat | 排版文章 HTML + 1200×900 封面 PNG |
| xhs-cream / xhs-sage | xiaohongshu | 3–6 张 1080×1440 PNG |
| moments-square | moments | 1 张 1080×1080 拼图，含 1–3 张源图 |
| moments-portrait | moments | 1 张 1080×1440 拼图，含 1–3 张源图 |
| poster-paper / poster-ink | poster | 1 张 1080×1920 PNG，最多 3 个卖点 |

公众号模板宽高是封面尺寸，文章为流式长文，不能据此截成封面高度。渲染只解析服务端保存证据的同型号原图，等比缩放，不重绘设备、不复制图片充数；原图数不等于成品数，小红书信息卡不计为新增源图。缺图、重复/错型号或海报段落过多返回 422。使用 evidence 的过期 ima 原图或变动本地源文件返回 410，保留旧正文。

RenderBundle 含 id/runId/revision/selectedTitleIndex/platform/templateId/artifacts/reviewStatus/warnings/copyText/可选 zipUrl/expiresAt。Artifact 含 id/role(article/cover/card/poster)/format(wechat-richtext/png)/name/previewUrl/可选 downloadUrl/可选 width/height/sourceImageIds/factIds。按 artifacts 遍历，以每个 artifact 尺寸为准。

生产资源 URL 为同源 `/api/render-assets/UUID`，下载加 `?download=1`；图片 MIME 为 image/png，文章为 text/html;charset=utf-8，ZIP 为 application/zip，下载含 UTF-8 文件名。原图经 `/api/assets/handle` 获取，不拼 ima 内部媒体 ID 或本地路径。前端可 fetch 下载 Blob，非 2xx 读取 JSON message，失败保留当前正文与完整旧结果。

渲染尝试缩小字号，仍溢出 422，要求回大纲精简，不截断事实或必要条件。渲染超时 90 秒返回 504；缺 Chromium 503。Chromium 拒绝外部请求，文字先转义，只用受控模板与已解析的嵌入 PNG。HTML 配置受限 CSP：无外部脚本/资源，文章 iframe 使用 sandbox。

成品至多 20 组，按创建时间保留 30 分钟并清理；索引随本机状态保存，重启后仍可在原到期时间前恢复，不能重新计时。正文必须仍在七天内且证据当前有效才可新排版；有效本地历史可重新排版，ima 到期必须先取证。换任务/模板/标题应取消旧渲染与资源请求，校验返回的全部绑定信息，不让旧预览冒充新版本。

## 10 审核门禁与发布边界

- blocked：只提供“审核阻断·仅供预览”的标记成品，没有 downloadUrl/zipUrl；直接请求 download=1 也 409；所有渠道复制与下载禁用。
- needs_attention：保留待确认、来源模式和问题，允许带提示下载后人工复核，不能当发布通过。
- passed：只表示本次内容检查通过，仍需发布前复核，不代表账号发布、微信粘贴或印刷验收通过。
- demo/local：始终保留规则演示/本地资料标记，不变成 ima 来源或模型真实输出。

公众号内联样式 HTML 可用 ClipboardItem 同时写 text/html 与 text/plain；剪贴板调用须来自用户点击，并处理不支持/拒绝。文章中的嵌入预览图尚未上传微信素材库，粘贴后仍需逐张上传或替换并核对移动端；未实现微信自动发布。小红书、朋友圈、海报是实际 PNG，可逐张放大/下载，审稿与数量门禁相同。

ZIP 包含视觉成品、文案和“来源与审核.md”，把内部引用映射为依据序号、图片名、资料标题，不含凭证、签名链接、原始知识库全文或服务器路径。Markdown 是方案附件，不替代视觉成品。原始资料、真实生成内容和私有媒体不得写进本次交接版本。

## 11 状态码与前端恢复

| 状态 | 常见原因 | 前端处理 |
| --- | --- | --- |
| 400 | 输入结构/长度、重复渠道、未知字段、引用/模板/标题选择无效、完整模型路径或不允许的 origin、跨服务沿用密钥 | 展示具体错误并保留编辑 |
| 403 | 非允许 Host、写入跨源/跨端口/协议不符 | 使用本机同源或保留 Host 的代理 |
| 404 | 未知路由；原图句柄不存在/过期/变化 | 按实际资源地址获取，必要时重新取证 |
| 409 | 版本陈旧、未确认、修改中、配置锁、阻断下载 | 提示后载入最新大纲，保留或明确放弃本地编辑；不解析中文分支 |
| 410 | 超七天历史、超 30 分钟成品/ima证据、源文件变动、可信 binding 缺失、新排版原图不可读 | 先保留可读历史，按原任务重新取证策划；勿将阅读成功当继续使用许可 |
| 413 | JSON 请求体超过 256 KB | 减少内容后提交 |
| 422 | 必填字段缺失、付费前缺图、已选图数量不合规、渲染溢出、演示不支持自由 AI 修改 | 显示补充问题/配图要求/精简建议，保留当前任务 |
| 429 | 在途操作/正文/渲染并发已满 | 稍后重试，不自动切换模式或重复提交 |
| 502/503 | ima 额度/权限/业务错误、缺运行时、本地历史不可写等 | 展示实际 message，核查服务、缓存目录或 Chromium |
| 504 | 排版超时 | 保留正文，精简或稍后重试 |
| 500 | 模型上游失败、结构校验失败、其他渲染/网络错误 | 保留实际失败原因与已保存记录，不能用占位输出冒充成功 |

ima 业务码按连接器转换，读取额度不足可为 502，不能一律当 429；模型自身超时和上游 503 常为 500 或流内 error，不能假定应用状态直接透传。已知账号池耗尽仍沿用该状态及 `{message}` 外壳，中文说明更明确；前端不应解析错误文本决定重试。取消通常由浏览器本地提示处理。

## 12 前端适配与验收场景

必须处理新增 history 元数据、GET history/RunDetail 包装、旧版 outlineSnapshot、七天与 30 分钟的不同期限；localStorage 仅记 ID，真实与 Mock 选择隔离。恢复旧作品时校验 ID/version、原审核状态与成品绑定；refresh_required 只读并引导重新策划。历史读取不触发隐式模型调用，运行中断不自动恢复付费生成。

ReviewIssue 新字段为可选，旧结果兼容；按 resolution 提供回大纲、重新取证或人工复核提示，auto_text 不解读为最终修复成功。前端必须保留全局 blocked 门禁，即使只有一个渠道出错也不能让其他渠道绕过导出限制。

`?mock=ok/blocked/needs_input/error/empty/slow/expired/conflict/disconnected/insufficient-images` 继续通过浏览器 Mock transport 联调；新增历史读取与恢复按 Mock 能力展示，未知请求不得回退真实 fetch。模拟设置不保存真实配置，模拟验证不宣称真实连接成功。Mock 资源和成品必须明确标识，不能提交其中 ID 给真实接口。生产构建不依赖 docs 目录。

建议验收：同一 Brief 四渠道大纲→编辑保存→确认→SSE 四稿→四次单渠道排版；核对源图上下限、PNG尺寸、HTML完整、条款不裁切及全局审核门禁。额外覆盖缺图零模型、模型选择纠正一次、纯结构问题不盲返修、可修正文最多一次、取消释放锁、409/410恢复、断流、重启/刷新历史、旧版快照、源文件/ima配置变化、缺 binding 只读、独立 token 清理、过期媒体物理删除、磁盘写入失败与损坏不覆盖。

## 13 本轮实际验证与限制

- `npm test`最终142/142通过，0失败、0跳过；模型单文件28/28通过；`npm run check`、包含TypeScript的生产构建及`git diff --check`通过。新增容量回归覆盖JSON/SSE（含分片）、已知耗尽只调用一次、未知503有限重试、上游信息脱敏及200正常正文不误判。五阶段统一网关/模型集成回归保留。
- 本机`.env.local`原子更新URL/model，Key原值保持；源码默认值、页面兜底、环境样例和测试同步切回nccnxta+gemini。9756服务重启后`GET /api/status`读回目标网关、模型和configured=true；该标记不等于生成可用。
- 改善错误处理前，适配器最小生成两次上游503，耗时114840毫秒。供应方原样例（单user、stream=true、无system和max_tokens）同样503，耗时46766毫秒，SSE错误原因为`All available accounts exhausted`，type=server_error。模型目录200含gemini-4-argon，不能把目录可见当作模型可用。
- 增强后的真实四渠道验证脚本已执行，在`POST /api/outlines`失败：应用500、上游503，总耗时99232毫秒；尚未成功创建大纲，没有进入AI修改、正文、返修、审稿或四渠道排版。脚本输出阶段日志并严格核对成品HTTP与门禁，但本轮没有真实成品可供验证。
- 加入已知容量错误识别并再次重启后，实际调用`POST /api/connections/model/verify`于46763毫秒后返回应用500，message明确为“服务商报告当前模型的可用账号池已耗尽，请联系网关服务商恢复该模型线路”。原协议/状态外壳保持，其他临时错误仍有限重试。无需也没有放宽审核、配图、确认或来源门禁。
- 本轮无真实ima、微信粘贴、平台发布或浏览器历史恢复验收；旧gpt-6.1-sol/nccnxta最小成功、styxgate403、旧137/138项测试及旧浏览器记录仅作为继承历史，不能当本轮gemini全链路成功。

[本轮脱敏真实结果](verification/gemini-retry.json) · [本轮本地验证](verification/current-checks.json)。阻断来自服务商报告的该模型可用账号池耗尽，客户端改参数不能据此保证修复；需服务商恢复对应线路后重跑 `npx tsx scripts/verify-relay-workflow.ts`。本轮未自动改用其他模型或网关。

接口路由、字段、HTTP/SSE结构无变化；错误提示及已知容量耗尽时不立即重试属于兼容行为改进，前端继续显示message并保留已保存内容即可。完整历史、来源有效性、审核门禁和本机单人模式保持。历史原件只读，未暂存、提交或推送。

