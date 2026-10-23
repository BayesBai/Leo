# Canva MCP 当前授权复测与故障范围收敛

北京时间：2026-10-23T13:00:03+08:00；版本 `2026-10-23-130003`；上一版 `2026-10-23-121834`。代码基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`。

**已核对，无接口变更。** 当前155份源快照与上一版一致；HTTP路由、schemas、DTO、SSE和前端适配不变。本轮主动复测现有授权，并以有界阴性对照、官方token introspection、不同HTTP实现/网络路径缩小故障范围。

- 已完成一次正常refresh，REST设计元数据返回200；官方introspection确认刷新后的令牌active、当前应用匹配、时间有效，具备三个已请求design权限。
- 有效令牌的三次initialize均返回500/internal_error；无Authorization及合成无效令牌各返回401。生产Node传输和curl HTTP/2复现一致，无显式应用代理路径也500。
- 故障已集中在**有效令牌关联的Canva MCP入口处理路径**；仍不能区分应用/账号grant或权限映射、服务端凭证校验内部与MCP初始化内部故障，也不能推断Canva全部服务宕机。
- MCP新版server/discover和一次无session tools/list诊断同样500，没有完成协议协商或工具发现；它们不构成切换协议或生产跳过初始化的依据。
- 共15次直发Canva诊断HTTP，含4次公共metadata、refresh1、REST元数据1、introspection2、initialize5、server/discover1、单独tools/list1。第一次introspection误用client_id的比较已作废，第二次依据官方client字段核对通过。

[完整交接](frontend-handoff.md) · [现行样例](api-examples.http) · [纯Mock](fixtures/frontend.mock.json) · [诊断矩阵及限制](verification/diagnostic-matrix.md) · [安全统计](verification/mcp-retry-summary.json) · [中英文支持复现摘要](verification/canva-support-summary.md) · [本轮验收](verification/acceptance.json) · [前版](../2026-10-23-121834/README.md)

服务原本停止，本轮启动一次，当前本机状态和任务列表GET均200、活动任务0；connected仅表示保存的OAuth grant，不代表MCP接通。没有业务源码或env修改；成功refresh落盘是本轮凭证状态变化。未发起新账号授权/授权码交换，未进行模型、生图或设计修改，未重跑历史离线测试/build。开发门户GUI打开超时，本轮未独立核验MCP开关，保留用户此前已开启的陈述。

归档代理只读取公开源码及根代理指定的脱敏summary，未读取凭证、主状态、原始响应、私有产品或签名资源。支持摘要仅供人工提交，未自动发送。没有Git暂存、提交或推送。根代理独立检查了诊断和支持摘要，并对164份文件在内存进行当前凭证/Token/PKCE精确扫描，匹配0，未输出值；本版已生成SHA-256清单并封存。源码快照供阅读，不是独立可运行工程。
