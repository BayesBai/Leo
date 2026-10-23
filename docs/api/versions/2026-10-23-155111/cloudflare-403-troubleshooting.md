# 生图网关Cloudflare403排障（只读说明）

本轮未改变协议或配置，也未发出新的模型请求。现有代码在`server/image-provider.ts`识别HTTP403的Cloudflare类HTML拦截页，返回`IMAGE_GATEWAY_BLOCKED`、保留脱敏诊断，并停止自动重试。

## 已知范围与尚不能确定的事

已有任务的生图请求在约796毫秒内收到403，耗时明显短于默认300秒生图上限。这次是访问被拒绝，不能归因为等待上限到期。后续新任务没有新调用记录，表明费用保护复用了原失败；不等于中转站已经修好。依据响应特征，可以定位到网关前置访问层，但尚不知道命中的具体规则。Cloudflare官方列出的可能性包括WAF、安全级别、浏览器完整性及IP等安全策略；不能仅凭403认定Key错误或模型不存在。[官方403说明](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-403/)

如果前置策略要求浏览器挑战，返回的是完整HTML页面，服务端期望的JSON响应就无法继续。正式机器API应由服务商提供合适的访问策略，而不是把浏览器挑战作为每次后端调用的必经步骤。[Challenge Pages兼容性](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/)

## 建议操作顺序（本轮未执行）

1. 联系中转站，确认用于服务端Images API的正式Base URL、`POST /v1/images/generations`路径，以及是否支持当前指定的`gpt-image-2.5`和Bearer机器调用。不要凭猜测切换到另一域名。
2. 将失败时间、时区、请求方法/路径、HTTP403、响应为Cloudflare HTML，以及操作者本机诊断中的Ray ID私下提供给网关客服；不用发送Key、完整Prompt、图片或知识库内容。本归档只用模拟占位符。
3. 请域名所有者打开该域名的Security Events，用Ray ID并结合较窄时间窗查询，确认Action、Service、规则与实际来源IP/ASN。日志可能被采样，查不到单条记录时应先缩短时间窗再核对。实际菜单随界面变化，不要求照搬旧菜单名称。[Ray ID查询](https://developers.cloudflare.com/fundamentals/reference/cloudflare-ray-id/)、[Security Events](https://developers.cloudflare.com/waf/analytics/security-events/)
4. 根据已确认的规则，对准确API主机、路径、方法及服务商认可的服务间访问机制做精确调整，同时保留应用层Key、配额和限流。不要全站关闭防火墙。v2ray静态IP或分流只是可能因素；只有服务商事件记录指向当前出口时，再据此处理，不先改代理。
5. 服务商确认策略修复后，由用户主动进行一次有界生图重试；检查返回JSON及图片、调用账本和审核候选。海报文字、机型外观、事实条件仍须人工核对。单纯网站可打开、模型目录可访问或配置存在，不代表海报已交付。

## 纯模拟客服信息格式

```text
仅示例，不是真实请求：
时间：2030-01-01 12:00:00 Asia/Shanghai
接口：POST /v1/images/generations
现象：HTTP403，返回Cloudflare HTML，后端分类IMAGE_GATEWAY_BLOCKED
Ray ID：MOCK-RAY-ID-DO-NOT-SUBMIT
请确认正式API域名与机器调用策略，并按Ray ID/时间/路径查询命中的安全规则。
```

以上是调查建议，不是已完成的防火墙修复。没有访问网关管理后台，也没有断言具体规则、出口IP原因、Key状态、模型可用性或费用扣除情况。
