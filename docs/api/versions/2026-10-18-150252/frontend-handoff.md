# 前后端交接说明

你负责后端与 AI 工作流，前端队友负责页面设计和交互实现。交接以接口、数据结构、页面状态和验收用例为共同约定，前端可以独立调整视觉布局。

版本：交接草案 v0.1。日期：2026 年 10 月 18 日。依据：当前代码及已推送的 `593b89c` 基线。下文的接口行为已经实现；协作流程与验收安排供双方确认。

## 分工与交付物

| 事项 | 后端负责人 | 前端负责人 |
| --- | --- | --- |
| 任务输入 | 维护字段校验、默认值和错误信息 | 实现表单、长度限制、平台选择和补充信息提示 |
| 模型与知识库 | 维护模型协议、ima 连接、事实及图片读取 | 显示可用状态、来源和连接错误 |
| 生成与修改 | 维护策划、写作、审稿、修订和取消 | 展示进度、结果、修改入口和停止按钮 |
| 事实与配图 | 返回事实编号、原文、限定条件和素材关系 | 实现引用跳转、图片位置、图注和图片异常占位 |
| 审核 | 返回审核状态、问题及建议 | 显示待修正或待确认，允许查看具体问题 |
| 导出与历史 | 返回结构化结果和可修改的任务 ID | 维护会话历史、标题选择、复制与 Markdown 导出 |
| 协议变更 | 更新类型、文档和样例，告知影响 | 确认页面影响，完成适配 |

交接包包含本说明、[共享类型](shared/types.ts)、[请求样例](api-examples.http) 和 [纯模拟数据](fixtures/frontend.mock.json)。模拟数据不含知识库摘录和密钥，既未调用模型，也未进行真实产品核验。

## 开工与联调环境

### 在现有项目中设计页面

```powershell
git clone https://github.com/BayesBai/Leo.git
cd Leo
npm ci
npm run dev
```

需要 Node.js 22.12 或以上版本。现有开发命令由 Express 同时提供前端与 API，前端直接请求相对路径 `/api/...`。默认端口为 3000；后端负责人本机当前使用 9753，以终端打印地址为准。

新克隆的仓库不含 `.env.local`、原始知识库、构建产物和运行记录。`GET /api/products` 仍可返回公开型号目录；没有本地知识库时，`GET /api/sample` 和本地生成可能失败。初始化时分别处理状态、目录、示例的请求结果，示例失败不应阻止页面或正式 ima 模式使用。

前端进行独立设计时，可以读取夹具：

```ts
// 示例位置为 src 下的模块。
import fixture from '../docs/api/versions/2026-10-18-150252/fixtures/frontend.mock.json';

const status = fixture.status;       // 对应 GET /api/status
const products = fixture.products;   // 对应 GET /api/products，含 products 数组
const result = fixture.result;       // 对应 GET /api/sample 或 result 事件内的 result
```

这是供前端映射的静态数据，当前后端没有内置 Mock 启动开关。模拟产品 ID 仅用于布局，不可提交给真实生成接口。真实模式需要后端配置自己的模型和 ima 访问凭证，前端不接收这些凭证。

### 独立前端项目连接后端

独立 Vite 前端可把 `/api` 代理到本机运行的后端，图片也经过相同代理：

```ts
server: {
  proxy: {
    '/api': { target: 'http://127.0.0.1:9753', changeOrigin: true }
  }
}
```

该配置片段用于独立前端项目；现有项目的 `npm run dev` 不需要额外代理。真实后端当前仅监听本机，未配置跨域响应。若两人使用不同电脑，后端需另行提供实际可达的联调地址；`127.0.0.1` 始终指访问者自己的电脑。

## 接口约定

接口前缀为 `/api`，JSON 使用 UTF-8。请求结构见 [输入校验](server/schemas.ts)，响应类型见 [shared/types.ts](shared/types.ts)。服务端目前没有统一的 `{ code, data }` 外壳，也没有业务错误码字段；不要根据中文错误文本编写业务分支。

| 方法与路径 | 输入 | 返回 | 前端用途 |
| --- | --- | --- | --- |
| `GET /status` | 无 | `AppStatus` | 配置与连接状态 |
| `GET /products` | 无 | `{ products: Product[] }` | 型号选择 |
| `GET /sample` | 无 | `RunResult` | 本地规则示例，可能因缺少本地资料而失败 |
| `POST /connections/verify` | 无需请求体 | `AppStatus` | 验证指定 ima 共享库访问能力 |
| `POST /generate` | `Brief` | SSE 事件流 | 新建生成任务 |
| `POST /revise` | 下文的修改请求 | SSE 事件流 | 修改已有任务 |
| `GET /assets/:handle` | 返回的图片 URL | 图片二进制 | 展示图片，失效返回 404 |

`AppStatus.model.configured` 只说明服务端配置了凭证，不保证本次模型调用成功；`ima.verified` 表示当前进程已验证访问指定库。`local.available` 与 ima 访问能力独立，缺少本地库不应禁用已配置的正式 ima 模式。

### 新建任务

```json
{
  "productId": "pc-e2ef2fa0bf44cc5a",
  "audience": "大学新生",
  "scene": "开学购机",
  "goal": "到店体验",
  "buyingStage": "对比选择",
  "platforms": ["xiaohongshu", "wechat"],
  "instructions": "语气自然，保留版本限定条件",
  "mode": "demo",
  "knowledgeSource": "local"
}
```

示例产品 ID 来自当前公开目录。实际页面必须从 `/api/products` 取得 ID，不根据型号名称或下拉框顺序生成 ID。

| 字段 | 约束 |
| --- | --- |
| `productId` | 必须选择；最长 180 字符 |
| `audience` | 去除首尾空白后非空；最长 120 字符 |
| `scene` | 去除首尾空白后非空；最长 250 字符 |
| `goal` | 最长 160 字符；省略或空白时为 `到店体验` |
| `buyingStage` | 最长 80 字符；省略或空白时为 `对比选择` |
| `platforms` | 必传；1 至 2 项且不可重复 |
| `instructions` | 最长 2000 字符；默认空字符串 |
| `mode` | `demo` 或 `live`；默认 `demo` |
| `knowledgeSource` | `local` 或 `ima`；默认 `local` |

平台枚举固定为 `xiaohongshu`、`wechat`、`moments`、`poster`。创作方式支持 `demo + local`、`live + local`、`live + ima`；`demo + ima` 会返回 400。一次生成最多选择两个平台。

### 修改任务

```json
{
  "runId": "从最近一次 result.id 取得",
  "instructions": "精简文案，改成朋友圈",
  "platforms": ["moments"]
}
```

`runId` 必传，最长 100 字符；`instructions` 去空白后需 1 至 2000 字符。`platforms` 可省略：服务端先尝试从修改要求推断，否则沿用上次平台；显式传值优先。修改接口继承原任务的产品、模式和来源，更换产品或模式需重新调用 `/generate`。

修改成功会返回新的 `id`，前端之后使用新 ID。`revision = 1` 表示初稿，`revision = 2` 表示第一次修改。任务在进程内存中保存，闲置 30 分钟过期；最多保留 40 个，重启也会丢失，修改过期任务返回 410。前端当前没有历史查询接口。

## 流式事件与页面状态

生成与修改使用 `fetch` 发出 POST，然后通过 `response.body` 读取 SSE。原生 `EventSource` 无法直接承载这里的 POST JSON 请求体。可复用当前 [App.tsx](src/App.tsx) 中的 `consumeStream` 解析逻辑。

返回头为 `Content-Type: text/event-stream; charset=utf-8`。事件使用 `data:` 携带 JSON，以空行分隔；后端没有发送 SSE `event:` 或 `id:` 字段。事件类型取自 JSON 的 `type`。

```text
data: {"type":"progress","entry":{"step":"retrieve","label":"读取资料与图片","status":"running","detail":"正在读取指定 ima 共享库","at":"2026-10-18T06:00:00.000Z","elapsedMs":100}}

data: {"type":"error","message":"读取资料失败，请检查连接后重试。"}

```

以上为协议示意，JSON 必须逐帧解析；完整成功事件可用 `{ type: 'result', result: fixture.result }` 构造，夹具还提供 `progressEvents`、`terminalEvents.needs_input` 和 `terminalEvents.error`。

| `type` | 载荷 | 页面行为 |
| --- | --- | --- |
| `progress` | `entry: TraceEntry` | 更新阶段和进度文案，不把字符数当作百分比 |
| `result` | `result: RunResult` | 用完整结果替换预览，保存新任务 ID，并以 `result.brief` 同步表单 |
| `needs_input` | `message`、`fields: [{ field, question }]` | 提示具体缺失字段，转回任务表单 |
| `error` | `message` | 显示错误，保留上次完整结果供参考，允许重试 |

解析器需处理 UTF-8 字符跨网络分块、一个分块多事件、一个事件跨多个分块，以及 `\n\n` / `\r\n\r\n` 分隔。每 15 秒的 `: heartbeat` 是注释，应忽略。相同 `entry.step` 会多次更新，修订中还可能重跑审稿；最终执行记录以 `result.trace` 为准。

HTTP 200 只说明流已建立，仍可能收到 `error`。收到 `result`、`needs_input` 或 `error` 才是本次任务的终态；连接结束但没收到终态应显示连接未完成。`review.status` 是内容审核结果，与请求是否成功分开显示。

建议状态流为 `idle → generating → success / needs_input / error`，修改时使用 `revising`，用户取消时回到可编辑状态。生成或修改期间禁用重复提交与任务表单，保留停止按钮；正常终态后恢复操作。

停止生成通过 `AbortController.abort()` 关闭 fetch，后端会中止对应处理；当前没有 `/cancel` 接口。取消时保留上次成稿，不把其误标为本次新结果。单次模型调用默认超时 180 秒，整个任务包含多次调用和可能的修订，总时长可能超过 180 秒。

## 数据与组件的对应关系

| 页面模块 | 读取字段 | 展示约定 |
| --- | --- | --- |
| 产品与任务表单 | `products.products`、`result.brief` | 草稿生成成功后同步实际使用的任务条件 |
| 平台策略 | `strategies[]` | 用 `platform` 关联稿件，不按数组下标关联 |
| 图文卡片 | `drafts[]` | 标题候选、导语、正文块、CTA、话题、图片分别渲染 |
| 引用原文 | `blocks[].factIds → evidence.facts[].id` | 展示 `quote`、`qualifiers`、`sourceTitle` 与可用来源链接 |
| 图片编排 | `draft.images[].imageId → evidence.images[].id` | 展示图片、图注、位置、理由、来源，找不到时使用缺图占位 |
| 核验面板 | `review.checks`、`review.issues` | 显示具体问题、修改建议和所属平台 |
| 执行记录 | `trace[]` | `at` 为 ISO 时间；`elapsedMs` 为任务开始后的累计耗时 |
| 来源说明 | `notice`、`evidence.sourceMode`、`review.reviewedBy` | 明确区分本地规则、真实模型与 ima 资料 |

`Draft.blocks` 的 `heading` 可能为空。`titles` 是候选标题；用户在前端选择标题不需要重新生成。`tags` 渲染时兼容已有或未有 `#` 的情况。

`afterBlock = -1` 表示封面，放在导语前；`afterBlock = 0` 表示第一个正文块后，依此类推。同一段后可以有多张图。图片数量规则为：小红书 3 至 6 张、公众号 2 至 4 张、朋友圈 1 至 3 张、海报 1 张；实际素材不足时显示审核提示，不复制图片凑数。

图片使用返回的 `url`，不拼接内部 ID。真实图片通常是 `/api/assets/<handle>`；ima 图片句柄约 30 分钟后过期，返回 404 时提示重新生成，当前没有独立图片刷新接口。外部 `sourceUrl` 可缺失，链接不可用时仍展示来源标题。`evidence.sources[].text` 不会从结果接口返回完整原文，引用依据使用 `facts[].quote`。

审核状态：`passed` 显示检查项通过，`needs_attention` 显示待确认，`blocked` 显示待修正。某个问题未带 `platform` 时作用于整个任务。`supported` 仅表示已取得支持原文，不表示官网或销售 SKU 已实时复核；规则检查也不等于独立模型审稿。

`review.imageCount` 是所有稿件使用的不同素材数，同一素材在两篇稿件中复用只计一次；它不等于所有图片插入位置的总数。

复制和 Markdown 导出目前在前端完成，没有 `/export` 接口。导出保留场景判断、知识库依据、图文软文、核验结果四部分；将内部编号转成可读标签，不包含临时图片地址或签名 URL。

## 错误处理约定

| 时机与状态 | 当前响应 | 前端处理 |
| --- | --- | --- |
| 400 | `{ message }` | JSON 格式或字段类型、平台等校验失败，提示检查输入 |
| 422 | `{ type: "needs_input", message, fields }` | 必填字段为空，定位并补充对应表单项 |
| 410 | `{ message }` | 修改任务不存在或过期，提示重新生成 |
| 429 | `{ message }` | 当前已有 2 个任务运行，等待或取消后再试 |
| 413 | `{ message }` | JSON 请求体超过 32 KB，缩短输入 |
| 404 | 图片接口 `{ message }` 或未知接口错误 | 图片占位；接口地址错误交由开发定位 |
| 500 或其他非 2xx | 通常为 `{ message }` | 配置、连接、资料读取等错误；展示消息并允许重试 |
| SSE 已建立后失败 | HTTP 200 内的 `type: "error"` | 结束忙碌状态，显示错误，保留上次完整成稿 |
| 网络断开且无终态 | 没有完整结果 | 提示连接中断，由用户重试 |

JSON 错误响应解析失败时，至少保留 HTTP 状态和通用错误提示。前端不自动把真实模型失败改成本地规则结果，不把错误消息中的配置变量当作让用户填写密钥的表单。

## 双方验收清单

前端先用纯模拟数据完成布局与状态验收，再由双方使用真实后端联调。真实调用由后端提供有权使用的资料和接口配置。

| 场景 | 验收标准 |
| --- | --- |
| 新克隆且没有本地知识库 | 页面可打开、目录可选，示例失败不阻塞其余区域 |
| 两个平台生成 | 可同时预览，平台匹配正确，策略和图片数量分别展示 |
| 点击事实引用 | 定位正确原文，并保留限定条件与来源 |
| 展开配图 | 封面、正文插入位置、图注、选图理由和来源完整 |
| 流式分块与心跳 | 中文不乱码、不漏事件；心跳不进入成稿 |
| 待确认或待修正 | 页面、平台卡片和导出保留相应状态 |
| 补充信息与错误 | 422、410、429、SSE error 均能退出忙碌状态并给出可操作提示 |
| 停止与重试 | 停止关闭当前流，保留旧稿；下一次能正常提交 |
| 修改与切换平台 | 使用最新任务 ID，收到结果后同步平台与版本标记 |
| 图片过期或缺失 | 使用占位和提示，整体页面仍可操作 |
| 复制与导出 | 四部分齐全，不泄露密钥、签名 URL、临时素材地址和内部编号 |
| 窄屏 | 任务、内容、依据均可访问，无页面横向溢出 |

## 建议协作流程

先用 15 分钟确认本说明中的字段、状态和分工，然后按三个交付点推进：前端用模拟数据完成主页面；双方跑通生成、查看依据与修改；最后完成异常、窄屏和导出验收。

建议你使用 `backend/...` 分支维护 `server/`，队友使用 `frontend/...` 分支维护 `src/`，通过 PR 合并。`shared/types.ts`、依赖配置和本说明由双方共同评审，避免一方修改枚举或响应结构后另一方仍按旧约定开发。前端重构请求逻辑时可将请求与 SSE 解析迁到 `src/api/`，让界面组件只处理页面状态。

接口发生变化时，同步更新共享类型、输入校验、文档、请求样例和模拟数据。PR 写明变更字段、兼容方式、受影响页面和联调结果。遇到问题时提供请求路径、脱敏请求体、HTTP 状态、终态事件和必要截图，密钥与完整知识库不进入讨论记录。

## 两人对接接口的执行顺序

下面是针对当前同一仓库的协作建议。你继续负责 server，队友负责 src；先完成静态页面，再在配置真实接口的机器上集成验收。以下没有新增后端接口或前端请求模块。

### 第一步 确认当前接口与样例

双方先阅读本版交接说明、共享类型和请求样例。你提供每个接口的输入、响应、错误和 SSE 事件，队友按同一结构组织组件。模拟产品和模拟任务 ID 不发送给真实生成或修改接口。

### 第二步 队友独立设计页面

队友从本版 fixtures/frontend.mock.json 读取产品、双平台稿件和状态样例，并把数据加载与界面渲染分开。先检查正常结果、生成中、待确认、待修正和失败状态。开发中可以自行增加模拟适配层；仓库当前没有内置 Mock 启动开关。

建议后续把请求函数和 SSE 解析抽到 src/api/client.ts，统一提供 getStatus、getProducts、verifyIma、generate、revise，由组件消费结构化结果。这个路径和函数名是模块拆分建议，当前尚未新增这些文件或导出。

### 第三步 在后端电脑完成首次真实联调

你先使用本机资料和后端配置确认接口可用，再集成队友提交的前端改动，在项目根目录运行 npm ci 与 npm run dev。现有开发服务同时提供页面和 API，前端统一使用相对路径 /api/...；模型和 ima 凭证留在后端。

队友使用独立前端项目时，可在运行后端的同一台电脑用 Vite 代理连接后端，具体示例见前文。队友的另一台电脑不能通过你的 127.0.0.1 地址访问你的后端。若要两台电脑实时直连，需另外确认可达的联调地址、访问范围和代理配置；当前后端只有本机服务，未提供共享测试环境。

| 联调顺序 | 请求或操作 | 通过标准 |
| --- | --- | --- |
| 1 | GET /api/status 与 GET /api/products | 状态与目录分别加载；一个失败不使全页不可用 |
| 2 | 正式 ima 模式需要时 POST /api/connections/verify | 显示实际验证结果；未通过时仍可查看其他页面区域 |
| 3 | POST /api/generate | POST JSON 正确，读取 progress，最后处理 result、needs_input 或 error |
| 4 | 查看结果和依据 | 平台用 platform 对应；事实和图片按 ID 关联，图文位置正确 |
| 5 | POST /api/revise | 使用最新 result.id；完成后保存新的 ID，并同步返回的 brief |
| 6 | 停止、失败与导出 | 关闭流后可重新提交，保留旧稿；导出保留审核状态 |

GET /api/sample 是可选的本地示例入口，不是正式 ima 生成的必要前置条件。HTTP 200、收到完整 result、内容审核通过分别表示不同层次的结果，需要分别处理。

### 第四步 按功能合并和验收

建议分别使用 backend/... 与 frontend/... 分支，每完成一个功能就提交可联调改动。PR 中带上对应文档版本、请求样例、页面截图和实际测试结果。修改 shared/types.ts 或接口行为时，先说明前端需要适配的字段，再随代码提供新交接版本。

每次联调集中检查一个闭环：填写任务 → 生成 → 查看原文与图片 → 修改 → 查看核验 → 导出。然后补测字段缺失、任务过期、SSE 内报错、取消和图片失效。遇到错误时同时提供路径、脱敏请求、HTTP 状态和终态事件，便于区分传输、协议和页面映射问题。

交接文档、请求样例和模拟数据需要随代码提交到团队仓库，队友拉取对应版本后才能复现；本机新增归档不会自动出现在 GitHub。
