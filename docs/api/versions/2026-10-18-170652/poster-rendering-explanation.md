# 当前海报输出调用链

海报通过POST /api/render提交已保存的runId、revision、platform:poster、标题索引和模板ID。后端只读取该稿件的正文与证据原图，不接收任意图片URL或客户端HTML。

1. 文案：模型创作模式下，大纲、正文和独立审稿使用当前配置的deepseek-flash；本地演示为规则生成，不调用大模型。此为文案阶段，渲染阶段不再调用模型。
2. 图片：从本地资料或ima证据包解析当前型号的原图句柄；海报要求一张不同的同型号原图。Sharp先进行解码、等比缩放并转换为受控PNG。
3. 布局：server/render/index.ts的poster分支调用layouts.ts中的renderSatori，使用poster-paper或poster-ink模板，将标题、产品名、原图、最多三个卖点、行动引导和审核标记排版为SVG。
4. 输出：Sharp将SVG转换为1080×1920 PNG，保存为本机成品文件，通过render-assets句柄预览或下载；按审核状态提供ZIP。

当前没有调用文生图、扩散模型、图片生成API，也不通过DeepSeek生成产品像素；设备图来自真实资料，保持原图比例与型号外观。现有背景为模板配色。文字放不下时缩小字号，仍溢出则422，不截断必要条件。

核对文件：[渲染路由](server/index.ts)、[输入校验](server/schemas.ts)、[共享类型](shared/types.ts)、[渲染分支](server/render/index.ts)、[Satori与Sharp布局](server/render/layouts.ts)、[文案模型](server/model.ts)。这些是阅读快照，不是独立运行工程。
