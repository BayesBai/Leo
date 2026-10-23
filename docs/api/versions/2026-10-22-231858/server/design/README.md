# 服务端视觉规则与可编辑文件

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
