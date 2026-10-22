当前视觉修订：[麦田循环视频与网站接入](implementation/2026-10-22-wheat-video/README.md)。桌面动态、手机原静帧，暂停/恢复与回退已接入；53测试与构建通过，实际可灵1任务消耗100，余额0。

上一版视觉修订：[60%工作台静帧](implementation/2026-10-22-wheat-opacity60/README.md)。桌面更透、手机保持94%；当前项目Mock及构建通过，11图留档，视频等待新版静帧确认。

上一版视觉修订：[晚霞麦田静帧预览](implementation/2026-10-22-wheat-static/README.md)。封面右移与故事标题已修改，视频等待用户确认静帧；本轮32项相关回归与构建通过，未消耗生成额度。此前整站实现资料与历史验收继续保留。

# Virgo 设计与网站交接

Virgo 已从 Figma 进入本地网站：封面、需求、方案、交付、设置、来源和最近七天记录均接入现有 React 工作流，包含桌面和手机布局、开场、过渡、轻风与鼠标景深。

本轮完整资料见[网站实现与 v3.1 补充](implementation/2026-10-22-web/README.md)，[验证结果](implementation/2026-10-22-web/verification.md)分别记录视觉、浏览器交互、实际 HTTP 演示、模型和 ima。真实模型在大纲阶段遇到上游 503；ima 未配置。本地规则演示成功不能算模型或 ima 通过。

## 当前设计入口

| 内容 | Figma 节点 |
| --- | --- |
| [已确认封面](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=86-31173) | `86:31173` |
| [需求与历史入口](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=103-3039) | `103:3039` |
| [确认营销方案](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=86-26646) | `86:26646` |
| [营销内容与成品](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=86-26866) | `86:26866` |
| [手机需求](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=104-3748) | `104:3748` |
| [七天记录](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=103-3218) | `103:3218` |
| [审核问题处理](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=103-3274) | `103:3274` |

完整桌面／手机补充映射见[本轮节点](implementation/2026-10-22-web/figma-map.json)。15 个新增根画板、74 条动作目标和 8 个禁用导出实例已结构读回；这不是 Figma 人工点击次数。原型编辑器的完整人工点击仍未完成，网站中的实际点击另行记录。

## 设计与实现

品牌仅叫 Virgo，精神「温柔的秩序」，标语「把好产品，讲得恰如其分」，署名「Virgo · 拾穗」。封面沿用花园、晚霞麦田和无翼人物；工作台沿用已确认五色、Pinyon Script 与 Noto Sans SC。工作页没有花园小窗，桌面右上是接入设置／首页，手机是菜单／首页。

[实现交接](implementation-handoff.md)、[品牌规格](brand-and-ux.md)、[设计执行规格](figma-prompt.md)、[变量](tokens.json)、[产品事实](../../../PRODUCT.md)。网站使用 React 19、TypeScript、Vite 6、原有 HTTP/SSE、CSS 和 GSAP；没有更换框架或引入另一套 UI 框架。

旧的[v3 配色稿](workbench/2026-10-21-palette-revision/README.md)、[v2 工作台](workbench/2026-10-21/README.md)、[A3 无翼封面](concepts/2026-10-21-cover-refinement/README.md)、[A2](concepts/2026-10-21-fairy-fusion/README.md)与[原 A/B](concepts/2026-10-20/README.md)保留，原记录不覆盖。网站成品由实际 artifacts 决定，不能把 Figma 中的固定模拟数量当作 API 限制。

本轮已核对，无接口变更。协议与任务归档从[固定接口入口](../../api/README.md)进入；本地交付不等于 Git 提交、推送或云端部署。
