# Virgo 工作台、组件与动效

本轮在同一 Figma 文件制作新版奶油工作台与原型。A3 静态封面、旧页面和旧组件保留。本轮不修改 React、后端、共享类型或接口，不安装动画依赖。

## 设计入口

| 内容 | Figma |
| --- | --- |
| 1 秒开场与桌面流程 | [从动态封面开始](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=64-2451) |
| 填写需求 | [桌面工作台](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=61-145) |
| 确认方案 | [摘要、编辑与版本确认](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=61-368) |
| 成品交付 | [左文案、右视觉成品](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=61-883) |
| 手机流程 | [390 手机封面](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=62-2596) |
| 完整减少动态流程 | [静态封面与 ≤100ms 过渡](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=68-3016) |
| 组件库 | [新版语义变量与组件](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=59-145) |
| 完整长页面审阅 | [独立可编辑的完整布局](https://www.figma.com/design/JfR3uVD884firgx27czG8M?node-id=71-3017) |

Figma 中桌面、手机和减少动态分别在自己的 Page 内连接，避免跨页跳转失效。主原型画板为 1440×1000／390×844 的可滚动视口；完整布局审阅保留长页面，方便检查页尾与编辑结构。另有 1280 收缩参考。

## 已交付

- 奶油纸面、深绿文字和小幅花园窗景；Pinyon Script 字标与 Noto Sans SC 中文。
- 三个业务页面、双端布局、版本编辑与确认变体。
- 新版 70 个组件变体／独立组件、15 个组件集，包含按钮、输入、渠道、步骤、审核、来源、生成阶段及模板。状态以本轮节点记录为准，不与旧库总数混算。
- 四渠道分别表现图卡、公众号文章与封面、朋友圈单张拼图、门店竖版海报。预览与放大保持渠道形态，小红书有三张模拟图卡浏览。
- 接入设置、来源、预览及反馈浮层；产品加载／无资料／未就绪／取消／断流／409／410／成品失败等恢复画板。
- 手机底部主操作与安全区域；当前主要操作同步原型目标，阻断时禁用。
- 原生时间轴、景深左中右视角、暂停／恢复动景、返回首页跳过开场，以及独立完整减少动态原型。

需求原型提供常用双渠道与全选四渠道两条示例分支；单个输入的自由编辑、任意渠道组合和真实业务响应留到网站验证。Figma 的控件及状态稿用于表达产品规则，不替代功能实现。

## 动效演示

| 演示 | 文件 |
| --- | --- |
| 首访开场 | [opening.mp4](motion/opening.mp4) |
| 花园收束为工作台 | [enter-workbench.mp4](motion/enter-workbench.mp4) |
| 花草轻风示范 | [garden-breeze.mp4](motion/garden-breeze.mp4) |
| 组件反馈示范 | [components.mp4](motion/components.mp4) |

这些是 Figma 原生时间轴的演示导出，不是用于网站背景的循环视频素材。没有制作真实鼠标跟随；视角稿只定义远景 ±2px、人物及阴影 ±6px、近景 ±10px 的范围。

[动效与响应式规格](motion-spec.md) · [交互与验收记录](verification.json) · [实色对比度检查](contrast.json) · [语义变量](tokens.json) · [完整节点记录](figma-map.json)

## 页面预览

[需求](previews/desktop-task.png) · [方案](previews/desktop-outline.png) · [交付](previews/desktop-delivery.png) · [审核阻断](previews/desktop-blocked.png) · [1280](previews/desktop-1280.png)

[手机封面](previews/mobile-cover.png) · [手机需求](previews/mobile-task.png) · [手机方案](previews/mobile-outline.png) · [手机文案](previews/mobile-copy.png) · [手机视觉](previews/mobile-visual.png) · [手机阻断](previews/mobile-blocked.png)

## 实际验证与限制

- 桌面和手机结构审核未发现文字横向越界、失效目标、跨页跳转、方案渠道切换丢版本或审核阻断导出入口。分别检查 26／44 个阻断导出控件，均禁用且无动作；版本保持的方案渠道跳转分别为 72／70 条。
- 读取了“未保存 → 保存 v2 → 确认 v2 → 写作 → 独立审核 → 等待出图 → 排版 → 成品”的原型目标；大纲 v2 对应示例正文 v1。结构检查不等于人工点击。
- 减少动态版目标均在本页，过渡不超过 100ms；手机不启用持续摆动或景深。
- 14 张静态 PNG 已独立视觉复核，结论为 Ship。修正了手机字标、遮罩接缝、菜单对比、1280 尺寸、桥接终帧与审核语义文本；辅助文字最终使用 `#586253`。22 组实色文字与背景组合达到 4.5:1，照片背景未做逐点 WCAG 验收。
- 四段原生动效均已导出并按阶段抽帧，最终桥接检查 0／0.3／0.6 秒；没有用静态截图代替动效检查。
- 尝试通过内置浏览器打开 Figma 原型，30 秒后超时。**完整人工点击、真实键盘焦点捕获与恢复未完成**；不能称原型已全部人工点通。
- 未运行应用测试／构建，未调用真实营销模型或 ima，未测试真实剪贴板、文件下载、触控或性能。原型均为“演示笔记本 A”等明确模拟内容，无真实参数、价格、优惠或生成结果。

网站实现继续使用已有大纲流程和 API。`blocked` 在全部渠道禁复制／下载，`needs_attention` 保留人工确认提示。修改成稿返回大纲；不新增正文直接编辑后出图、自动发布、账号或永久作品库。

## 历史与素材

[A3 静态封面](../../concepts/2026-10-21-cover-refinement/README.md)保留。背景、无翼人物和前景复用已确认资产；没有新增生图或循环视频任务。原始图片的来源与字节记录继续参考 A3／A2／原 A、B 交接。

API 版本通过[固定交接入口](../../../../api/README.md)查阅。本轮已核对，无接口变更。本地归档不表示提交或推送。
