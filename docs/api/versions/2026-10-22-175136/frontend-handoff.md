# 前后端接口交接说明

版本`2026-10-22-175136`；北京时间2026-10-22T17:51:36+08:00；代码基线`17bd7c9262d584ba21795c0604eb993110a56038`，分支`frontend/workbench`，未提交工作区。完整继承上一版`2026-10-22-164240`。

**本轮已核对，无接口变更。** 后端、shared类型、HTTP/SSE、Job幂等/恢复、人工确认与publication门禁保持。前端只新增独立麦田视频背景、播放控制与窄焦点保护，并部署同源MP4/poster；不是新增业务API。历史32/184/53之前的结果不混计，本轮最终相关测试为53项。

[视频交付目录](../../../design/virgo/implementation/2026-10-22-wheat-video/README.md)保留生成/处理/浏览器/截图证据；大视频和图片只链接/hash，不重复复制入本API版本。可灵实际1任务、消耗100灵感值、余额0，状态COMPLETED，没有第二候选、重投或充值。过去静帧的0生成记录仅属于其历史阶段。

共享协议见 [shared/types.ts](shared/types.ts)，校验见 [server/schemas.ts](server/schemas.ts)，[HTTP样例](api-examples.http)和[纯模拟夹具](fixtures/frontend.mock.json)不含真实凭证、产品资料或临时访问句柄。快照仅供阅读，实际入口是 [src/main.tsx](src/main.tsx) → [src/WorkflowApp.tsx](src/WorkflowApp.tsx)，[src/App.tsx](src/App.tsx)保留供旧说明引用。

## 1 启动与边界

Node.js>=22.12；`npm ci`、`npm run setup:render`、`npm run build`、`npm start`。开发用 `npm run dev`，默认127.0.0.1:3000，本次当前实例9756。server/start.ts依次读取.env.local/.env且不覆盖现有环境；直接导入createApp不读取真实环境文件，也不监听端口。开发监听排除.local-state/.cache/output/归档，避免成品写入触发整页刷新。模型配置继续使用当前gpt-6.1-sol和https://relay.nccnxta.cn/v1，Key仅留本机后端；页面设置仅更改进程内配置，重启恢复环境值。

仅接受本机或HOST明确允许的Host；写入Origin须与服务同源，命令行可省略。独立Vite代理保留Host，changeOrigin:false。JSON上限256KB，未知字段按schema拒绝。服务为本机单操作者模式，无多用户租户或远程任务托管。

默认测试预载tests/setup.ts，每worker建立纯模拟知识库、独立状态及AGENT_RENDER_DIR渲染目录，替换凭证且禁止未模拟的外部网络，不读取真实.env.local。Mock网页用?mock=ok/slow/blocked/error/needs_input/empty/expired/conflict/disconnected/insufficient-images；Mock仅内存，刷新会重置其后端模拟，真实后端刷新恢复另有验收。

## 2 工作流、并发与费用保护

填写Brief → 后台分渠道大纲 → 合并editing → 人工编辑/保存或后台AI修改（version+1、撤销确认）→ 人工confirm → “加入生成队列” → 各渠道独立写作→规则→独立模型审稿→必要的一次正文返修与复审→水印预览 → 全渠道最终规则汇总及统一导出门禁。确认本身不触发付费正文。固定标题、段落ID/顺序/标题、factIds与配图不由正文/返修改动。

大纲、AI修改、写作、返修、独立审稿都通过同一Chat Completions适配器。Bearer、system/user、stream:true，读取choices[0].delta.content，兼容非流式JSON。默认单次180秒，上限由现有配置控制至300秒。独立审稿是单独请求，未换另一个厂商。新四渠道无修改/返修/纠正时约12次模型请求；demo规则模式0模型请求。旧不带大纲策略路由仍兼容，调用数另计。

全局模型HTTP槽4，按job公平轮转，旧接口/连接测试也共享；创作任务2，独立render任务2，排版内部总槽2，小红书页面总槽2。HTTP排队时间不计入180秒调用时间。Chromium进程复用，任务context隔离、拒绝外网；取消一个context不关闭另一个。有效渲染身份缓存和图片转换缓存不延长原TTL。

每节点最多2次HTTP尝试，429退避和格式纠正共用预算。确定性JSON解析优先；未知503/502、504/524、网络、超时、断流不自动重放，已知账号池耗尽立即停止。JobError返回stage/platform/upstreamStatus/retryable/outcomeUnknown，界面提示主动重试可能再次计费；模型服务取消后是否仍计费由上游决定，不声称退款或远程exactly-once。

任务先原子持久化再202，成功阶段分别落盘；兄弟渠道失败不撤销其他渠道。返修正文成功但复审失败只续复审，审稿失败不重新写正文。指纹含渠道内容、相关完整事实条件、证据绑定、模型配置及提示词版本，不单用全局outline.version；修改一个渠道可复用其他渠道。显式重试仍校验版本、证据和原配置。

派发前记录调用待确认标记；HTTP成功不等于已保存有效结果，只有同一原子检查点才清除标记。重启后未派发节点可续行，已派发而未检查点的节点interrupted、需主动retry；不自动再发付费请求。只关闭SSE订阅/刷新不取消任务，cancel才传播停止。取消实际清理结束前仍持有配置/大纲冲突锁。

## 3 全部HTTP接口

返回值无统一data/code包装。常规错误为{message}，补充输入为{type:'needs_input',message,fields:[{field,question}]}。新任务异步错误存在job.error及channels[].error。新任务提交错误仍遵循原HTTP状态。

| 方法与路径 | 输入 | 返回与行为 |
| --- | --- | --- |
| GET /api/status | 无 | AppStatus，不含密钥 |
| GET /api/products | 无 | {products:Product[]} |
| GET /api/task-options | 无 | TaskOptions：销售员角色、场景/人群/目标和图片数 |
| POST /api/connections/settings | 可选baseUrl/model/apiKey/imaClientId/imaApiKey/imaKbName | AppStatus；空白保留；跨域需同时提交新Key；运行/排队/取消清理中409 |
| POST /api/connections/model/verify | {} | {verified,message}，真实最小模型调用、共享4槽 |
| POST /api/connections/verify | {} | ima验证后的AppStatus |
| POST /api/jobs | JobSubmit | **202 {job}**；落盘后返回，不等待模型 |
| GET /api/jobs | 可选?idempotencyKey=... | {jobs:BackgroundJob[]}；最近最多100条；精确key查找返回完整任务，普通列表为下述紧凑快照 |
| GET /api/jobs/events | 无 | text/event-stream；只读全局状态订阅，不触发模型 |
| GET /api/jobs/:id | 无 | {job}完整详情，过期410 |
| POST /api/jobs/:id/cancel | {} | {job}；显式取消，完成任务不撤销 |
| POST /api/jobs/:id/retry | {} | {job}；仅failed/interrupted，失败节点及依赖后续，非可重试/配置变化409 |
| POST /api/outlines | Brief | OutlineResult；旧同步接口兼容，图片预检在模型之前 |
| GET /api/outlines/:id | 无 | 当前OutlineResult+history |
| PUT /api/outlines/:id | {version,platforms} | 完整保存，version+1、editing |
| POST /api/outlines/:id/revise | {version,instructions} | 旧同步AI修改；命名渠道可定向，其他保守覆盖所有 |
| POST /api/outlines/:id/confirm | {version} | confirmed，版本不增；人工结构确认 |
| POST /api/generate-from-outline | {outlineId,version} | 旧SSE，兼容progress/result/error/needs_input |
| POST /api/generate | Brief | 旧SSE，含策略阶段 |
| POST /api/revise | {runId,instructions,platforms?} | 旧SSE，新runId、revision+1 |
| GET /api/sample | 无 | demo RunResult，仍需可用本地资料 |
| GET /api/history | 无 | {items:HistoryItem[]}，七天大纲/成稿摘要 |
| GET /api/runs/:id | 无 | {result,outlineSnapshot?,history,renderBundles}，原确认版本快照 |
| GET /api/render-templates | 无 | {templates:RenderTemplate[]} |
| POST /api/render | RenderRequest | 旧同步RenderBundle，按已终审完整RunResult渲染 |
| GET /api/render-assets/:handle | 可选?download=1 | 成品字节；未终审/阻断下载409，过期410 |
| GET /api/assets/:handle | 无 | 经受控句柄读取原始素材；不可传任意URL/路径 |

### 任务输入与幂等

JobSubmit=JobInput+必填idempotencyKey（8–120位字母数字及._:-）。kind区分：outline带brief；outline-revise带outlineId/version/instructions及可选platforms；generate带outlineId/version及可选renders数组（每所选渠道恰好一项platform/templateId/selectedTitleIndex，固定大纲只有标题0）；render带完整request（runId/revision/platform/selectedTitleIndex/templateId）。纯Mock ID不可提交真实后端。

同key同输入返回原任务，异输入409。不同key但相同输入且任务仍排队/运行会映射到原任务；GET按别名key仍可找回原任务，返回对象的idempotencyKey可能是原key。响应丢失须先GET精确key查询，不能盲目新建。前端本地仅保存任务/记录ID及待确认幂等键，不存内容或凭证；未恢复的提交不会自动再次发送。

### 任务状态、事件与详情

JobStatus=queued/running/failed/interrupted/cancelled/completed。JobStage=retrieve/outline/write/review/repair/recheck/render/publish。渠道独立status/stage/error；preview={draft,review,bundle?}不是完整RunResult。只有所有所选渠道终审完成后才提供job.result；本地排版失败可保留已终审完整result并单独续排版，不能把不完整稿件集冒充RunResult。

事件格式：`data: {"type":"snapshot","jobs":[...]}`加空行，15秒心跳注释。GET列表和SSE对queued/terminal任务用detailOmitted:true摘要，summary给产品/场景/人群；省略outline/result/preview，大数组calls/renderBundles为空。running任务保留当前详情。选中摘要须GET/:id；缓存只在同updatedAt与status时复用，后台完成不抢导航。这样七天历史不会在每个事件重复推送全部私有文案。断开自动重订阅，详情请求失败保留已读内容。最近100条以外可用已保存ID详情或大纲/成稿历史继续读取。

调用记录calls提供attempt、queued/started/ended时间、queueMs、firstResponseMs、firstContentMs、maxIdleMs、totalMs、上游状态和安全requestId、可选usage。firstResponse指HTTP头，firstContent仅正文delta；maxIdle含从派发到首次流数据的间隔。网关正常stop后可能不关传输，额外最多100ms收集尾部usage；无usage明确未知，不估账单。内部配置与Key指纹、原始异常体和待确认标记不在公开任务DTO。

旧SSE仍为progress(entry)/result(RunResult)/error(message)/needs_input(message,fields)，没有被新事件类型替换。旧路由断开保留原取消语义，新前端不再用其承载后台任务。旧入口仍受全局模型限额与同大纲冲突保护。

## 4 输入、资料、历史与审核门禁

Brief要求具体productId/audience/scene，1–4个不同渠道，instructions<=2000；其余默认及限制以schemas为准。demo不支持ima。渠道图数：小红书3–6、公众号2–4、朋友圈1–3、海报1。取证后图片不足422，模型调用为0；保存、确认、排版共用数量及同型号/来源/唯一性校验。

大纲人工保存或AI修改撤销确认；已确认标题、段落结构、引用和图片固定，正文模型只能填文本。ReviewIssue可选target/resolution，服务端确定auto_text/edit_outline/refresh_evidence/manual_review。固定标题、段落、引用或图片问题返回大纲，不买无效返修；明确可修正文才一次返修。没有target保守人工核实。规则硬错误不被模型清掉。

只有全部所选渠道终审后按整体review.status开放复制/下载。任何error导致blocked，整组禁止导出。needs_attention可带提示导出，仍需发布前人工复核，不等于publicationPassed。RenderBundle新增可选publication=preview/released/blocked；兼容旧记录没有该字段。

终审前图片字节和HTML含“审核中，仅供预览”水印，copyText为空，无downloadUrl/zipUrl，直接加?download=1仍409。干净底稿只存私有文件，不注册可访问句柄。终审通过门禁后原子注册新正式句柄，旧预览句柄始终保留水印及下载拒绝；blocked发布仍全部带阻断标记。成品HTML以严格CSP+无脚本sandbox预览。

.local-state单进程锁、原子JSON提交；损坏存储保留并503报错，不静默清空。大纲成功持久写入起保留7天，完整成稿从生成完成起7天，job从提交起7天；读不续期。成稿绑定当时确认大纲快照。ima证据及临时素材、成品30分钟；重启/读取/缓存命中/发布都不重置原期限。重启恢复句柄索引。本地原资料/图片以指纹校验，变化后历史可读、需新取证的操作410；重新策划新大纲，不覆盖旧稿。排队取槽后和正式输出提交前再校验来源/期限，避免等待后才消耗或输出失效内容。

HTTP主要状态：400输入或schema；403主机/同源/权限；409版本/确认/冲突/原配置不符/下载门禁；410历史/来源/资源过期或变化；413请求过大；422缺图/必要信息/版式容量；429旧接口限额或队列100个待完成；499显式取消；503本地存储/渲染运行时不可用。模型异步错误以JobError精确说明；不将上游524说成本机180秒超时。

## 5 前端适配与回归入口

[src/BackgroundTasks.tsx](src/BackgroundTasks.tsx)管理任务订阅/恢复/中心，[src/job-state.ts](src/job-state.ts)处理摘要缓存与正式资源替换；[src/api/client.ts](src/api/client.ts)统一真实/Mock与幂等恢复。保留同记录冲突锁；渠道阅读、历史、新任务和其他已完成稿件导出不因后台任务全局禁用。回调验证所属ID/选择代际，不覆盖用户新选记录。RenderPanel卸载仅取消查看资源请求，不取消后台排版。标题/模板/版本身份绑定提交快照。

运行 `npm test`，单文件须 `node --import tsx --import ./tests/setup.ts --test ...`。新回归含jobs、jobs-http、channel-pipeline、frontend-jobs、model-scheduling、render-publication/concurrency/queue-expiry，原历史、来源、HTTP、渲染和模型回归保留。真实验收脚本[scripts/verify-queue-workflow.ts](scripts/verify-queue-workflow.ts)会付费，只显式手工运行，独立状态和成品目录；默认测试不运行它。

## 6 上一版并行后台任务的验收记录与限制

以下结果来自上一版2026-10-22-134225的并行后台任务，非本静帧任务重跑。最终184项测试全通过、0跳过；TypeScript+生产构建、diff检查通过。桌面/手机后台导航、新任务及乱序结果6项，紧凑事件详情恢复3项通过，设计检测[]。真实本地HTTP+纯模拟库浏览器连续刷新后仍在运行并恢复四渠道成稿，0模型请求；以[浏览器记录](verification/queue-browser-refresh.json)为准。重启付费节点保护通过实际原子存储重新创建调度器与故障窗口回归，未做真实上游付费请求中途杀进程的额外消耗实验。

[一次真实四渠道冷启动摘要](verification/queue-real.json)：总114464ms，大纲47153ms，首预览93560ms，生成/审稿/排版67014ms，17次HTTP，2个渠道各返修一次。所有预览/下载/4ZIP均200非空，PNG尺寸和ZIP目录独立解析；review needs_attention，3来源warning+1海报结构warning，无error。没有真实ima、平台发布、逐张真实图视觉验收或账单核对。上次442657ms包含AI修改，本轮未做AI修改，不是严格A/B；上游首响应最长约43秒，本机HTTP排队不足0.13秒，仍不能承诺无524。

接口与前端在2026-10-22-134225已同步；本轮保留上述协议，详见[本版说明](README.md)和[校验清单](manifest.json)。历史版本全部只读，不自动提交或推送。

## 7 上一轮80%晚霞麦田静帧的历史验证与门禁

以下记录属于134626的80%静帧阶段，非本轮重跑。封面hero在宽桌面左起16%、组右界不超56%；窄桌面收回，手机边距保持。故事标题准确为`Virgo-拾穗`。工作台复用已有无人晚霞麦田：固定整屏背景、24%色温罩、桌面80%纸面和仅装饰背景8px模糊；手机94%纸面无模糊；阅读、编辑、输入94%，抽屉、语义卡和固定操作有稳定底。没有新图、视频、Figma修改、调用层或后端修改。

实际项目`npm run build`含TypeScript通过，Vite 8.37秒；`frontend-api`/`frontend-workflow-api`/`channels`32项测试全部通过，0失败/跳过，16066毫秒；diff检查通过。1910/1440/1280/390截图与静态检查无横溢，视频DOM为0。独立8图复核Ship，0必须修复。来源图初拍clip坐标错误已用实际scrollY2220补拍；错误图不作为交付证据。

原项目9756只验收最新集成的桌面1440/手机390静帧烟测。隔离9757沿用014301前端与匹配shared类型，加当前3个视觉文件、public资源及既有依赖；用于避免并行HMR临时PendingJob未定义及Mock内存重置410。隔离Mock实际检查未保存门禁、保存v2、确认v2、生成、长文、来源事实/图片、抽屉焦点进入和Escape恢复；这些不等于新队列持久化或失败续跑验收。手机实际滚到底部，footerBottom712 < fixed actionTop763（视口844），末尾可达。

保守黑底合成边界：80%纸面与24%薄罩下主文字7.57:1、次正文4.61:1、控件边界3.14:1；placeholder在94%输入叠层中补算约4.528:1。这是所列色对的边界计算，未包含禁用态、封面全摄影像素或完整WCAG认证。

未由本轮重跑当前队列完整测试、真实模型/ima、平台发布、系统减少动态切换、触控软键盘或FPS。没有视频，三轮循环、接缝、暂停恢复、播放失败回退均未验收。下一阶段可灵4.0/720p/10秒仅为计划，须用户确认静帧后再执行；本轮无生成、无消耗。没有安装新依赖、提交、推送或部署。

[完整静帧验收](../../../design/virgo/implementation/2026-10-22-wheat-static/verification.md) · [机器记录](verification/wheat-static-verification.json) · [截图清单](verification/wheat-static-screenshots.json) · [源哈希](verification/wheat-static-static-source-checks.json) · [隔离环境](verification/wheat-static-preview-environment.json) · [手机滚动](verification/wheat-static-mobile-reach.json) · [下一阶段视频说明](../../../design/virgo/implementation/2026-10-22-wheat-static/video-brief.md)

## 8 上一轮60%纸面修订的历史验证与适配

以下为164240静帧阶段记录，非本视频阶段执行。桌面（>=761px）主纸面由80%降至60%，辅助文字`#353C40`、必要边界`#4B575D`、placeholder`#616D72`；仍为24%色温薄罩和8px装饰背景模糊。阅读、编辑、输入仍94%；手机主纸面94%、无模糊，旧移动阅读色保留。封面、素材、布局、字体、品牌五色与业务门禁未改，无新增协议适配。

实际`npm run build`包含`tsc --noEmit`与Vite，通过（Vite3.42秒）；`git diff --check`通过。仅CSS视觉修订，未新增单元测试、未重跑API回归或完整队列持久化/续跑E2E；不得将第7节32项或第6节184项记作本轮执行。

当前项目9756 `?mock=ok`实际检查填写页1910/1440/1280/390，长文编辑、来源/审核抽屉及交付，11张原始JPEG。实际操作：长导语编辑→dirty时禁确认/生成→保存v2→确认v2→后台生成→needs_attention交付。抽屉Escape恢复触发按钮焦点。独立7图Ship、0遗留必须修复项。手机交付首次连续切视口捕获暂态窄栏；DOM读回viewport390/client375/paper343/header与title303，单独重拍后独立复核通过，不交付失败首图，不以该首图声称通过。

黑/白背景保守合成最小值：桌面主字5.003、辅助4.690、placeholder4.637、边界外/内3.112/6.476；手机9.783、5.954、4.593、4.056/4.468。禁用态与装饰分隔线除外；这不是完整WCAG认证。浏览器读回均未观察到水平溢出，video元素0。

本轮未调用真实模型/ima、未改Figma、未安装依赖、未部署/提交/推送。视频生成0、消耗0；没有视频循环、接缝、暂停或FPS验收。100灵感值仍只是此前预算；用户确认当前静帧后才重新核对余额与能力并进入可灵4.0/720p/10秒阶段。

[完整交付](../../../design/virgo/implementation/2026-10-22-wheat-opacity60/README.md) · [验收说明](../../../design/virgo/implementation/2026-10-22-wheat-opacity60/verification.md) · [机器验证](verification/wheat-opacity60-verification.json) · [浏览器读回](verification/wheat-opacity60-browser-checks.json) · [对比度](verification/wheat-opacity60-contrast.json) · [11图SHA](verification/wheat-opacity60-screenshots.json)

## 9 本轮麦田视频接入、验证与前端部署

本轮修改WorkflowApp/workbench.css，新增WorkbenchBackground、ambient-playback、workbench-focus及两个回归文件。背景挂在外壳而非keyed步骤正文：首次600ms封面过渡结束后才加载，实际playing后300ms显现；步骤/渠道/抽屉不重建媒体。用户暂停选择在页面内保持，返回首页/页面隐藏暂停并保留时间；业务忙碌不禁用背景控制。媒体失败显示静帧，用户显式恢复才重试；失去桌面fine-pointer/无coarse/无减少动态资格时释放src。业务请求、确认和终审门禁不变。

需随前端部署同源[循环MP4](../../../../public/virgo/wheat-workbench-loop.mp4)和[poster](../../../../public/virgo/wheat-workbench-poster.webp)，记录于public asset-manifest；原批准garden仍是静帧设备的背景。最终MP4为1224×764/H.264/yuv420p、30fps、9.4秒、3235455字节、无音轨、faststart。provider720p档实际返回1224×764/24fps/10.041667秒带AAC；未放大，转30fps只重复帧，经0.6秒交叉溶解循环并去音轨。仅一个可灵4.0任务，100到0，无重投充值。供应商平台水印保留，未擦除或刻意裁剪；网页正常cover可能裁边。不得将生成视频当成真实营销模型或ima业务验收。

最终53项相关测试全通过、0失败/跳过、14794.340385毫秒；`npm run build`含tsc通过，Vite3.30秒；diff检查通过。测试涵盖控制器/真实React Hook集成、现有客户端/队列客户端/工作流API/渠道；没有本轮完整后端恢复E2E。测试/构建日志另存，旧52或更早32/184项不计作本轮最终结果。

当前9756纯Mock实际视频ready4，连续播放62.484秒（9.4秒循环约6.647轮）抽样观察；键盘暂停5.963943秒后切step/首页/返回均精确保留，键盘恢复通过。慢提交期间鼠标暂停/恢复可用。最初后台自动跳step将焦点移到main，Space未暂停的失败如实保留；窄修复仅在背景按钮已聚焦时保持它。最终后台任务运行中Space复测paused=true/focusedBackground=true，其他正常main聚焦保留。

1910/1440/1280/900/390页面、方案、来源/审核及交付共10张原始JPEG；独立8网页+6视频帧Ship，0遗留必修。手机交付首截图暂态窄栏经真实343纸面/303标题读回、单独重拍并独立复核，失败首图不交付。390实读0video、无src、仅原garden静帧。60%/94%纸面与阅读色不变，上一轮保守色对边界仍适用。

验证边界：IAB隐藏panel时document.hidden仍false，未触发真实OS/标签页隐藏；visibility仅Hook事件集成覆盖。coarse/减少动态资格变化、释放、自动播放拒绝及媒体错误由控制器/Hook覆盖，不冒称实体触屏、真实OS减少动态、冷设备网络抓包或浏览器真实404通过。帧统计与62.484秒抽样不构成完整FPS/逐帧质量认证。未做真实营销文案模型/ima、完整后端恢复、Figma、云部署、提交或推送。

[完整视频交付](../../../design/virgo/implementation/2026-10-22-wheat-video/README.md) · [本轮机器验证](verification/wheat-video-verification.json) · [生成记录](verification/wheat-video-generation.json) · [处理参数](verification/wheat-video-processing.json) · [循环统计](verification/wheat-video-loop-analysis.json) · [浏览器](verification/wheat-video-browser-checks.json) · [焦点复测](verification/wheat-video-focus-retest.json) · [53测试日志](verification/wheat-video-final-tests.log) · [最终构建](verification/wheat-video-final-build.log) · [10图SHA](verification/wheat-video-screenshots.json)
