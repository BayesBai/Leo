# 当前生图提供商迁移说明

当前默认平台为火山方舟官方，Base URL为`https://ark.cn-beijing.volces.com/api/v3`，模型精确为`doubao-seedream-5-0-pro-260628`（Seedream5.0pro）。依据[官方模型教程](https://docs.volcengine.com/docs/ark/seedream-5-0-pro?lang=zh)、[模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=zh)和[图片生成API](https://console.volcengine.com/ark/region%3Acn-beijing/docs/image-generation-api)。配置见[本机指南](docs/setup/visual-integrations.md)。

本机API不接收任意第三方Prompt或裸转发Key。后台adapter调用`POST /images/generations`，Bearer鉴权，字段严格为model/prompt/size/output_format=png/response_format=b64_json/watermark=false；单图、非流式，无n、stream、组图、拆层或参考图输入。size继续显式1024x1536、1536x1024或1024x1024，不自动换成2K档位；图片按服务商真实返回尺寸校验保存，不裁切重画。兼容data[0].b64_json或受控URL，优先Base64；签名URL不长期保存，另取图片不转发APIKey。

官方根域自动归一化到/api/v3；官方/v1、混拼路径、完整images端点、凭证、query和fragment均拒绝。显式非官方旧配置仍按旧/v1协议兼容，代码默认不回退旧域名。新平台使用独立新Key；脚本保留文本、ima与其他配置，隐藏输入且只原子替换三个IMAGE字段，权限600。本机新配置由用户通过隐藏输入脚本完成，代理未代替用户输入、读取或输出真实Key。

调用记录可选保存安全x-tt-logid为requestId；generated_images→usage.generatedImages，output_tokens→completionTokens，total_tokens→totalTokens。未返回的用量保持未知，不能填0或据此推算账单。超时/取消、持久派发标记、未知结果停住及用户显式续跑保持；配置变化不默默换排队任务的模型或Key。

公众号/小红书只生成背景，真实产品与中文仍本机分层；海报整图不上传参考图片，三项人工核对后才正式下载。朋友圈不生图，视频复用有效素材并只调用原文本模型写短稿与独审。新提供商不使有效历史素材自动失效、重新生图或续期。

[部署规划](deployment-plan.md)仍未部署。[旧Cloudflare403记录](cloudflare-403-troubleshooting.md)保留历史；该故障属于之前的提供商，不构成方舟成功、失败、Key或模型权限的证据。真实调用须用户配置新Key后主动验证；离线验证不能替代账号连通、用量与视觉质量验收，实际结果以本版验收记录为准。
