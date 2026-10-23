# Canva 初始化 500、引用问题与代理分流只读核查

北京时间：2026-10-22T23:00:42+08:00；版本 `2026-10-22-230042`；上一版 `2026-10-22-222005`。代码基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`。

**已核对，无接口变更。** 本轮业务源码、配置与节点/TUN均零修改，155 份源快照与前版/当前源码一致；前端无新增适配。完整现行协议保留，279项测试与构建是前轮事实，本轮未重跑。

- Microsoft CanvasAuthoring、Canvas LMS 与项目实际连接的 Canva 是不同产品；引用的 MSAL/.NET/512KB 问题不适用。OpenHands/Happy 的依赖、宿主接口或本地 MCP server 复用问题也不能直接套用；并未因此排除 Canva 远端同类错误或 grant 能力问题。
- 本轮 initialize JSON 仅173字节、不含文件，失败早于工具发现与设计上传。因此这次错误没有由成品文件过大触发的证据，微软 .pa.yaml 限制与此阶段无关。
- 公共元数据4次：无显式代理为 AS302/PR200，显式当前本机HTTP代理为 AS200/PR200。另以同一现有未过期令牌对照4次：两路径REST均200、initialize均500/internal_error。本机直接发往Canva的诊断探针合计8次（不含本机GET连接状态与web研究）；refresh/新授权/模型/设计0，未继续尝试付费或完整OAuth。
- 无显式代理不等于物理直连；CF POP不等于出口IP/国家，也不证明IP漂移。显式代理开关没有改变本组MCP失败结果，不能单独认定静态IP或分流导致500。
- 保存配置绕过大陆8规则/AsIs，所查4域名无匹配或专门direct/block；OS默认及3个peer路由为en0，未见TUN重捕获证据。运行配置已不在、首outbound未知、无访问日志，故不能完全排除实时路由/远端链/出口信誉。当前证据不支持贸然更改全局路由，MCP根因仍未确认。
- 官方公开状态页本轮web读取为All Systems Operational，Connect API/Canva AI Platform Operational，只能说明无公开大面积事故，不保证具体MCP应用正常；官方Quickstart远程地址未变。文档读取不计入8次本机HTTP探针。
- 本轮只运行10项transport/HTTP定向，全部通过，失败/取消/跳过0，4553.352045ms。未重跑整套279或build。持久状态权限600、Token存在、refreshing=false、连接状态正常，不代表MCP audience或服务已验证。

[完整交接](frontend-handoff.md) · [现行样例](api-examples.http) · [纯 Mock](fixtures/frontend.mock.json) · [实际验证](verification/acceptance.json) · [排查矩阵](verification/diagnostic-matrix.md) · [引用适用性](verification/issue-applicability.md) · [已认证路径](verification/authenticated-path-comparison.json) · [路由摘要](verification/routing-audit-summary.json) · [前版结果](../2026-10-22-222005/README.md)

归档代理没有读取凭证、访问公网或修改业务源码；只整理根代理/研究代理明确脱敏证据，没有复制原output/session/env、代理地址、出口IP、Token/claims、私有素材、授权或签名URL。根代理独立对草稿及最终内容进行真实凭证精确扫描，均匹配0（最终扫描173文件、未输出值）；归档代理没有读取凭证。已生成manifest并更新固定索引。没有重启/令牌刷新/新授权、自动发送工单、暂存、提交或推送。

源码快照供阅读，不是独立运行工程；封存后本目录只读，历史原件保持。真实Canva设计导入、编辑、导出与四渠道品质仍未验收。

本版 [manifest.json](manifest.json) 记录归档文件及核对源文件SHA-256；相对链接与前版字节均完成核对，封存后不再修改。
