# apps/web — 体验页

## 不变量

1. **不假设同源**：apiBaseUrl 一律经 `src/lib/kit.ts` 解析（宿主注入 > `?api=` > `/api/config`）。
2. **不直接 fetch 业务接口**：一律经 文档公开的功能 `/hooks` hooks / `kit-sdk/providers/kit` Client。
   聊天必须展示文档中的显式 Provider 接入：通过公开 Request 与
   `createSessionEventChatProvider` 填写后端配置，再调用 `useChat({ sessionId, provider })`；
   配置集中在 `src/lib/chat-backend.ts`，不得依赖默认 Kit Context 隐式替换聊天后端。
3. **H5 与桌面浏览器同包**：布局靠断点（`max-md:` 等）与安全区（`env(safe-area-inset-*)`），
   不单独出包、不写 UA 判断分支。
4. **产物必须纯静态 CSR**：不得引入 SSR/服务端组件，支持静态托管。
5. **`src/styles.css` 必须显式声明 Tailwind 扫描源**：`@source` 覆盖 `index.html`、本 app 的
   `src/**` 与 `packages/chat-ui/src/**`。少了最后一行，chat-ui 的工具类不会生成，页面
   静默无样式（构建仍成功，很难发现）。
6. **视图切换只用查询参数**（不引 path router）：无参数 = 广场首页，`?agent=<slug>` = 聊天
   （深链语义永久保留），`?agent=<slug>&session=<id>` = 直达具体会话（刷新/分享可恢复，
   会话切换由 ChatView 经 `navigate()` 写回 URL），`?view=usage` = 我的用量；导航一律经
   `src/lib/use-route.ts` 的 `navigate()`，禁止 `location.href` 硬跳（会丢 SPA 状态与壳注入）。
7. **限额永远以服务端为准**：本地成员展示每日及每月 Token、每月执行时长限额；只有服务端明确返回
   非本地成员时才使用兼容 Credits。`quota_exceeded`（403）由 server 判定；前端只渲染
   `details` 的指标、余额与重置时间，不得本地计数。横幅出现时 Composer 禁用且保留草稿；
   重新检查所有已启用指标都可用且未超限后才恢复，失败或指标未知不得解禁。
   用户端绝对时间固定以 `Asia/Shanghai`（北京时间）展示，转换真实时间戳，不只替换时区标签；
   后端计量周期与日聚合键不变，界面展示对应的北京时间区间及重置时刻。
8. **被断点收起的功能必须留替代入口**：`ExperienceLayout` 复用 `kit-chat-ui` 的 `Layout`，
   在 <768px 用移动抽屉暴露导航、账号与会话切换/归档/删除。整条侧栏 rail（品牌、新聊天、
   `SessionSidebar` 会话目录、导航、账号）由 `features/layout/session-sidebar.tsx` 组装进
   `sidebar` 插槽，桌面与抽屉同一时刻只挂载一份。页头使用 `Layout` 提供的菜单入口，会话确认
   弹窗传入 `dialogs` 插槽。新增「仅桌面可见」的交互时同样要补 H5 入口，并在 E2E 的 mobile
   project 下覆盖。

9. **组件后端交互使用公开 SDK**：目录、搜索、上传扫描、首次发送、详情、产物与用量恢复
   使用 SDK 的 `sessions/files/chat/usage` 数据流程及各功能 `/hooks` hooks。Web 只保留配置、组件绑定、路由和
   纯 UI 状态；`backend.ts` 与 `chat-backend.ts` 显式填写示例后端映射，不通过默认 Kit 路由接入。
10. **宿主能力留在 web**：壳注入的对象只在 `src/lib/host.ts` 解析；文件选择、保存、
    剪贴板与主题 fallback 不进入 SDK 或 chat-ui。注入能力逐项覆盖浏览器实现，缺失或
    `saveFile` 返回 false 时必须有浏览器降级。
11. **品牌由管理端配置**：Web 启动时读取 `/api/config` 的 `branding.productName` /
    `branding.logoUrl`，不得读取 `.env`、构建时注入或硬编码「员工端」/产品名。
    `logoUrl` 支持员工端本地路径或在线 URL；缺失或加载失败回退产品名首字母。

## 加一个新页面/特性时

1. 优先复用 `kit-chat-ui` 组件；缺组件先按 chat-ui 的门槛补组件；
2. 状态来自 hooks，不在 app 内自建请求层；
3. 补 Playwright E2E（`docs/validation.md` 验收矩阵）。

## 强制它的闸门

- dependency-cruiser `browser-no-sdk-runtime-import`；
- `pnpm --filter web typecheck`；`pnpm e2e`（desktop + mobile 两个 project，mobile 覆盖 H5 抽屉）；
- `e2e/fixtures.ts` 自动夹具：React 非法嵌套警告即失败。
