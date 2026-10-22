# Virgo 网站实现与 v3.1 设计补充

本目录记录将已确认的 Virgo v3 设计接入现有 React／Vite 工作台的本轮交接。旧的冻结设计资料保留；此处新增七天历史、历史恢复状态和审核问题处理的 Figma 补充证据。

当前状态：Figma v3.1 补充与本地网站实现完成。最终 142 项测试、类型检查和生产构建通过，验证前后关键源码哈希一致；视觉、交互、实际 HTTP 规则演示、真实模型与 ima 的结论分别记录。查看[本轮验收](verification.md)及[机器可读清单](verification.json)。

## 设计入口

| 内容 | 桌面 | 手机 |
| --- | --- | --- |
| 需求与历史入口 | [需求](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=103-3039) | [需求](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=104-3748) |
| 受阻作品与审核入口 | [交付](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=103-3123) | [交付](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=104-3835) |
| 历史：有记录 | [记录](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=103-3218) | [记录](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=104-3908) |
| 历史：空状态 | [空状态](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=103-3233) | [空状态](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=104-3923) |
| 历史：来源或成品过期 | [过期状态](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=103-3242) | [过期状态](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=104-3932) |
| 历史：操作中断 | [中断状态](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=103-3258) | [中断状态](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=104-3948) |
| 审核问题处理 | [审核](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=103-3274) | [审核](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=104-3964) |
| 手机菜单与历史入口 | — | [菜单](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=104-4010) |

基础风格、封面、需求、方案和交付的完整基线见 [v3 配色修订](../../workbench/2026-10-21-palette-revision/README.md)。本次补充的顶部品牌栏沿用原布局：桌面为接入设置／首页，手机为菜单／首页。历史入口分别放在本次创作摘要和手机菜单中，没有新增顶部独立按钮。

## 文件

- [节点映射](figma-map.json)：补充帧、浮层、基线与页面 ID。
- [结构检查说明](figma-review.md)与[完整读回](figma-structure-readback.json)：文字、动作、目标、阻断控件及检查边界。
- [创建账本](figma-node-ledger.json)：设计负责人提供的本轮节点记录，供追溯；不是重新清点全文件。
- [Figma 历史预览](previews/figma-history.png)、[Figma 审核预览](previews/figma-review.png)与[截图来源](previews/provenance.json)。

## 实现约束

已有七天大纲／正文历史和 30 分钟证据／成品期限应继续保留，不能依据图稿简化为仅本次会话。过期提示不应删除仍可阅读的正文；中断后不自动重复调用模型。接口规则以[固定接口入口](../../../../api/README.md)为准。

审核处理继续区分回方案修改、重新获取资料和人工核实。人工核实、方案确认或切换渠道都不能解除全局审核阻断。阻断状态保留带标记预览，所有渠道复制、单文件与整组下载停用。方案保存或调整后需要重新确认，成品绑定正文版本、渠道、所选标题与模板。

网站源码入口为 [WorkflowApp](../../../../../src/WorkflowApp.tsx)、[TaskForm](../../../../../src/TaskForm.tsx)、[OutlinePage](../../../../../src/virgo/OutlinePage.tsx)与[RenderPanel](../../../../../src/RenderPanel.tsx)。Figma 是设计来源；实际产品、文字、来源、图片、审核和文件数量由现有接口提供，不能把有限模拟帧硬编码成业务结果。

## 网站与验收证据

- [本轮验证](verification.md)与[JSON 记录](verification.json)。
- [19 张浏览器截图](browser-screenshots.json)：1440／1280／390、来源、历史、审核及异常。
- [动效与手机滚动证据](motion/README.md)、[素材优化](asset-performance.json)。
- [实际 HTTP 脱敏记录](live-validation.json)：本地规则四渠道链路通过；真实模型大纲上游503；ima 未配置。后续并行网关修改不倒写为本轮模型成功。

此目录不代表 Git 提交、推送或云部署。旧 Figma 设计及历史接口归档保持原样。
