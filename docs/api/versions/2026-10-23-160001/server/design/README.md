# 服务端视觉规则与制作源

## 当前制作流程

公众号、小红书使用下述 HTML 制作源与确定性视频流程，不依赖外部设计授权。当前生图统一使用火山方舟官方 `https://ark.cn-beijing.volces.com/api/v3/images/generations`，默认模型精确为 `doubao-seedream-5-0-pro-260628`（Seedream 5.0 pro）。海报使用 `poster.ts` 的单页规则 `virgo-poster-image-1.0.0`：围绕一个核心信息编译详细 Prompt，包含准确画内文字、参数及适用条件、构图、字体层级、安全边距与禁止事项，生成整张图片。默认请求 1024×1536，按实际返回尺寸交付；单图非流式请求 PNG/Base64，显式 `watermark:false`，不传 `n`、流式或组图参数。当前适配器不发送参考图，不能保证设备外观精确复刻；真实产品原图、应有文字和事实条件供人工并列核对。中文、外观及型号、参数与条件三项全部确认，且原渠道无审核阻断时，才开放正式图片和 ZIP。生成图片不计入产品证据。协议与模型依据[官方图片生成 API](https://console.volcengine.com/ark/region:cn-beijing/docs/image-generation-api)及[Seedream 5.0 pro 教程](https://docs.volcengine.com/docs/ark/seedream-5-0-pro?lang=zh)；真实调用须先在本机配置新平台 Key，不因默认值迁移自动沿用旧网关凭证。

`layered.ts`、旧视觉规则及外部设计集成仅封存以兼容历史。网站没有连接、编辑、同步或导出操作入口；旧接口和旧任务重试返回 `EXTERNAL_DESIGN_PAUSED`，不派发外部设计请求。本机旧凭证和历史归档保留，旧成品在原期限内可读。以下旧模块说明与许可证记录不代表当前任务会执行该流程。

## 历史分层模块（执行入口已搁置）

`rules.ts` 是项目运行时规则模块：后台视觉阶段实际调用 `buildDesignBrief`、Zod 校验和 `compileImagePrompt`。它不会执行第三方 Skill 中的登录、发布、命令行安装、其他模型或凭证读取。`layered.ts` 按已审核中文、真实产品原图及独立 AI 背景构建 `pptxgenjs 4.0.1` 分层 PPTX，供 Canva 官方二进制导入；Canva MCP 调用由集成模块负责。

规则版本 `virgo-visual-1.0.0`。上游原件和许可证固定在 `vendor/`；`manifest.json` 保存仓库、提交、源路径和 SHA-256。规则模块启动时核对每份文件的实际字节，Prompt 与 PPTX 备注携带规则版本及文件校验值。上游原件未修改，项目改编代码是 `rules.ts`、`layered.ts` 与 `server/render/`。

| 来源 | 固定提交 | 实际采用的方法 | 许可 |
| --- | --- | --- | --- |
| Anthropic canvas-design | dbd4588f9e1033efb41dad4bef2f7947c8993d44 | 视觉重心、尺度、留白、克制色板、对齐和精修检查 | vendor/canvas-design/LICENSE.txt，Apache-2.0 |
| Meitu meitu-poster | 95e563c0a695094403ccf77eb8fe7bd8bb58939c | 需求解构、场景与风格绑定、结构化设计生产指令、产品与 Logo 真实性约束 | vendor/meitu-poster/LICENSE，MIT |
| Jim Liu baoyu-xhs-images | 1567581c26ec29f4216c6e6835415bf30343b0e3 | 封面先建立语言、信息分组、内页一致性和阅读顺序 | vendor/baoyu-skills/LICENSE，MIT |
| Jim Liu baoyu-markdown-to-html | 同上 | 微信兼容内联样式、移动端文字层级和段落节奏 | 同上 |
| PptxGenJS 4.0.1 | package-lock.json 固定 | 真实文本框、独立图片与形状对象；不将整页拍平 | licenses/PPTXGENJS-MIT.txt，MIT |

本项目依据用户已确认的生产方案适配，而非逐条运行第三方交互流程。生图只请求指定的 `gpt-image-2.5` 网关；图片模型不绘制中文字、不重画设备或商标。真实机型原图使用原始嵌入图层和等比缩放，AI 环境素材不计入产品证据。中文、产品名和 CTA 始终为独立文字框。首次标题可以用明确占位符导入，再由真实 Canva MCP 编辑事务替换为已审核标题，返回 `verificationEdit` 供集成层核验。

小红书为 1080×1440，3–6 页；正文与必要条件按原文分组，CTA 在最后信息页，不制造泛化结尾。公众号只创建 1200×510 封面工程，正文由微信兼容 HTML 渲染器交付。海报为 1080×1920，保留一个主标题、产品主体和行动区。朋友圈不调用本模块，交付文案和 1–3 张原图。

`fitLayerText` 使用保守中英文字宽估算和最小字号检查。容量不足明确返回 422，不截断、改写或省略限定条件。中文字体是否被 Canva 正确映射、导入后实际换行是否一致，仍须完成真实 Canva 导入、编辑、导出及视觉验收；本地 XML 结构测试不代替该验收。

## HTML 制作源与确定性动效（virgo-html-1.0.0）

新制作模式使用 `html-rules.ts` 的可执行常量。静态 HTML 的安全边距、正文最小字号、微信行距和段落节奏、视频尺寸/时长/时间线约束实际由渲染器读取；导出的设计 JSON 携带规则版本及上游文件 SHA-256。旧外部设计模式执行入口已搁置，历史成品不自动转换。

| 新来源 | 固定提交 | 运行时实际采用 | 许可证 |
| --- | --- | --- | --- |
| filipe-dev-macae/premium-animations | da3a868899f50c35a56456fe45a2993f41d00598 | 单一视觉重心、静态版式先于动效、克制色板、字体层级和留白；用于 HTML 页面布局与质量检查 | vendor/premium-animations/LICENSE，MIT |
| LukasStrickler/ai-dev-atelier/ui-animation | 251d639e182925a8c77bd651414bb92ddce23ffa | 动效必须服务阅读、优先 transform/opacity、避免闪烁和过度位移；不将界面弹窗时长机械套用到视频阅读时长 | vendor/ui-animation/LICENSE，MIT |
| greensock/gsap-skills | aed9cfd3277740755f6bfc1155c7aa645403b760 | 使用单条暂停时间线、绝对时间和 seek 定位，变换别名和有限缩放；不使用计时器采帧 | vendor/gsap-skills/LICENSE，MIT（Skill 文档许可；GSAP 库本身许可由依赖保留） |
| drewharvey/claude-html-animation-skill | a259265a0d36e5300d43ba2e4cb4fb43cc466fe0 | 自包含 HTML、按时间寻址的确定性帧、明确分镜和安全区；不执行其外部工具安装或发布流程 | vendor/html-animation/LICENSE，MIT |

`server/render/html-design.ts` 实际编排小红书独立封面及步骤、重点说明、适用时的对照内页，并生成 1200×510 公众号封面。真实产品始终是 `object-fit:contain` 的独立嵌入 PNG；AI 背景为另一图层，不参与事实证据。文字不写进图片模型 Prompt，不把条件拆到与事实分离的另一页；单组内容不足以形成三页时返回可操作的 422，不虚构结束页。公众号 `renderWechatArticleWithSource` 输出全部内联样式、真实可复制文本和原比例配图，杂志式及清单式由已有主题选择。

源 HTML 的产品和背景图片全部嵌入，不请求网络。截图时注入项目自带 Noto Sans SC 字体；可编辑源 HTML 使用同名字体与系统中文字体回退，导出源包若提供字体应同时保留 `server/render/fonts/OFL.txt`。静态图片与视频通过 `browser-pool.ts` 共享最多两个 Chromium 页面，各次操作隔离 context，取消不关闭其他任务的页面。排版超过最小 32px 正文字号容量时明确报错，不裁字、不强行缩成难读小字。复制到微信的真实效果仍须在微信编辑器中人工验收，HTML 本地校验不能替代平台实测。
