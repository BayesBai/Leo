# Canva 新 Secret 加载与重新授权交接

北京时间：2026-10-22T23:30:24+08:00；版本 `2026-10-22-233024`；上一版 `2026-10-22-231858`。代码基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`。

**已核对，无接口变更。** 155份源快照与前版及当前源码一致，前端无需新增适配。用户已执行Secret配置命令；代理未替用户重写真实.env。本轮完成空闲重启、授权入口准备及本人新授权后的唯一MCP预检，新Secret真实换码成功，但MCP仍返回500。

- 重启前确认配置存在、权限600、新配置与旧grant指纹不匹配、任务0；旧进程connected=true不能验证新Secret。再次空闲确认后SIGTERM并以npm run dev重启，新服务configured=true/connected=false，提示重新授权。
- POSTconnect成功200／3329ms，官方主机、canonical resource、S256和state存在检查通过；只触发公开metadata发现和本机pending state准备。实际授权URL只在内存，未输出或归档。
- 用户随后完成本人新OAuth。根代理确认connected=true、新grant与当前配置hash匹配、auth/v1 endpoint与mcp-discovery-v2、未过期。由存储和callback逻辑确认至少一次新Secret参与授权码交换成功；浏览器精确回调次数未独立统计，不编造计数。
- 北京时间23:33:21.373238，唯一POSTverify本机502，3347ms，mcp.initialize／上游500／internal_error，retryable=true、outcomeUnknown=false。REST预检按代码顺序已完成，但本次未独立记录其HTTP状态，不补写200。未进入tools/list，根代理派发模型/生图与设计任务0。
- Cloudflare追踪号为 `cf-ray:a4e98f70dbbcc5ce-IAD`，是边缘CF-Ray，不是Canva原生请求ID。新Secret换码成功不证明MCP grant能力或audience，不能宣称500已修复或完整Canva流程通过。

[完整交接](frontend-handoff.md) · [现行样例](api-examples.http) · [纯Mock](fixtures/frontend.mock.json) · [实际验证](verification/acceptance.json) · [配置指引](docs/setup/visual-integrations.md) · [前版结果](../2026-10-22-231858/README.md)

本轮没有重跑历史CLI/279/10测试、构建或SDK探针，没有追加授权循环、付费请求或业务源码修改。归档代理不读凭证、不调用接口/公网；只整理根代理安全结果，不复制原output/session/env、Secret/ClientID/Token、授权URL/state/code或签名资源。根代理最终内容独立精确扫描168文件，当前凭证及pending PKCE verifier匹配0，未输出值。已完成manifest与固定索引，封存后只读，不暂存、提交或推送。源码快照供阅读，不是独立可运行工程。

计数口径：根代理直接connect准备1次、verify1次，GET状态/jobs另计；用户浏览器与服务器OAuth逐请求未独立统计，只确认至少一次新配置换码成功。本轮有本人同意和凭证存储更新，不是整轮只读/零凭证操作。根代理refresh0，服务重启1次，未修改源码或env。

[manifest.json](manifest.json)记录本版全部归档文件及核对源文件的SHA-256，相对链接与前版原件字节均经核对。
