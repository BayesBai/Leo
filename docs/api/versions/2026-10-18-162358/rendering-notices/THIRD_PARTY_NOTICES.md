# 渲染依赖与许可

本目录为运行时功能，不依赖开发客户端 Skill。版本由 package.json 与 package-lock.json 固定；以下上游库均未修改。项目自己的模板与控制代码位于 layouts.ts、index.ts。

| 组件 | 固定版本/提交 | 用途 | 许可文件 |
| --- | --- | --- | --- |
| [文颜 Core](https://github.com/caol64/wenyan-core) | @wenyan-md/core 3.0.12 | public core + 无脚本 JSDOM，将受控文本排为公众号内联样式 HTML | [Apache-2.0](licenses/WENYAN-APACHE-2.0.txt) |
| [小红书卡片模板](https://github.com/BboTTM/xiaohongshu-card-skill/tree/106e3dcb33df3d88f99d4498cb9986bc6d035db8) | 106e3dcb33df3d88f99d4498cb9986bc6d035db8 | 派生多卡框架 | [MIT](vendor/XHS-LICENSE) |
| [Satori](https://github.com/vercel/satori) | 0.62.0 | 朋友圈、海报、公众号封面 SVG 排版 | [MPL-2.0](licenses/SATORI-MPL-2.0.txt) |
| [Sharp](https://github.com/lovell/sharp) | 0.35.5 | 原图等比缩放及 SVG 到 PNG | [Apache-2.0](licenses/SHARP-APACHE-2.0.txt) |
| [Playwright](https://github.com/microsoft/playwright) | 1.64.1 | Chromium 小红书截图 | [Apache-2.0](licenses/PLAYWRIGHT-APACHE-2.0.txt)、[NOTICE](licenses/PLAYWRIGHT-NOTICE.txt) |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | 本地生成 ZIP，不接受外部压缩包 | [MIT](licenses/FFLATE-MIT.txt) |
| jsdom / formdata-node / form-data-encoder | 27.4.0 / 6.0.3 / 4.1.0 | JSDOM 用于无脚本、无外部资源的样式 DOM；后两者保留为文颜可选 peer 依赖，不调用发布功能 | 各 npm 包随附 LICENSE |

Sharp 的 Windows 原生包另包含 LGPL-3.0-or-later 组件，包括 libvips；完整声明见随 npm 安装的 @img/sharp-win32-x64/LICENSE（本目录亦保留副本）。Chromium 的许可随 Playwright 下载的浏览器分发包保留。源代码仓库不打包 node_modules 或 Chromium 二进制。

## 模板改动

vendor/xhs-poster.html 保存上游原样模板；layouts.ts 使用其多卡页框架，去除上游作者头像与署名，加入同型号产品原图、中文字体、封面/正文/总结区别与溢出检测。未采用 Skill 中的自动重写文案、论文摘要或作者品牌素材。产品事实和限定条件由既有审核稿件传入，分页与缩放不重写正文。已实际通过该派生模板生成六页 1080×1440 PNG。

朋友圈与海报为本项目独立布局，分别为方形/竖形场景卡和竖形主视觉；设备主体仅等比合成，不生成或重绘。

## 中文字体

来源：[Google Fonts Noto Sans SC](https://github.com/google/fonts/tree/2894aab31764f10f29c421bdfd2340d3b382d384/ofl/notosanssc)。许可为 [SIL OFL 1.1](fonts/OFL.txt)，保留 Adobe 版权与 Reserved Font Name Source 声明。原始可变 TTF SHA-256：a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da。

Satori 的字体解析器不能处理本来源的 fvar 表，因此使用 fonttools 4.60.1 将同一字体实例化为静态 400 和 700，未删减字形。构建脚本为项目 scripts/prepare-font.py，Python 仅用于重新制作字体，正常运行不需要 Python。

| 文件 | SHA-256 |
| --- | --- |
| fonts/NotoSansSC.ttf（400） | c7b206a0a4a121db162367b546c9bbfc09d046f6991a96f242994ca5853f8be6 |
| fonts/NotoSansSC-Bold.ttf（700） | 6888949d69e45c30a8f8202664558ff71f737d2bffc38a3927e624488f6dac9b |

## 依赖审计与入口限制

2026-10-18 安装后核对 npm audit：已通过覆盖版本固定 @xmldom/xmldom 0.9.12、Satori 的 fflate 0.7.5、KaTeX 0.19.0，消除已报告的高危 XML 与对应 ZIP/数学排版项。本次进一步固定 Mermaid 11.16.1，对应[上游安全补丁](https://github.com/mermaid-js/mermaid/security/advisories/GHSA-6x64-9x62-f2gx)。安装后审计剩五项中危依赖报告，集中在文颜的 front-matter → js-yaml → argparse → sprintf-js 链路；不是五个独立可达漏洞，未记为零风险。

当前接口只接收任务、受控大纲和已有任务 ID，不接受 Markdown/HTML/模板/压缩包；公众号仅将随机占位符送入文颜，完成排版后把原文按 HTML 实体编码插入，图片同样后置。未调用 front-matter 解析，Mermaid、数学转换与发布功能关闭，Chromium 拒绝所有外部请求。公众号直接调用 public core，不加载 Node 发布 wrapper 或账号配置；JSDOM 不启用脚本和外部资源。未用自动降级主依赖或修改上游源码消除审计提示。正式部署前仍需跟进上游补丁与依赖审计，本记录不表示依赖零风险。
