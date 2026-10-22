# 当前后端架构

启动入口 `server/start.ts` 载入本机环境，再创建 Express 应用。导入 `server/index.ts` 不读取真实环境文件。默认仅本机单人运行，保留 Host/Origin 与在途操作门禁。

任务校验 → 同型号本地/ima取证及图片最低数预检 → 统一模型生成大纲 → 保存/确认版本 → 各渠道独立写作 → 规则与独立模型审稿 → 最多一次有效正文返修 → 本地排版/导出。所有模型阶段采用同一 relay Chat Completions 配置与 gpt-6.1-sol 路由，不调用生图或平台发布接口。

大纲、成稿、当次确认快照及资源索引通过原子 JSON 保存于 `.local-state/`，七天历史与三十分钟证据/成品时效独立。原文完整 sources.text、凭证、ima签名地址不写入历史。读取不续期，后台不自动重发付费请求。

[完整协议](frontend-handoff.md) · [状态存储](server/state-store.ts) · [历史接口](server/history.ts) · [模型适配](server/model.ts)。
