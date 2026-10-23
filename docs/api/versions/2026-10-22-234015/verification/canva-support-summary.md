# Canva 新 Secret 与真正新账号授权后的初始化失败摘要

同一用户任务的新Secret已加载，本人重新OAuth并至少一次换码成功，当前grant与新配置绑定匹配。主client唯一verify在3347ms返回MCP initialize500/internal_error；其REST预检按顺序完成，但该报告未独立记录具体REST状态，不补写200。浏览器回调总次数未独立统计。

为区分原生client协议与授权条件，只追加该本人重新授权产生的新grant的首次官方SDK1.32.1对照：协议2025-11-25，Token仅在内存、同生产canvaFetch显式代理，2026-10-22北京时间23:38:19.592，一次initialize500/internal_error，HTTP1806ms、总1855ms，未进入tools/list，无refresh、新OAuth或业务调用。

Cloudflare CF-Ray：a4e996af5ae42a96-IAD（边缘追踪号，不是Canva原生请求ID）。原生协议2025-03-26与SDK2025-11-25均失败，尚不能把原因100%归于平台或宣称MCP已接通；请支持结合此新grant条件核对应用授权能力/audience及服务器内部错误。

没有新Secret/ClientID/Token、授权URL/state/code、PKCE、代理地址或签名资源。未自动发送工单；没有追加测试/build、授权循环、模型或设计试验。旧版233024只读，当前安全统计见 [SDK报告](new-grant-sdk-comparison.json)。
