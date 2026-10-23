# 自有服务器与子域名部署规划（未部署）

北京时间：2026-10-23T15:18:49+08:00；版本`2026-10-23-151849`；上一完整版本[2026-10-23-151024](../2026-10-23-151024/README.md)。代码基线`d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支`frontend/workbench`，保留已有未提交工作区。

**已核对，无接口变更。** 本轮不修改应用代码、环境配置、服务器、域名解析或证书，不提交或推送。阿里云杭州2核/2 GiB/标称200 Mbps，少量熟人使用；推荐`virgo.agonionce.beer`，全站入口密码及低并发试用，视频待资源验证。个人网站管理方式暂不清楚。

相对上一版本新增[部署规划](deployment-plan.md)，更新交接版本标识、纯模拟夹具声明和本次核对记录。现行海报批准、独立视频短稿、外部设计410及JSON/SSE兼容协议保持；前端无需新增接口适配。后续公开域名/HTTPS反代、访问保护、渲染运行时和资源限制尚待实施，不将规划描述为已完成能力。

核对范围：上一版本完整文件清单与源文件SHA-256、server/index.ts、server/schemas.ts、shared/types.ts、shared/poster.ts、shared/video.ts、server/start.ts、state-store、render路径/浏览器/视频、Dockerfile、package.json、setup-render及README。所列源码快照来自上一完整版本且与实际源文件核对一致，供阅读，不是独立运行工程。

本轮实际验证：归档文件和源文件SHA-256、JSON解析、Markdown相对链接、HTTP样例中的变量引用、git diff --check、docs/** -text及固定入口检查。没有运行单元测试、构建、应用/容器、真实模型调用、SSH或DNS变更；上一版测试和真实视频仅保留历史引用。未核验用户域名的实际备案/接入状态、服务器余量或线上承载能力。

[完整交接](frontend-handoff.md) · [HTTP样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [类型](shared/types.ts) · [输入](server/schemas.ts) · [前端快照](src/App.tsx) · [本次核对](verification/acceptance.json) · [SHA-256清单](manifest.json)

历史版本与首次交接原件只读；不复制运行时状态、原始知识库、真实成稿、临时URL或凭证。本地归档不等于Git暂存、提交或推送。

归档范围说明：为保持说明引用有效，本版补充归档内接口导航；未重复打包四份缺少可选上游附件的第三方Skill原文，保留原项目源码的核对哈希、固定上游清单与许可证。未修改任何第三方源文件或历史归档。
