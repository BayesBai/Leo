# Virgo 麦田循环视频与接口交接

北京时间：2026-10-22T17:51:36+08:00。版本`2026-10-22-175136`；完整继承`2026-10-22-164240`。代码基线`17bd7c9262d584ba21795c0604eb993110a56038`，分支`frontend/workbench`，工作区未提交。无暂存、提交、推送或部署。

**已核对，无接口变更。** server/index.ts、server/schemas.ts、shared/types.ts及业务请求层无变化，完整继承Job HTTP/SSE、错误、确认/发布门禁。前端新增外壳独立背景、播放控制与焦点修复；需部署[循环MP4](../../../../public/virgo/wheat-workbench-loop.mp4)/[poster](../../../../public/virgo/wheat-workbench-poster.webp)，无新增协议适配。60%桌面与94%阅读/手机保持。

可灵4.0实际提交1任务（720p/10秒档），COMPLETED，消耗100灵感值、余额0；无第二候选、重投或充值。原导出1224×764/24fps/10.041667秒/AAC；未放大，统一30fps只重复帧，0.6秒交叉溶解后9.4秒/H.264/无音轨/faststart，3235455字节。水印保留，未擦除或为移除水印刻意裁剪；正常cover可能裁边。静帧设备继续原无水印garden。

[视频交付](../../../design/virgo/implementation/2026-10-22-wheat-video/README.md)包含原始视频、6帧、10网页截图SHA、生成/处理/播放与焦点证据。大二进制仅链接/hash，不重复归档。最终53项相关测试全部通过、0失败/跳过，14.794秒；构建含tsc通过，Vite3.30秒；diff检查通过。旧52/32/184结果不与本轮混算。

当前9756纯Mock连续播放62.484秒（超过6轮），暂停在5.963943秒并跨步骤/首页保持；业务忙碌控件可用。实际自动跳step曾抢Space焦点，窄修复后后台任务期间实测paused=true/focusedBackground=true。独立8网页+6帧Ship、0遗留必修；手机首图异常已DOM343/303读回后单独重拍复核。实际390无video/src，保持原静帧。

coarse/减少动态/媒体错误与visibility由控制器和React Hook集成覆盖；IAB隐藏panel未触发document.hidden，未做真实OS隐藏、实体设备/网络故障或完整FPS认证。未调用真实营销模型/ima、未完整验收后端恢复，未写Figma。详见[第9节](frontend-handoff.md)及[验收](../../../design/virgo/implementation/2026-10-22-wheat-video/verification.md)。

[完整协议](frontend-handoff.md) · [HTTP样例](api-examples.http) · [纯模拟夹具](fixtures/frontend.mock.json) · [共享类型](shared/types.ts) · [校验](server/schemas.ts) · [清单](manifest.json)。保留全部历史与3首次原件；快照仅供阅读，运行需项目根完整工程。不归档凭证、签名URL、临时媒体地址、原知识库或私有资料。
