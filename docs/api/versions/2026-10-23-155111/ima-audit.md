# ima 只读检查记录

## 已确认行为

- 配置顺序：外部进程环境 → `.env.local` → `.env`；ima短变量名优先于OPENAPI别名，再回退用户目录官方凭证文件。页面设置仅修改进程内存。见 [启动](server/start.ts)、[连接设置](server/connections.ts)、[业务接入](server/knowledge.ts)、[官方脚本](ima-skill/ima_api.cjs)。
- 后端强制官方API主机，官方脚本版本见 [meta](ima-skill/meta.json)。本轮未联网查询或升级脚本。
- 验证只调用 `search_knowledge_base` 和 `get_knowledge_base`，要求唯一准确库名。完整取证继续查找准确型号目录、唯一产品事实文本、至少三个可提取事实、图片索引与真实图片；不以相近型号或本地原图替代。
- PDF/Office不解析；支持Markdown/TXT/HTML/笔记。目录分页、深度、读取时限与文本/图像体积有上限。凭证、库名变化及三十分钟期限会使旧证据不可复用。
- 产品列表来自本地目录或固定公开种子目录，不会自动同步ima中新增加的任意型号。

## 已确认部署待办

1. 当前应用没有公开入口身份认证；`HOST=0.0.0.0`不会自动允许公网域名，TLS反代还需适配Host/Origin检查。见 [HTTP服务](server/index.ts) 与 [既有部署规划](deployment-plan.md)。
2. [Docker排除规则](.dockerignore)排除本机私密配置；必须在服务器独立注入。现有 [Dockerfile](Dockerfile) 也未安装完整Chromium系统运行时与可选视频工具。
3. 真实账号权限、目标服务器出网、读取配额及一个型号事实/图片仍未实测。`configured`不等于有效，`verified`只代表元数据请求成功。
4. 若部署改用用户目录官方凭证文件，现有错误脱敏仅替换环境变量值，未覆盖文件回退凭证。当前推荐显式环境配置；文件回退路径的脱敏需要后续修复并测试。
5. 官方脚本发现新版本时先记录当天检查标记，再阻止本次调用；当天后续调用可能跳过检查，因此当前升级提示不等于持续阻断。升级流程需要部署阶段复核。

## 本轮实施与验证

只新增 [录入工具](scripts/configure-ima.py)、[安全测试](tests/configure-ima.test.ts)和 [配置指南](docs/setup/ima-knowledge-base.md)，更新根README入口。未更改ima业务代码、共享协议或现有进程配置。工具仅在用户手动运行时写私密配置，不联网。所有18项模拟测试通过，实际范围见 [验收记录](verification/acceptance.json)。真实部署能力保持待验证。
