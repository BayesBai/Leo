# ima 知识库：本机配置与上线前验收

本项目在后端调用随工程保留的 `ima-skill/ima_api.cjs`，业务代码位于 `server/knowledge.ts`。当前使用只读的知识库搜索、信息、目录、原文和笔记读取接口，不上传或改写知识库。配置录入本身不调用 ima，也不调用文本模型。

## 1. 隐藏录入 Client ID 和 API Key

在本机交互式终端运行，需要 Python 3：

```bash
cd /Users/maxchen/Documents/hackson
python3 scripts/configure-ima.py
```

依次粘贴 Client ID、API Key，每项按回车。两项均隐藏输入，屏幕不显示字符属于正常行为。随后输入知识库名称；留空保留现有 `IMA_KB_NAME`，文件未设置时使用代码中的项目默认库。若使用其他库，填写该账号实际有权读取的准确名称。按 Ctrl+C 或输入不完整时不写配置。

脚本原子更新项目 `.env.local`，权限为 `600`，同步保存 `IMA_CLIENT_ID` / `IMA_OPENAPI_CLIENTID` 和 `IMA_API_KEY` / `IMA_OPENAPI_APIKEY` 两套等值变量。仅输入非空库名时更新 `IMA_KB_NAME`。其他配置保留；重复的目标变量被替换。拒绝无交互终端时回显输入的降级行为、符号链接文件、空凭证、常见占位值、超长值及不可安全保存的字符。凭证只写私密配置，不打印、不放命令参数、不自动生成含密钥的备份、不调用网络。

`.env.local` 已被 Git 和 Docker 构建排除。不要把值写进聊天、截图、`VITE_*`、命令历史、Dockerfile 或交接归档，也不要用 `cat .env.local` 检查。不要通过 `source .env.local` 加载：这是 dotenv 文件，不是 shell 脚本。

## 2. 重启与验证

等待当前任务完成后，在原服务终端按 Ctrl+C 停止，再按原模式启动，例如开发环境 `npm run dev`，已经构建的生产环境 `npm start`。本次只新增配置工具，没有重启或停止现有实例。服务端读取顺序为外部进程环境 → `.env.local` → `.env`；每个变量的值使用先取得者。ima 再按短变量名 → OPENAPI 别名 → 用户目录官方凭证文件选择。因此，启动器、systemd、容器或终端已有旧环境变量时，必须同步更新或移除它们；仅写本机文件无法覆盖外部环境。

服务启动后可先只查看两个布尔状态；端口以启动日志为准，下例为默认 `3000`：

```bash
curl --silent --show-error http://127.0.0.1:3000/api/status \
  | node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>{const s=JSON.parse(b);console.log(JSON.stringify({configured:s.ima.configured,verified:s.ima.verified},null,2));})'
```

`configured:true` 只表示找到两项非空凭证，不验证有效性。重启后 `verified:false` 正常，验证状态仅在当前进程内保留，且有效期为三十分钟。下一条命令会真实读取目标库信息，不调用文案/生图模型：

```bash
curl --silent --show-error --max-time 180 \
  -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:3000/api/connections/verify \
  | node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>{const s=JSON.parse(b);console.log(JSON.stringify(s.ima?{configured:s.ima.configured,verified:s.ima.verified,message:s.ima.message}:{message:s.message},null,2));})'
```

后端按准确库名搜索，要求唯一匹配，再调用 `get_knowledge_base`；`verified:true` 说明这两步请求成功，不证明所有产品原文、图片权限或剩余读取配额通过。实际取证会按型号读取「产品事实.md」、可选「图片索引.csv」和对应图片，不用本地原图替代 ima 缺图。至少三个可提取事实且产品标题准确匹配；后续各渠道仍要求真实同型号原图。当前 UI 创作必须选择 `mode:live` 与 `knowledgeSource:ima`，会进入模型流程；纯连接验证不需要提交生成任务。

上线前还需独立验证一个实际型号的事实和图片，确认当前配额、文件格式、目录结构、图像真实格式及目标服务器出网。不要把原文、图片签名 URL 或真实私有资料写入公开测试报告。模拟测试不能代替这一步。

## 3. 部署配置边界

- 本机配置不会自动同步到云服务器。部署时在服务器私密配置文件或密钥管理中注入同一组 ima 变量与准确库名；两套别名若都存在应保持一致。用户目录凭证依赖运行账号，不适合作为隐式部署前提。
- 保留 `ima-skill/ima_api.cjs` 和 `ima-skill/meta.json`；从项目根目录启动，或显式配置 `IMA_SKILL_PATH`。后端固定 API 主机 `https://ima.qq.com`；媒体下载只接受代码允许的 HTTPS 主机，不跟随重定向。出网权限需在目标服务器验证。
- ima 脚本会检查官方版本；发现新版本返回 `IMA_SKILL_UPDATE_REQUIRED`，需审查更新后再验证。本次未更新或联网查询官方脚本版本。目录搜索、翻页、单次子进程时间和读取大小有上限；当前不解析 PDF/Office 原文，产品事实应提供支持的文本格式。
- 单服务实例有三十分钟内存证据缓存；媒体在受限本地状态目录保存，期限或凭证/库名变化会使旧证据不可复用。部署应为服务用户设置可写的 `.cache`、状态/媒体目录，并保护持久化数据。
- 当前应用仍是单操作者工作台。公网身份保护、反向代理 Host/Origin 配置、状态目录和渲染运行时仍按[接口固定入口](../api/README.md)的部署规划单独验收；填好 ima 凭证不代表整个系统已具备公网部署条件。

## 4. 当前结论

本次检查和配置工具不改变 HTTP 路由、请求/响应、SSE 或共享类型；前端无需新增适配。真实凭证由用户在终端录入，本次没有读取本机凭证值，没有执行真实 ima 连接、产品取证、模型调用或部署。实际自动检查结果见[本次交接版本](../api/README.md)。
