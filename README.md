---
# 详细文档见https://modelscope.cn/docs/%E5%88%9B%E7%A9%BA%E9%97%B4%E5%8D%A1%E7%89%87
domain: #领域：cv/nlp/audio/multi-modal/AutoML
# - cv
tags: #自定义标签
-
datasets: #关联数据集
  evaluation:
  #- iic/ICDAR13_HCTR_Dataset
  test:
  #- iic/MTWI
  train:
  #- iic/SIBR
models: #关联模型
#- iic/ofa_ocr-recognition_general_base_zh

## 启动文件(若SDK为Gradio/Streamlit，默认为app.py, 若为Static HTML, 默认为index.html)
# deployspec:
#   entry_file: app.py
license: apache-2.0
---

# 知序 · 华为 PC 内容工作台

面向销售员的「AI+华为 PC 营销软文智能体」参赛 Demo。先理解客户与场景、共创并确认大纲，再生成有产品依据的正文与四渠道视觉成品。独立参赛作品，非华为官方应用。

前后端协作请从 [接口交接版本索引](docs/api/README.md) 进入最新协议。每次任务新增完整归档，旧版本保留。整体流程与模块见 [架构说明](docs/architecture.md)。

参赛说明材料见 [项目说明书（PDF 与 TeX 源码）](docs/project-manual/README.md)，其中保留文档基线、实际案例来源和验证范围。

## 启动

需要 Node.js 22.12 或更新版本：

```powershell
npm ci
npm run setup:render
npm run build
npm start
```

setup:render 将官方 Chromium 下载至被忽略的 .cache/ms-playwright/，已有下载可复用。中文静态字体与许可已随代码提供，不需要 Python。Windows 可双击 start-demo.cmd。开发模式使用 npm run dev；默认地址 http://127.0.0.1:3000，以终端打印地址为准。本次独立预览使用 http://127.0.0.1:9755。

本地演示无需密钥，但需要获授权的产品资料。新克隆不含原始知识库或 .env.local；无资料时只展示公开型号目录，不伪造事实或拿 Mock 数据代替真实检索。前端布局可使用交接版本内明确标识的模拟夹具。

## 销售员的使用流程

1. 欢迎页查看程序介绍与品牌故事，配置模型 API、模型名称、ima Client ID / Key 与共享库名称，保存并验证。已有环境配置可直接使用。
2. 选择具体产品和系统版本。
3. 选择业务场景、目标客户人群、营销目标与购买阶段。八类场景依据赛题手册整理；支持自定义，切换场景不静默覆盖客户。
4. 选择公众号、小红书、门店朋友圈或门店海报，每次支持 1–4 个不同渠道，可用同一个任务对比四份成品。
5. 填写可选补充要求，先生成大纲。
6. 编辑标题、内容切入、导语、段落要点、事实引用、段落顺序、配图与行动引导，或输入 AI 修改要求。保存后产生新版本；确认当前版本才能生成正文。
7. 查看按已确认大纲生成的正文、来源、配图与独立审核，返回大纲可继续修改。生成视觉成品，预览放大、复制、单文件下载或整组 ZIP 下载。

大纲标题、段落 ID/顺序/标题、引用与配图由服务端固定，模型仅填正文；返修也不能覆盖已确认结构。大纲确认只表示写作方向确定，正文审核仍独立进行。被审核阻断的结果只提供带标记预览，正式下载与复制入口禁用。

## 模式与接入

| 模式 | 文案创作 | 产品资料 |
| --- | --- | --- |
| 本地演示 | 明确标识的规则大纲、规则正文与初检 | 本地 P1 原文及真实图片 |
| 模型 + 本地资料 | 模型大纲、写作、独立审稿，必要时一次修订 | 本地证据，有来源待确认标记 |
| 模型 + ima | 同上 | 账号实际有权读取的指定共享库 |

页面配置只保存在本地后端进程内存，空白字段保留原值；不会回显密钥，不写入浏览器存储、归档或 .env.local，重启后恢复环境配置。本 Demo 是单操作者本机工作台。模型域名只能使用赛事网关或服务启动时配置的域名；新增域名请由后端修改环境配置并重启。

HTTP 仅接受 localhost、127.0.0.1、[::1] 或服务端明确配置的 HOST。写入请求的 Origin 必须与请求的协议、Host 和端口一致；命令行可不发送 Origin。独立前端请通过 Vite 代理访问相对 /api 路径，并保留 Host（changeOrigin: false），不能直接跨端口写入。取消任务后，后端完成实际清理才释放配置锁；此时修改配置仍可能短暂返回409。

持久配置复制 .env.example 为 .env.local，在本机填写：

```dotenv
LLM_BASE_URL=https://api.openai-next.com
LLM_MODEL=claude-opus-5
LLM_API_KEY=
IMA_OPENAPI_CLIENTID=
IMA_OPENAPI_APIKEY=
IMA_KB_NAME=任德耀新建华为PC知识库
```

不要把实际密钥发到聊天或提交仓库。后端使用赛事网关 Anthropic Messages 协议 POST /v1/messages，x-api-key 和 anthropic-version 请求头。仅累计文本响应，格式用 Zod 检查；格式错误允许一次重试，临时服务错误有限重试，默认每次调用超时 180 秒（LLM_TIMEOUT_MS 可调，最高 300 秒）。

DeepSeek Flash 可沿用此协议：在本机 .env.local 设置 LLM_BASE_URL=https://api.deepseek.com/anthropic、LLM_MODEL=deepseek-flash，并将 LLM_API_KEY 换成 DeepSeek 官方密钥，然后重启后端。实际请求路径为 /anthropic/v1/messages，不能将 OpenAI 格式的根地址直接当作此协议入口；参见[DeepSeek 官方兼容说明](https://api-docs.deepseek.com/guides/anthropic_api/)。页面配置仅保存在内存，新域名需先通过环境配置后重启。更换服务商时应使用该服务商的密钥。

本次 DeepSeek 配置使用 LLM_THINKING=disabled，明确发送 thinking:{type:"disabled"}，避免默认思考占用短请求的输出预算。留空或设为 default 时不发送该字段，沿用服务默认行为；其他值在调用前报配置错误。这个后端环境选项不增加前端字段；更改后重启服务。

ima 需加入对应共享库，保留 ima-skill/ima_api.cjs，只读搜索与获取原文和图片；不上传、更改知识库。支持 IMA_CLIENT_ID / IMA_API_KEY 别名和官方配置文件。默认本地资料目录为 华为PC知识库/华为PC全板块深度知识库_v7，可由 LOCAL_KB_ROOT 指定。仅读取当前型号的产品参数与图片，不把历史软文、培训资料或竞品内容当作新事实。

## 四渠道成品

| 渠道 | 已实现输出 | 运行时 |
| --- | --- | --- |
| 公众号 | 内联样式文章 HTML、1200×900 封面 PNG、富文本复制、ZIP | 文颜 Core + Satori / Sharp |
| 小红书 | 大字收藏封面、编号清单内页、深色互动收尾共 3–6 张 1080×1440 PNG | MIT 卡片框架派生模板 + Playwright |
| 门店朋友圈 | 一张社交拼图 PNG，合成 1–3 张原图；1080×1080 方形或 1080×1440 竖形，附独立文案 | Satori + Sharp |
| 门店海报 | 一张 1080×1920 PNG，最多三个卖点 | Satori + Sharp |

策划与写作分别使用渠道专属要求：公众号是问题分析和选择建议，小红书是行动清单，朋友圈是单看点私域沟通，海报是短标题与卖点主视觉。公众号封面、朋友圈图卡和海报使用不同构图树；共用字体与光栅化工具。审核比较标题、开场、段落标题与CTA的重合度，过于相近时保留渠道警告并进入既有一次修订；这个启发式检查不能代替人工判断。

生成后的文字不因排版被重写或截断；会尝试缩放，仍放不下则明确报错。图片从当前证据包解析，保持型号和原图比例；素材不足时拒绝出图，不复制图片充数。成品保留来源/审核标记，ZIP 附文案及可读的来源与审核说明，不含原始知识库全文、签名 URL、凭证或服务器路径。

公众号图片目前是嵌入式预览，尚未上传到微信素材库；粘贴到公众号后需上传或替换图片并复查。未实现自动发布、账号登录、印刷 PDF 或在线图层编辑器。许可、固定版本与已知依赖审计项见 [第三方声明](server/render/THIRD_PARTY_NOTICES.md)。

## 验证与示例

```powershell
npm run check
npm test
npm run build
npm run demo:render
```

demo:render 使用获授权的本地 MateBook 14 鸿蒙版资料，逐渠道完成大纲、确认、正文审核与出图，真实文件保存在 output/four-channel-demo/；该目录因含产品摘录被 Git 忽略。没有本地资料时命令会明确失败。朋友圈现为包含多张原图的一张拼图；小红书页数取决于段落数。

同任务四渠道验收：先在 9755 启动实例，再运行 `npx tsx scripts/compare-channels.ts`（规则演示），或在已授权模型目的地和产品摘录发送范围后运行 `npx tsx scripts/compare-channels.ts --live`（会调用真实模型）。同一 Brief、同一确认大纲、同一次正文结果顺序渲染四个渠道，保存文章、PNG、文案、允许导出的 ZIP、审核与尺寸记录到 `output/channel-comparison-*/`，并生成可独立打开的 `comparison.html`、四图总览 PNG。预览页复制到 `dist/four-channel-comparison.html`，下次 build 会清除；资料和运行产物不进入 Git 或接口归档。

仅修改规则后复核原稿，可运行 `npx tsx scripts/reaudit-comparison.ts <原comparison目录>`。该工具核对所用事实及条件没有变化，保持文案字节内容不变，沿用该稿已有的独立模型审稿，再用当前规则与生产渲染器重算并输出；不重新调用模型，报告会注明这一点。有硬错误则拒绝生成可导出对照。

测试覆盖旧接口、图片型号绑定、模型与 ima 模拟合约，以及大纲版本/确认/取消、真实中文 PNG、溢出拒绝、HTTP 状态、受控渲染输入、审核阻断下载和 ZIP 来源说明。本机另用浏览器走通大纲手动编辑、保存 v2、确认、双渠道正文与实际成品预览。

真实接入与模拟测试分开记录。本轮真实 ima 调用返回“资料获取次数已达上限”，不记为新流程 ima 端到端验收通过；模型 + 本地资料调用已实际完成大纲、独立审稿与带审核标记的成品。审核通过、工具能运行与平台发布是不同结论，不能混用。

## 运行边界

任务、大纲与证据为进程内存，闲置 30 分钟失效；大纲/正文各最多 40 条。正文生成最多两个并行任务，渲染最多两个；渲染超时 90 秒。成品保存在 .cache/render/，30 分钟过期，最多保留 20 组并定期清理。重启后所有任务与成品访问句柄失效，可重新生成。

默认只监听 127.0.0.1，无多用户鉴权、持久化数据库或公开部署配置。模型失败不切换为规则演示；ima 失败不使用本地图冒充正式素材。原文支持 Markdown、文本、HTML 与有权限笔记；PDF / Office 原文当前适配器明确提示不支持。

本机请求来源校验、错误脱敏、模型响应读取上限、渲染文字转义、受控图片来源和前端 SSE/成品绑定有专门回归测试。依赖审计仍有五项中危报告，集中在未调用的 front-matter 依赖链，详见第三方声明；不代表完成公开部署安全验收。

完整实现与交接归档统一维护在 backend/api-handoff 协作分支；队友拉取后按上述步骤启动。密钥、知识库与运行产物仍需在本机配置。
