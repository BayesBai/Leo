# 单独更新 Canva Client Secret（本轮进行中）

北京时间：2026-10-22T23:18:58+08:00；版本 `2026-10-22-231858`；上一版 `2026-10-22-230042`。代码基线 `d12b55b8026138dd65c887f400a7fc0152a9baa8`，分支 `frontend/workbench`。canva-secret 单输入命令和指引已冻结并完成临时模拟验证；根代理最终内容精确凭证扫描匹配0，已生成manifest并更新固定索引。

**已核对，无接口变更。** 路由、输入校验、共享类型及 Canva 绑定逻辑与前版一致，前端无需新增适配。新增的终端子命令只更新本机 Canva Client Secret，保留 Client ID、代理、回调、文本/生图 Key 和其他设置；只由用户本人隐藏输入，不在聊天或归档中填写 Secret。

```bash
python3 /Users/maxchen/Documents/hackson/scripts/configure-visual.py canva-secret
```

本轮在临时合成副本实际验证：合法更新、Secret重复行去重、15类非法输入不改文件、其他行/CRLF保留、必要的末尾LF、600、不打印Secret、无TTY拒绝、真实PTY隐藏输入及旧image/canva/all模式烟测通过，py_compile通过。保存新 Secret 后，须重启使本机配置加载，并由账号本人重新连接 Canva，让新 Secret 参与换码。同一应用的 Secret 进入绑定指纹，变更会使现有授权绑定不匹配；不能仅保存文件就宣布 initialize500 已解决。

本轮未修改真实 .env、未重启、未执行 OAuth/模型/设计或公网请求。前轮279/10项和网络探针均不计作本轮重跑。CLI验证及归档代理未读写真实凭证；根代理只为独立脱敏扫描在内存读取当前凭证，无输出、无修改。归档不复制凭证、私有素材、原output/session、授权或签名URL；不自动提交、推送或发工单。

[完整交接](frontend-handoff.md) · [现行样例](api-examples.http) · [纯Mock](fixtures/frontend.mock.json) · [本轮验证](verification/acceptance.json) · [完整配置指引](docs/setup/visual-integrations.md) · [前版结果](../2026-10-22-230042/README.md)

源码快照已按冻结实现刷新，仅脚本和配置指南相对前版变化；供阅读，不是独立可运行工程。实际验证只针对脚本/文档，不重跑前轮Node测试或生产构建。根代理独立扫描最终168文件精确匹配0；SHA-256与相对链接校验后封存，历史保持只读。

本版 [manifest.json](manifest.json) 记录所有归档文件及核对源文件的SHA-256，源码快照只供阅读，未暂存/提交/推送。
