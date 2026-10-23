# 生图与 Canva 本机配置

这份说明对应本项目的后端直连。现有文本网关、模型和 Key 保留。生图使用独立 Key；Canva 使用开发应用凭证和一次账号授权。请勿把凭证发到聊天或提交 Git。

## 1. 生图 Key

在 relay.styxgate.top 的控制台创建或取得能访问 `gpt-image-2.5` 的 Key。具体模型权限以该中转站账号为准，本项目原样发送此模型标识，不替换名称。

打开终端执行：

```bash
cd /Users/maxchen/Documents/hackson
python3 scripts/configure-visual.py image
```

看到“生图网关 API Key（隐藏输入）”后粘贴 Key，按回车。输入过程中不显示字符是正常的。脚本将写入 IMAGE_BASE_URL=https://relay.styxgate.top/v1、IMAGE_MODEL=gpt-image-2.5、IMAGE_API_KEY；保留其他配置，原子保存到 `.env.local`，权限600。

## 2. Canva 开发应用

1. 使用希望保存设计的 Canva 账号访问 [Your apps](https://www.canva.com/developers/apps)。
2. 点击 **Create an app**，名称可以填 `Virgo Local`。
3. Pro 账号选择 **Public**。Private 类型要求 Enterprise。这里选择类型并在自己的开发账号测试，不执行应用发布。
4. 阅读并接受开发者条款后创建应用。这一步需要你本人完成。
5. 打开应用的 **Outside Canva**，点击 **Start integrating**，进入 **Configuration**。
6. 在 **Integration methods** 同时开启 **Canva REST APIs** 和 **Canva MCP**。本项目用 REST 导入分层文件，用 MCP 读取、编辑、导出。
7. 在 **Scopes** 勾选 `design:content` 的 Read 与 Write，以及 `design:meta` 的 Read。保存。对应完整权限为：

```text
design:content:read
design:content:write
design:meta:read
```

8. 打开 **Outside Canva → Redirect URLs**，填入并保存下面完整地址。不要换端口、主机名或加末尾斜杠：

```text
http://127.0.0.1:3000/api/integrations/canva/callback
```

9. 回到 **Configuration → Credentials**，复制 **Client ID**，点击 **Generate secret** 获得 **Client Secret**。Secret 通常只显示一次，保存到你自己的密码管理器。丢失后需生成新 Secret 并重新配置。
10. 在终端执行：

```bash
cd /Users/maxchen/Documents/hackson
python3 scripts/configure-visual.py canva
```

依次隐藏输入 Client ID 与 Client Secret。脚本自动保存上述回调地址。

后端优先读取项目根目录的 `.env.local`，其次读取 `.env`；已经存在的进程环境变量不会被文件覆盖。`.env.example` 只提供配置项示例，不会被服务自动读取。写法为 `CANVA_CLIENT_SECRET=实际值`，一般不需要引号；文档中的 `<YOUR_CLIENT_SECRET>` 是占位文字，必须换成开发门户生成的真实 Secret。推荐用上述隐藏输入脚本配置，避免误改示例文件。

当前官方 MCP 地址是 `https://api.canva.com/connect/v1/mcp`，由后端配置，无需在 Codex 中另外安装 Canva 插件。

### Canva 专用网络配置

Node 后端不会自动使用 macOS 系统代理。如果浏览器能访问 Canva，但后端读取 OAuth 元数据被跳转到其他地区站点，可让 Canva 请求使用你本机已经启用的 HTTP 代理：

```bash
cd /Users/maxchen/Documents/hackson
python3 scripts/configure-visual.py canva-proxy
```

输入代理软件中实际的 HTTP 代理端口；留空可停用。脚本只更新 `CANVA_PROXY_URL`，保留 Key、Secret 和其他配置。该地址仅供后端使用，只允许无账号密码的本机 HTTP(S) 代理。它不会修改系统代理，也不影响文本、生图或 ima 请求。配置完成后等待队列空闲再重启服务。

后端先读取 MCP 的 protected-resource metadata，再读取其授权服务器元数据，核对 issuer、官方 HTTPS 端点及 S256。当前官方元数据声明的 MCP token endpoint 是 `https://api.canva.com/auth/v1/oauth/token`，不能因 REST API 换码成功就假设 REST token endpoint 适用于 MCP。元数据发现不携带应用凭证；地区站点跳转或校验失败时停止，不把凭证跟随重定向发送。

## 3. 重启与授权

配置完成后告知开发助手“已配置”，由助手核对队列空闲后重启现有本机服务。若自己维护服务，在原终端停止旧服务，再从项目目录执行 `npm run dev`，避免同时占用同一个状态目录。

1. 浏览器打开 http://127.0.0.1:3000 。
2. 进入工作台的 **接入设置 → Canva 可编辑设计**。
3. 点击 **连接 Canva**，再点击 **打开 Canva 完成账号授权**。
4. 在 Canva 核对账号和权限后点击允许。这一步由账号本人完成。
5. 回到工作台，点击 **刷新连接状态**。

“已授权”只表示后端有令牌，不代表完整图层验收。真实验收还需一份分层文件导入、MCP 内容读取、标题层真实编辑、导出并下载到本机，检查中文换行与产品图层。

后端在授权、换取令牌和刷新时固定携带 `resource=https://api.canva.com/connect/v1/mcp`，并将目标、权限、授权版本与发现元数据指纹绑定到会话。没有该目标的旧授权仍需账号本人重新连接。已明确授权相同应用、权限及该目标的 `resource-v1` 会话，可在连接预检中向已核对的正式端点尝试一次刷新升级；不要求先重输 Secret。升级结果不确定或原刷新令牌不适用时停止，不循环请求。新授权继续由账号本人完成，不能用应用级凭证代替个人授权。

## 4. 常见情况

| 现象 | 处理 |
| --- | --- |
| 没有 Configuration 或 Redirect URLs | 先在 Outside Canva 点击 Start integrating |
| 没有 Private 选项 | Pro 账号使用 Public 类型开发；不需要为本轮购买 Enterprise |
| redirect_uri 不匹配 | 门户与本机必须都是上面完整的127.0.0.1:3000回调；从工作台重新连接 |
| invalid_scope | 门户勾选三个权限后保存；重新连接授权 |
| 已授权但 MCP 不可用 | 检查同一个应用是否已开启 Canva MCP；后端会先只读验证工具，再派发生图 |
| OAuth 元数据跳转到地区站点 | 检查后端网络与浏览器是否走同一路径；必要时配置已有本机 Canva 专用代理，不能把凭证跟随该跳转发送 |
| MCP 初始化返回500，但 OAuth 和 REST 成功 | 不等同于 Secret 格式错误。先确认同一应用的 MCP 开关已开启，再保留预检返回的 phase、upstreamStatus、providerCode 和 diagnosticId；如上游提供 requestId，也一并留存。以 `cf-ray:` 开头的是 Cloudflare 边缘追踪号，不是 Canva 原生请求 ID。设计侧预检不会创建或修改设计，也不调用生图；必要的令牌刷新或旧授权升级可能先执行一次 |
| 无法回到本机 | 检查3000服务仍在运行；授权和回调须在运行项目的同一台电脑完成 |
| state 过期／无效 | 从工作台重新点击连接；不要复制或重复使用旧回调链接 |
| 更换 Canva 账号或应用凭证 | 重新授权，新建视觉排版任务；已有正文与来源保留 |
| 生图模型不存在／权限不足 | 请中转站确认该Key能使用精确标识gpt-image-2.5；项目不会偷偷换模型 |
| 生图超时或结果不确定 | 先到中转站核对消耗。任务不会自动重复生图，主动重试可能再次计费 |
| 旧成品有审核标签 | 使用该渠道“重新排版”；复用正文，不再请求文案模型 |
| 素材已过期 | 主动重新生成视觉；普通读取、缓存命中和同步不会续期 |

如需发截图说明问题，请遮盖 Secret、Key、OAuth code 和完整回调查询参数。无需发送凭证。

官方参考：[Quickstart](https://www.canva.dev/docs/apps/quickstart/)、[MCP 接入与权限](https://www.canva.dev/docs/apps/mcp/access/)、[OAuth 认证](https://www.canva.dev/docs/apps/rest-apis/authentication/)、[MCP 授权目标规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#resource-parameter-implementation)。
