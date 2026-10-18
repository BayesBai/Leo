# 华为商城信息读取接口查询与接入建议

查询日期：2026 年 10 月 18 日。适用项目：AI 加华为 PC 营销软文智能体。

**华为商城存在可读取商品信息的网站数据接口，商品展示接口已匿名实测成功；尚未找到面向普通开发者、可自助申请且具有公开文档和接入承诺的通用商品开放 API。** 可以开展适配验证，但不能将网站前端接口描述成已获得授权的合作接口。

## 查询结果

| 接口或入口 | 核查结果 | 对本项目的用途 |
| --- | --- | --- |
| 商城网站数据接口 `openapi.vmall.com` | 官方网站公开脚本直接配置此域名；商品展示 GET 请求返回业务成功 | 商品名称、配置选项、SKU 映射和图片等公开信息的候选来源 |
| 对外商品检索、价格、库存开放平台 | 未找到普通开发者注册、凭证申请、接口参考、配额及第三方使用说明的完整公开入口 | 不能按已有官方开放服务安排依赖或估算免费额度 |
| 商家、供应商或合作伙伴接口 | 未获得可核验的 Vmall 商品信息接入文档或合作账号权限 | 如赛事方提供专属文档，再按实际授权接入；目前不确认其开放范围与费用 |
| 华为开发者联盟的华为商城介绍 | 介绍生态产品、HiLink 与配件合作计划，并提供合作联系方式 | 可作合作咨询入口，不是 PC 商品目录 API 文档 |
| 华为云云商店 API 商品 | 商家将自己的 API 服务作为商品售卖 | 与读取华为商城笔记本商品不是同一服务 |
| HMS IAP `ProductInfoReq` | 查询开发者在 AppGallery Connect 内配置的应用内商品 | 不适用于 Vmall 的 PC 商品 |

官方业务介绍见[华为商城生态合作页](https://developer.huawei.com/consumer/cn/vmall/)、[华为云 API 商品说明](https://support.huaweicloud.com/usermanual-marketplace/zh-cn_topic_0000002529670243.html)及 [HMS 商品查询请求说明](https://developer.huawei.com/consumer/en/doc/hmscore-references/productinforeq-0000001050137777)。未找到公开申请入口不等于证明华为内部或合作伙伴接口不存在。

## 已确认的商城数据服务

商城[公开生产配置脚本](https://res.vmallres.com/portal/com/1.26.9.300SP01/h5/script/prod/script.js)配置了 `openApiDomain`，值为 `https://openapi.vmall.com`。域名中有 `openapi` 字样，不能据此推导第三方使用许可、稳定性或服务等级。

在首页引用的[商品调用模块](https://res.vmallres.com/portal/com/1.26.9.300SP01/h5/chunk-commons~1ea474a1.js)及[商品状态模块](https://res.vmallres.com/portal/com/1.26.9.300SP01/h5/chunk-commons~a0326677.js)中，观察到以下路径与 GET 调用：

| 路径 | 代码体现的用途 | 本次验证状态 |
| --- | --- | --- |
| `/mcp/product/queryDisplayProductByVersion` | 商品展示信息、产品及 SKU 组织 | 已匿名取得成功商品数据 |
| `/mcp/product/sbomDetailParamCacheInfo` | 单个 SKU 的参数详情 | 试用官方购买链接中的 SKU 参数，返回 `resultCode: "10100"`、`parameter is illegal`；调用条件尚未对齐 |
| `/mcp/product/refreshSbomRealInfoV3` | SKU 实时展示、销售与优惠相关信息 | 仅观察到调用代码，未验证字段、价格语义或权限 |
| `/mcp/querySkuInventoryV2` | SKU 库存查询 | 仅观察到调用代码，未验证地域、门店或库存含义 |
| `/mcp/product/querySaleInfoBySbomButtonModeV2` | 按销售模式读取商品销售状态 | 仅观察到调用代码，未进行业务调用 |

这里的 `/mcp/` 是商城现有路径命名，不能据此认定它实现了 AI 工具的 Model Context Protocol。以上脚本版本为 `1.26.9.300SP01`，路径和结构应在正式实现时重新核查。

## 实测成功的商品展示请求

商品 ID 来自[华为官方 MateBook 14 产品页](https://consumer.huawei.com/cn/harmonyos-computer/matebook-14-harmonyos-version/)的购买链接，而非枚举猜测。该链接包含公开的 `prdId=10086097339191` 与 `sbomCode=2801010196907`。商品 ID、SKU 和页面销售版本应分别保存，不能只按“MateBook 14”这个名称合并历代产品。

2026 年 10 月 18 日北京时间 15:45，以下请求返回 HTTP 200、JSON `success: true`、`code: "0"`，`displayPrdVo.sbomList` 包含 11 项。请求没有发送 API Key、Authorization 或 Cookie。这个结果只证明该样本在该时刻可匿名读取，不代表其他端点均免鉴权或长期开放。

```http
GET https://openapi.vmall.com/mcp/product/queryDisplayProductByVersion?portal=1&version=1&lang=zh_CN&country=CN&prdId=10086097339191&sbomCode=
```

本次成功响应包含 `displayPrdVo`，观察到 `name`、`briefName`、`brandName`、`attrViewList`、`gbomAttrDisplayList`、`gbomAttrMappings`、`functionPhotoList`、`sbomList` 等字段。嵌套字段仍需逐项确定含义；本次未把响应中的任何价格解释为实时成交价，也未完成图片许可核查。

Node.js 22 可用以下示例做单次验证，无需安装新依赖。示例是开发者验证代码，尚未加入项目运行服务：

```js
const url = new URL(
  '/mcp/product/queryDisplayProductByVersion',
  'https://openapi.vmall.com',
);
url.search = new URLSearchParams({
  portal: '1', version: '1', lang: 'zh_CN', country: 'CN',
  prdId: '10086097339191', sbomCode: '',
}).toString();

const response = await fetch(url, {
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const data = await response.json();
if (data.success !== true || data.code !== '0' || !data.displayPrdVo) {
  throw new Error(`商品查询失败：${data.resultCode ?? data.code ?? 'unknown'}`);
}
console.log({
  productName: data.displayPrdVo.name,
  skuCount: data.displayPrdVo.sbomList?.length ?? 0,
});
```

另一次使用搜索引擎收录的旧款 PC 商品 ID 请求，虽然 HTTP 200，但业务返回 `resultCode: "50004"`、`商品不存在`。实现必须同时判断 HTTP 与业务结果；不能把搜索缓存当作仍在售目录，也不能把空结果交给模型补写。

## 给实现 Agent 的接入范围

建议将 Vmall 作为独立的补充信息适配器，先跑通固定商品白名单的读取和人工核对，再扩展检索或动态价格。当前项目尚未实现 Vmall 适配器；`shared/types.ts` 的 `KnowledgeSource` 仍只有 `local | ima`。

建议的数据流为：销售员选择产品 → 根据经人工确认的映射定位商城商品与 SKU → 服务端读取公开信息 → 校验型号、版本及字段 → 保存带来源的快照 → 供 Agent 引用或提示差异。商品搜索接口尚未确认，不应假设已有“输入任意型号即可查询”的能力。

适配器应先提供两个内部能力，名称仅为实现建议：

- `getProductSnapshot(prdId)`：读取产品展示信息，输出名称、产品 ID、SKU 候选、配置及图片引用，并带来源与采集时间。
- `compareWithKnowledge(snapshot, evidence)`：比对指定知识库与商城的型号、配置和时效差异，冲突交给用户确认，保留双方出处。

每份快照至少记录 `source: "vmall"`、来源页面、公开商品 ID、SKU、配置、`fetchedAt`、解析器版本和原响应摘要。价格以后单独建模，保留币种、标价或预估到手价类型、优惠条件、适用地域、有效时间；缺少这些条件时不生成确定性价格宣传。

实现约束：

- 后端调用并限制允许的商品来源域名、请求超时、响应大小和重定向目标；前端通过项目自身接口使用结果。是否允许浏览器跨域直连尚未验证。
- 将端点、解析器与缓存放在适配层。建议商品资料按小时缓存、失败退避；缓存时长是本项目设计值，不是商城官方配额。
- 匿名读取失败、需要登录或触发访问限制时，返回明确的不可用状态并允许人工提供已核实资料；不尝试绕过验证，不转发 ima 或模型密钥到商城。
- 商品原图仍需核实使用范围、型号和来源。公开可下载不等于自动取得营销复用许可。
- 取得合作文档后，再确认可调用范围、凭证方式、更新频率、费用与使用条款，替换当前网站适配实现。

此前读取的赛题手册将正式比赛中的产品事实与图片来源限定为指定 ima 知识库。用户提出 Vmall 作为补充来源，可以先用于开发检索、差异核验和主办方认可的资料补充；正式参赛内容是否允许直接引用商城，应以主办方最新口径为准。不能把商城数据伪标成来自 ima。

## 接入验收

1. 对人工确认的有效产品请求，既验证 HTTP 状态，也验证业务成功与响应结构；保存来源及采集时间。
2. 对失效商品返回“商品不存在或不可用”，不调用模型补造参数。
3. 同名不同年份、系统或配置必须保留独立映射；比较结果能展示具体差异。
4. 未完成价格接口与条件核验前，只交付商品信息，不宣称已实现实时价格、库存或优惠查询。
5. 商城失败时仍可使用原 ima 工作流；没有 Vmall 数据的输出如实标识来源。
6. 新增项目 API 或来源枚举时，同步修改共享类型、校验、模拟数据与新的接口归档版本。

本次完成公开资料查询、源码只读核查、一次成功商品展示验证、一次失效商品验证和一次参数接口失败验证。没有登录商城、申请合作权限、调用私有订单信息、修改运行代码或宣称完成商城接入。
