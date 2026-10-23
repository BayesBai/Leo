# 火山方舟生图本机配置

当前全部新生图统一使用火山方舟官方 Seedream 5.0 pro；正文、大纲、AI修改、返修和独立审稿继续保留现有 `gpt-6.1-sol`、文本网关与Key。生图凭证独立保存到本机后端，不写入浏览器或交接归档。

## 1. 取得方舟API Key

1. 使用你自己的账号打开[火山方舟北京区域API Key管理](https://ark.volcengine.com/region:cn-beijing/apikey)。按控制台提示完成服务开通、权限及计费设置。
2. 确认账号可使用精确模型标识 `doubao-seedream-5-0-pro-260628`。这是官方Model ID，不替换成flash、lite或其他版本；权限及可用性仍以你的账号实际返回为准。
3. 在API Key页面创建或取得用于本项目的Key。复制平台提供的完整值，不自行添加`sk-`前缀，也不要用云账号的AccessKeyId/SecretAccessKey代替方舟API Key。

官方参考：[Seedream 5.0 pro](https://docs.volcengine.com/docs/ark/seedream-5-0-pro?lang=zh)、[模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=zh)。

## 2. 隐藏输入配置

在本机交互终端执行：

```bash
cd /Users/maxchen/Documents/hackson
python3 scripts/configure-visual.py image
```

在隐藏输入提示中粘贴新的方舟API Key并回车；输入不显示字符是正常现象。脚本只更新下面三个生图配置，保留文本、ima与其他配置，原子保存`.env.local`并设置权限600：

```dotenv
IMAGE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
IMAGE_MODEL=doubao-seedream-5-0-pro-260628
IMAGE_API_KEY=在终端隐藏输入的方舟APIKey
```

Base URL只填API根地址：可用上面的完整`/api/v3`根路径，官方裸域会归一化到该路径；不要填`/v1`或完整`/images/generations`端点。

这段仅说明字段，不要把占位文字直接写入实际配置。新提供商需要它自己的Key，不沿用旧中转站凭证。不要把真实Key发送到聊天、放进命令参数或提交Git。

后端仅由`server/start.ts`读取`.env.local`/`.env`；已存在的进程环境变量优先，不会被文件覆盖。`.env.example`是示例，不会被服务自动加载。配置脚本不会自行启动付费生成或重启服务。

## 3. 加载配置与首次验证

保存后先确认后台队列空闲，再重启现有本机服务，使新配置生效。自己维护时，在原服务终端停止后从项目目录执行`npm run dev`，不要让两个实例同时占用同一数据目录。

可先只读查看`GET /api/status`的`image`：`name`应为`doubao-seedream-5-0-pro-260628`，`baseUrl`应为`https://ark.cn-beijing.volces.com/api/v3`。`configured=true`只表示配置存在，不代表Key、模型权限或生成质量已验证。

取得Key并确认配置后，由用户主动发起一次生图验证。公众号/小红书可点“重新生成背景并排版”；海报可点“生成海报”。这些动作会调用付费服务，不由重启、读取历史或检查状态自动触发。已有任务绑定提交时的配置；旧任务提示配置变化时，创建新的视觉任务，已完成正文和审核继续保留。

## 4. 实际请求与交付边界

- 请求地址：`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，Bearer鉴权。
- 模型：`doubao-seedream-5-0-pro-260628`；单张、非流式，不启用组图、流式输出或图层拆分。
- 请求字段：`model`、完整`prompt`、`size`、`output_format:"png"`、`response_format:"b64_json"`、`watermark:false`。不发送旧OpenAI图片接口的`n`。
- 优先接收Base64图片，兼容返回的图片URL并安全回收到本地。调用记录可选保存`usage.generatedImages`、`completionTokens`及`totalTokens`，分别来自方舟返回的`generated_images`、`output_tokens`及`total_tokens`；未提供的用量明确为未知，不填0。
- 整图海报仍请求`1024x1536`并按真实返回尺寸保存；不本机裁切或重画。背景生成与海报共用生图并发1、单次300秒上限；超时、断流及结果不确定不会自动重复生成。

公众号/小红书的AI背景不含产品和关键中文，产品原图及文字本机独立排版。海报目前只发送文字Prompt，没有上传产品参考图；模型即使支持图生图，本轮也不自动启用。海报预览不加审核水印，必须核对中文、机型外观、事实及完整适用条件三项后才开放正式下载。读取、重排缓存命中与确认不延长原资源期限。

官方接口参考：[图片生成API](https://console.volcengine.com/ark/region%3Acn-beijing/docs/image-generation-api)。本项目适配参数不等于已完成真实账号验收；没有新Key时只完成离线模拟验证。

## 5. 常见情况与历史兼容

| 情况 | 处理 |
| --- | --- |
| 未配置生图Key | 文本与朋友圈仍可使用；海报需要独立方舟Key，普通HTML排版可使用本地背景 |
| 账号未开通、模型权限不足或额度问题 | 按方舟返回的脱敏错误检查账号和精确Model ID，不自动换模型 |
| 超时、断流或结果不确定 | 先核对平台调用记录，再主动决定重试；可能已经产生消耗，不能自动重发 |
| 已有任务提示生图配置变化 | 不静默替换排队任务的提供商；为当前已审核内容创建新的视觉任务 |
| 旧背景或海报过期 | 主动重新生成；读取与缓存命中不会续期，也不自动重新付费 |
| 历史记录仍显示旧服务商 | 属于当时保存的来源和配置，读取不会改写成方舟 |

代码保留显式旧生图配置的协议兼容，方便历史记录读取；新默认不回退到旧中转站。此前Cloudflare403排障仅针对旧中转站，不能证明火山方舟可用或不可用；旧排障和部署规划保留在[接口历史](../api/README.md)。本机配置由操作者通过隐藏输入脚本完成，开发代理不需要读取或输出Key；真实连通和视觉质量另按实际验证记录验收。

Canva外部设计流程已搁置，网站授权/同步入口已移除，相关后端路由返回410 `EXTERNAL_DESIGN_PAUSED`。旧实现及配置命令仅为历史兼容，不是当前图文或海报制作的前置要求。无需为本次切换重新授权或配置Canva。
