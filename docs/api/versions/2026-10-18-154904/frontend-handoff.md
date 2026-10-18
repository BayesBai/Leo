# 前后端接口交接说明

版本：2026-10-18-154904。北京时间：2026-10-18T15:49:04+08:00。Git 基线：`bd179010c1175eb362cdecf990e804f6805211e1`，分支 `backend/api-handoff`；未提交工作区以 [manifest.json](manifest.json) 的源文件 SHA-256 为准。

本次研究操作已核对，无接口变更，未实现商城接入。与上一归档 2026-10-18-153034 相比，当前工作区已存在接入配置、任务选项、大纲和成品渲染接口；本版补齐这些已有改动的文档，不将它们归为本次研究实现，也不代表已完成运行验收。

[商城接口研究](vmall-information-api-research.md)记录了匿名成功的外部商品展示请求。KnowledgeSource 仍为 local 或 ima，没有项目内 Vmall 路由。商城接口成功不等于工作台已接入商城。

## 启动与协议

项目根目录运行 npm.cmd ci，再运行 npm.cmd run dev。需要 Node.js 22.12 或以上版本。服务默认端口 3000，本机此前为 9753，以终端输出为准。Express 提供页面与相对路径 /api/...；独立 Vite 前端需配置 /api 代理，同一台机器可代理到 http://127.0.0.1:9753。未提供共享测试部署或跨域响应。

JSON 使用 UTF-8，无统一 data 外壳，错误通常为 { message }。请求体限 32 KB。带 Origin 的修改请求进行来源检查。除配置保存外，修改请求最多同时处理 4 个；正文流最多 2 个；排版最多 2 个，超限 429。密钥仅由受信本地配置表单提交到本项目服务，不进入浏览器持久存储、日志、导出或归档。

输入约束见[校验快照](server/schemas.ts)，响应见[类型快照](shared/types.ts)。[App.tsx 快照](src/App.tsx)供阅读，归档不是独立可运行项目。模拟 ID、句柄和图片占位不可用于真实请求。

## 当前路由

路径均含 /api 前缀。

| 方法与路径 | 输入 | 返回或作用 |
| --- | --- | --- |
| GET /status | 无 | AppStatus，配置及资料状态 |
| GET /products | 无 | { products: Product[] } |
| GET /task-options | 无 | TaskOptions，销售员场景、客户建议及图数 |
| POST /connections/settings | ConnectionSettings，见下文 | AppStatus；更新进程配置 |
| POST /connections/verify | 无 | 验证 ima 后返回 AppStatus |
| POST /connections/model/verify | 无 | 实际模型调用，成功返回 { verified: true, message } |
| POST /outlines | Brief | OutlineResult，初版 version=1 |
| GET /outlines/:id | 无 | 当前 OutlineResult |
| PUT /outlines/:id | { version, platforms: PlatformOutline[] } | version+1，status=editing |
| POST /outlines/:id/revise | { version, instructions } | version+1，status=editing |
| POST /outlines/:id/confirm | { version } | status=confirmed，版本不变 |
| POST /generate-from-outline | { outlineId, version } | 确认大纲生成正文，SSE |
| GET /sample | 无 | 本地规则 RunResult，依赖本地资料 |
| POST /generate | Brief | 保留的直接生成入口，SSE |
| POST /revise | { runId, instructions, platforms? } | 正文修订，SSE |
| GET /render-templates | 无 | { templates: RenderTemplate[] } |
| POST /render | RenderRequest | RenderBundle |
| GET /render-assets/:handle | 可选 download=1 | HTML、PNG 或 ZIP |
| GET /assets/:handle | 返回的图片句柄 | 图片二进制，不可用 404 |

model.configured 表示已配置，不代表连接测试通过。ima.verified 与 local.available 独立，缺少本地资料不应阻止已配置的 ima 模式。

## 任务与接入设置

Brief 为 productId、audience、scene、goal、buyingStage、platforms、instructions、mode、knowledgeSource。产品 ID 从 /products 选择。前三项不能为空，上限依次 180、120、250；goal 上限 160，默认到店体验；buyingStage 上限 80，默认对比选择；instructions 上限 2000，默认空。

platforms 必传、1–2 项、不重复，枚举 xiaohongshu、wechat、moments、poster。mode 为 demo 或 live，来源 local 或 ima。允许 demo+local、live+local、live+ima，demo+ima 返回 400。客户人群是营销对象，销售员是操作者。task-options 提供建议，不是 Brief 新增枚举限制。

接入设置均可选、未知字段拒绝：baseUrl 为 URL、最长 300；model 去空白后 1–100；apiKey 最长 500；imaClientId 最长 300；imaApiKey 最长 500；imaKbName 去空白后 1–120。只应用非空值，空字符串不能清除设置。凭证保存在服务进程内存，重启恢复服务启动配置。

页面设置 baseUrl 仅接受 HTTPS，无账号密码、查询参数或片段，端口默认或 443；域名限赛事默认网关与服务启动时配置的模型域名。其他地址需服务端配置后重启。有运行中的修改任务时保存配置返回 409。连接测试会实际调用模型或 ima，由用户点击触发。

## 大纲编辑与确认

OutlineResult 含 id、version、status、createdAt、confirmedAt?、brief、product、evidence、platforms、warnings。PlatformOutline 含 platform、title、angle、intro、sections、imageIds、cta。每节含 id、heading、points、factIds。返回时移除 evidence.sources 的完整 text，引用使用 facts.quote 与 qualifiers。

大纲平台与任务一一对应；1–8 节，每节 1–4 个要点、最多 10 个事实；海报最多 3 节；段落 ID 唯一。title 去空白后 1–140；angle 最长 300；intro 最长 1000；points 每项去空白后 1–650；imageIds 最多 6 项、不重复且型号匹配；cta 去空白后 1–500。其他字段长度见校验快照。

PUT、AI revise、confirm 均带当前整数 version≥1。保存和修改增加版本并取消确认；confirm 设置 confirmedAt 而不增加版本。版本冲突或正在修改返回 409；不存在、闲置满 30 分钟、重启或容量淘汰返回 410；最多保留 40 个。事实只引用本任务 supported 事实，图片属于当前产品。

demo 的 AI 修改只支持精简、缩短等指令，其他可用 PUT 手工编辑；live 实际调用模型。确认结构不表示事实审稿通过。生成正文必须提交最新 outlineId/version；未确认为 409，证据过期为 410。但当前 SSE 封装对非补充信息错误可能返回 500，前端不可假设所有大纲错误均保留原状态码。

## 正文生成与 SSE

三个正文入口使用 fetch POST JSON 后读取 response.body；原生 EventSource 不支持此请求体。Content-Type 为 text/event-stream；JSON 在 data 行，空行分帧，每 15 秒可能有 heartbeat 注释。支持跨分块 UTF-8、跨分块帧、多帧及 CRLF。

| type | 载荷 | 页面动作 |
| --- | --- | --- |
| progress | entry: TraceEntry | 按 step 更新步骤 |
| result | result: RunResult | 保存完整结果、新 id 与 revision，同步 brief |
| needs_input | message、fields | 提示缺失字段，结束忙碌 |
| error | message | 结束忙碌，保留上次完整结果 |

HTTP 200 不代表最终成功，必须收到 result、needs_input 或 error；无终态断开则提示中断。AbortController 关闭请求可取消，无独立 cancel API。模型单次默认超时 180 秒，总流程可能更久。

正文修订 instructions 去空白后 1–2000、runId 长 1–100；可选 platforms 最多 2 项。未传平台先从指令推断再沿用；要求换平台但未指明目标时提示补充。继承原模式与来源；成功产生新 id、revision+1。正文任务闲置约 30 分钟过期、最多 40 个、重启丢失。

RunResult 含 brief、product、evidence、strategies、drafts、review、trace、revision、notice，可选 outline 引用。按 platform 关联策略与稿件，按 factIds 和 imageId 关联证据。afterBlock=-1 为导语前，0 为第一个正文块后。展示来源与限定条件，不把 supported 等同于实时商城核验。

## 成品排版

RenderRequest 严格接受 runId 长 1–100、整数 revision≥1、platform、整数 selectedTitleIndex 0–2（默认 0）、templateId 长 1–80。模板从服务端取。正文过期 410、版本不一致 409、模板或标题无效 400。

素材来自正文的 /api/assets/ 引用，须同型号、不重复。小红书 3–6 张、公众号 2–4 张、朋友圈 1–3 张、海报 1 张原图；数量或引用不符 422，原图失效 410。海报最多 3 个正文卖点。

RenderBundle 含 id、runId、revision、selectedTitleIndex、platform、templateId、artifacts、reviewStatus、warnings、copyText、zipUrl?、expiresAt。artifact 含 id、role、format、previewUrl、downloadUrl?、width?、height?、sourceImageIds、factIds、name。只使用返回 URL，不拼句柄。

公众号为排版 HTML 与 PNG 封面，图片未上传微信素材库，未自动发布。小红书为 1080×1440 PNG；朋友圈随模板；海报 1080×1920 PNG。以 artifact 实际尺寸为准：当前公众号模板表为 1200×630，但实际封面为 1200×900。

blocked 可带标记预览，没有 downloadUrl 或 zipUrl，强行下载 409；needs_attention 可导出并保留标记。排版不改变审核结论。成品约 30 分钟过期、最多 20 组；句柄失效 410、格式无效 400；重启后旧句柄不可用。排版超时 90 秒为 504，取消可能 499，失败 500，前端保留正文。

## 错误与前端适配

400 为字段错误，403 为跨站修改被拒，409 为版本或状态冲突，410 为任务或素材过期，413 为请求过大，422 为缺失信息或内容约束，429 为忙碌。仅生成流程的补充信息保证带 type=needs_input 和 fields，其他 422 可能只有 message。流建立后用 error 事件报错。

分别维护接入、任务、大纲、正文、排版状态。确认后再保存大纲需重新确认；正文改稿后用新 runId/revision 重新排版。审核 passed、needs_attention、blocked 分别表示检查通过、待确认、待修正，不等同平台发布或独立事实核验。

当前工作区有 src/api.ts 的请求与 SSE 封装及 src/RenderPanel.tsx 成品组件；是否完整接入页面以实际 App 代码和联调为准，本次未运行浏览器验证。旧设计背景资料保留，当前协议以本说明和类型快照为准。

## 联调与验收

先用[模拟数据](fixtures/frontend.mock.json)完成页面，再验证：状态与目录分别加载 → 任务选项 → 大纲生成 → 编辑及冲突 → 确认 → 正文 SSE → 引用与审核 → 模板及标题 → 排版、下载与过期。

覆盖缺少本地库、ima 失败、输入缺失、版本冲突、素材不足、流内错误、取消、审核阻断和过期。[请求样例](api-examples.http)含当前入口。本次只做文档静态核对与商城研究，没有执行应用端到端联调、渲染、模型或 ima 测试。
