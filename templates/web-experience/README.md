# kit-web-experience 模板

`pnpm kit:create <dir>` 的源模板。生成后依赖会被改写为 `file:` 指向 kit 仓库
（kit 包未发布期间）；开源迁移后改为 npm 版本号。

运行前提：
1. kit 仓库已 `pnpm build`（模板经别名直连 kit 的 dist 产物）；
2. 一个已启动的 `@openagentpack/kit-server`（默认 http://localhost:8787）。
若 server 不在同源，用 `?api=<baseUrl>` 或宿主注入 `window.__OPENAGENTPACK_KIT__.apiBaseUrl`。

Kit Server 默认要求成员登录。先在管理端「成员管理」创建账号，生成的体验页使用该用户名
和密码登录；Mock gateway 同样保留登录要求。只有显式 `KIT_AUTH_MODE=anonymous` 使用匿名模式。
登录状态在当前标签页 sessionStorage 中按完整服务地址隔离；刷新先验证，退出取消旧请求、
SSE 并清理消息、草稿和附件。登录控制器与 React hook 来自 Kit，不在模板复制认证状态机。
