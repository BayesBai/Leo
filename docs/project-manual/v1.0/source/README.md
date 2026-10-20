# 知序 · 项目说明书 TeX 源项目

主文件：`main.tex`。样式：`zhixu.sty`。正文按章节存放在 `sections/`。

## 编译

建议使用带中文字体包的 TeX Live，选择 **XeLaTeX**。项目使用 TeX 发行版自带的 Fandol 与 TeX Gyre 字体，未依赖 Windows 专有字体。

```powershell
xelatex -interaction=nonstopmode -halt-on-error -no-shell-escape main.tex
xelatex -interaction=nonstopmode -halt-on-error -no-shell-escape main.tex
```

也可在 Windows 运行 `build.ps1`，或在 Codex 中打开本目录编辑 TeX 源码。内置编译在本次环境中出现资源超时，最终交付PDF由本机XeLaTeX成功编译并检查；可直接打开随附PDF。初次编译需建立交叉引用；第二次编译刷新目录跳转与页码。输出为 `main.pdf`。若缺少宏包，需安装 ctex、fontspec、tikz/pgf、tcolorbox、tabularx、fancyhdr、hyperref 等依赖。

## 内容与证据

- 16页A4，含封面、赛题评分与要求对照、工作流、架构、ima证据链、Agent/提示词、四渠道成品、三组案例、验证、部署、限制及提交索引。
- `images/` 是实际运行图片或已有实际截图，非生成式概念图。
- `evidence/case-a.json` 与 `case-b.json` 是本轮执行的本地规则案例，分别为开学季小红书、职场办公公众号；没有模型或ima调用。
- `evidence/case-c.json` 及图片引用既有真实模型+本地资料结果，正文保留实际限定条件和needs_attention审核状态；本轮没有重跑真实模型。
- `evidence/live-http-verification.json` 是另一组已完成HTTP测试的去敏计时，不能与案例C混为同一次运行。
- `evidence/system-prompts.ts` 为当前系统提示词完整源文件；大纲策划约束还需参考完整工程 `server/outlines.ts`。
- `evidence/case-b-wechat.html` 为实际公众号文章，包含嵌入式图片；尚未转存微信素材库。

依据为用户提供的《华为·产业进阶赛道·赛题手册v4》，9页。未把赛事原PDF、原始知识库、API密钥或Client ID打包。

本地资料案例只能证明工程工作流和版式，不能替代赛事要求的指定ima共享库来源核验。正式提交前仍需补齐ima正式样例、魔搭页面及复赛真实录屏，并统一各入口信息。

PDF和源项目只保存在被Git忽略的 `output/`，本次不自动提交或推送。案例文件含选录产品描述，按参赛说明与授权范围使用。
