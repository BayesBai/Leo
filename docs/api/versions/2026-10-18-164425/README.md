# 接口交接归档记录

- 北京时间：2026-10-18T16:44:25+08:00。
- 上一版本：2026-10-18-150507。
- 业务代码基线：bd179010c1175eb362cdecf990e804f6805211e1（工作区含未提交的前端改动）。
- 本次任务：前端第一阶段，新增 API 客户端层与纯模拟数据模式。
- 接口结论：已核对，无接口变更；前端无必需适配。

## 本次变化

- 新增 `src/api/client.ts`（请求与 SSE 解析）、`src/api/mock.ts`（夹具模拟）、`src/api/index.ts`（按 `?mock` 切换）。
- `src/App.tsx` 改用上述客户端，410 与 429 给出明确提示。
- 修改请求体与此前一致，只发送 `runId` 与 `instructions`。
- 未改动 `server/`、`shared/types.ts`。

[完整交接说明](frontend-handoff.md) · [请求样例](api-examples.http) · [模拟数据](fixtures/frontend.mock.json)

## 实际验证

- `npx tsc --noEmit` 与 `npm run build` 通过。
- `npm test`：56 项中 47 通过，0 失败，9 跳过（跳过项为既有测试的条件跳过）。
- 无头 Chrome 加 CDP，对 `?mock=` 场景实测：ok 生成与修改成功；error、needs_input 显示提示；expired 在修改时提示过期并保留成稿；blocked 显示待修正。
- 宽度 360、390、768 下三个面板的 `scrollWidth` 等于视口宽度，无横向溢出。
- 未验证：真实 `/api/generate`、`/api/revise` 联调、live 与 ima 模式、Markdown 导出文件的逐项验收，留待第三阶段。

本目录完成后只读。后续维护新增版本，不覆盖旧文件。源码参考快照不作为独立工程运行。
