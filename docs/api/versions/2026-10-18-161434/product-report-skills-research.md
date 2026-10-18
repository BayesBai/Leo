# AI 营销智能体产品报告 Skill 筛选

查询日期：2026 年 10 月 18 日。报告对象是“知序”AI 加华为 PC 营销内容智能体，面向黑客松评委及项目实现团队；不是撰写某款华为电脑的硬件测评。

建议以 **phuryn/pm-skills 中的 create-prd 为内容骨架，结合 product-strategy 与 competitor-analysis，再用本会话已有的 documents 或 presentations 制作正式文档或答辩 PPT**。需要证明 AI 产品效果时，增加 metrics-dashboard；提交前用 strategy-red-team 检查关键假设。产品报告比 PRD 多出实施证据、实测结果和演示说明，应明确要求补充这些章节。

## 优先选取的 Skill

以下五个 Skill 来自同一仓库，均已核查原始 SKILL.md。仓库使用 [MIT 许可证](https://github.com/phuryn/pm-skills/blob/main/LICENSE)。Skill 文件本身可免费使用；所用模型、检索工具或外部服务可能另有费用。

| 优先级与 Skill | 原有能力 | 用于本项目报告的部分 | 需要提供的材料 |
| --- | --- | --- | --- |
| 首选 [create-prd](https://github.com/phuryn/pm-skills/blob/main/pm-execution/skills/create-prd/SKILL.md) | 用八部分模板形成精简 PRD，允许明确请求详细版；标识未知假设 | 摘要、问题、目标用户、价值、方案、功能范围和迭代计划 | 赛题要求、用户流程、功能清单及当前实现 |
| 核心补充 [product-strategy](https://github.com/phuryn/pm-skills/blob/main/pm-product-strategy/skills/product-strategy/SKILL.md) | 从九个维度组织定位、取舍、指标、增长与能力 | 为什么面向销售员、为什么做四渠道、业务价值及适用边界 | 使用对象、替代方案、时间与资料约束 |
| 核心补充 [competitor-analysis](https://github.com/phuryn/pm-skills/blob/main/pm-market-research/skills/competitor-analysis/SKILL.md) | 研究竞品能力、定位、价格与差异 | 说明相对通用 AI 写作、排版工具及内容工作流的区别 | 官方产品页、对比维度和检索日期 |
| AI 效果章节 [metrics-dashboard](https://github.com/phuryn/pm-skills/blob/main/pm-product-discovery/skills/metrics-dashboard/SKILL.md) | 定义指标、计算口径、数据来源与目标 | 设计原文支持、配图正确、渠道适配、成品可用与耗时评估 | 真实样例、人工核验和运行日志；没有数据时只写测试方案 |
| 报告评审 [strategy-red-team](https://github.com/phuryn/pm-skills/blob/main/pm-execution/skills/strategy-red-team/SKILL.md) | 检查关键假设，按风险和验证成本给出测试 | 检查“资料可取”“图片可用”“产物可交付”等论证 | 报告草稿、已有证据和未完成项 |

对这个项目，建议先用前三个；后两个用于效果与验证章节。无需一次引入整套市场规模、商业建模、增长实验等流程。竞品 Skill 默认偏向多家直接竞品，本项目应要求将直接竞品与替代工具分开，没有依据的市场份额、收入及用户数留空，不为凑齐模板而估算。

## 两个备选方案

| 方案 | 已核查的能力与许可 | 适用情况 |
| --- | --- | --- |
| Anthropic [write-spec](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/write-spec/SKILL.md) 与 [competitive-brief](https://github.com/anthropics/knowledge-work-plugins/blob/main/product-management/skills/competitive-brief/SKILL.md) | 产品规格、优先级、验收条件，以及竞品简报与比较；仓库为 [Apache 2.0](https://github.com/anthropics/knowledge-work-plugins/blob/main/LICENSE) | 更重视工程需求、交接和验收；可替代 create-prd 与竞品模块，不必重复运行 |
| Alireza Rezvani [product-manager-toolkit](https://github.com/alirezarezvani/claude-skills/blob/main/product-team/skills/product-manager-toolkit/SKILL.md) | 包含 PRD 模板、需求优先级与访谈整理；仓库为 [MIT](https://github.com/alirezarezvani/claude-skills/blob/main/LICENSE) | 希望用一个综合工具包完成产品管理；附带 Python 脚本，运行前需有对应输入 |

Anthropic 方案的连接器是可选上下文入口；write-spec 允许在未连接时直接使用用户提供的资料。当前实际路径是 write-spec 与 competitive-brief，部分介绍仍提到旧名称 feature-spec 或 competitive-analysis。工具包当前路径包含 product-team/skills，不能沿用缺少 skills 层的旧安装示例。

没有真实访谈记录时，报告中的销售员画像只能标为需求假设，不能由访谈分析工具生成虚构受访者及引语。优先级脚本处理的是已有评分，不能自动证明评分依据真实。

## 报告成品制作

本会话已提供以下能力，不需要为本次筛选额外安装同类工具。它们解决文件制作与排版，报告内容仍由产品材料及上述方法形成。

| 本会话 Skill | 建议输出 | 作用 |
| --- | --- | --- |
| documents | Word 正式报告 | 样式、目录、表格、图文和渲染检查 |
| presentations | 答辩 PPT | 提炼叙事、架构与演示页，输出演示文稿 |
| pdf | PDF 交付稿 | 读取、生成及视觉核验 |
| visualize | 对话内交互说明 | 解释流程和架构；正式分享的静态图应另行导出为文件 |

建议交付“一份完整产品报告与一份精简答辩稿”。页数和内容以赛事模板、评审要求及演示时长为准；当前没有用户指定的产品报告格式，不能将某一页数当成比赛规则。

## 适合本项目的报告内容

| 章节 | AI 应回答的核心问题 | 材料与对应方法 |
| --- | --- | --- |
| 项目摘要与定位 | 为谁解决什么任务，交付什么 | product-strategy 与 create-prd |
| 场景与用户 | 销售员如何操作，内容面向哪些客户 | 赛题与场景设计；操作者和营销对象分开 |
| 替代方案与差异 | 为什么不能只用通用模型加人工排版 | competitor-analysis，引用最新官方资料 |
| 产品功能与流程 | 产品选择到确认大纲、正文、审核、成品的闭环 | 当前页面、接口说明和功能截图 |
| AI 与系统架构 | 知识读取、策划、写作、审稿、渲染各自负责什么 | 实际代码及 docs/architecture.md，标识规则与模型环节 |
| 资料与可追溯性 | 产品事实、条件、原图如何关联，冲突如何处理 | ima 工作流、事实与图像类型、核验逻辑 |
| 四渠道样例 | 公众号、小红书、朋友圈、海报分别长什么样 | 实际导出产物；截图和占位图不能替代可下载文件验收 |
| 效果与验证 | 事实、图片、排版、耗时是否达到目标 | metrics-dashboard；结果须来自真实测试 |
| 已实现范围与限制 | 哪些已编码，哪些已测通，哪些仍是规划 | 代码、运行证据、未完成项 |
| 后续计划与价值 | 下一步验证什么，如何扩展到门店使用 | PRD 迭代建议与 strategy-red-team |

指标建议是本项目的评估设计，不是已有成绩：人工核验的原文支持率、同型号配图正确率、保留必要限定条件的比例、渠道规则符合率、成品可打开和可下载率，以及完整任务耗时。目标值、样本规模及人工评分规则需明示；没有测量前不写“准确率 99%”或“效率提升 80%”。

商城的外部商品展示接口已在另一研究任务匿名验证，但工作台尚未接入 Vmall。报告应将其写为补充信息适配的验证与规划，不能写成已经上线的能力。同样，公众号排版 HTML 并不等于图片已上传微信素材库或文章已自动发布。

## 让 AI 开始写报告的任务说明

以下是后续撰写任务的可复用提示，不是本次已经完成的产品报告：

> 请为“知序 AI 加华为 PC 营销内容智能体”撰写面向黑客松评委的中文产品报告。首先阅读赛题手册、README.md、docs/architecture.md、docs/api/README.md 指向的最新交接文档，以及相关实现代码和现有研究资料。先整理材料依据表，区分用户要求、已编码能力、已验证结果、规划及待验证假设。
>
> 使用 product-strategy 组织定位与价值，使用 competitor-analysis 形成带官方来源和检索日期的比较，再使用 create-prd 形成详细报告骨架。报告还需补充 AI 与系统架构、四渠道真实产物示例、效果验证、已实现范围及限制。用 metrics-dashboard 定义指标；无实测数据时写验证方案。最后使用 strategy-red-team 检查论证。
>
> 操作者是销售员，内容面向其选择的客户。解释指定知识库、型号与事实引用、原图、大纲确认、写作审稿及精排成品之间的关系。根据代码和证据判断真实模型及规则分别参与哪些环节。商城接入、自动发布等未完成能力不可写成已实现。禁止虚构访谈、用户量、市场规模、效果指标或测试通过记录。
>
> 先给可核查的内容稿，再使用 documents 制作 Word 报告，或按指定答辩时长使用 presentations 制作 PPT。正文中的引用就近标注；不把凭证、完整私有知识库或临时图片签名链接写入报告。现有材料能支持的部分直接推进；只有会改变主要结论的缺失信息才集中询问。

## 使用与接入方式

这些产品管理 Skill 主要是提供给制作报告的 AI 使用的工作方法，不是必须部署进营销智能体服务端的业务 API。部署报告 Skill 不会自动给产品增加 Word、PPT 导出或联网研究能力。

原仓库提供 Claude Code 或 Cowork 插件用法。对当前环境，应通过已有的 Skill 安装机制按实际仓库路径导入；本次只核查路径与内容，没有安装或测试第三方 Skill 的运行兼容性。不要直接把其他工具的斜杠命令当作当前聊天支持的指令。[PM Skills 仓库](https://github.com/phuryn/pm-skills)也区分了 Skill、插件和工作流命令。

最小选择为 create-prd，配合本会话 documents 或 presentations。需要更完整论证时再补 product-strategy、competitor-analysis；需要报告 AI 效果时补 metrics-dashboard。Skill 安装与模型调用的成本分开核算。
