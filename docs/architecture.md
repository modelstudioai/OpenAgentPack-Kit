# 架构

## 进程与形态

| 形态 | 产物 | 运行时 | 说明 |
| --- | --- | --- | --- |
| `apps/server` | Node ESM | Node ≥ 24 | Hono 应用工厂 `createKitServer()`，数据面 + 控制面 |
| `apps/web` | 纯静态 CSR | 浏览器 | 体验页，支持 Web / H5 |
| `apps/console` | 纯静态 CSR | 浏览器 | 管理端 |
| `apps/storybook` | Next.js（Fumadocs） | Node | 文档站 |

体验页采用 CSR，构建产物可独立静态部署。

## 分层与依赖方向

```text
apps/server ──► @openagentpack/sdk（上游主入口，仅服务端 runtime import）
     └───────► kit-sdk/protocol 与 SDK 功能数据入口
apps/web / apps/console / packages/chat-ui
     ├───────► kit-sdk/<功能>/hooks 与 kit-sdk/providers/kit/react
     │                    └──────► SDK 功能数据入口
     ├───────► kit-sdk/hooks（屏幕判断）
     └───────► SDK 功能数据入口与 kit-sdk/protocol
```

自定义宿主注入的能力由体验页本地适配，不经过 SDK：
`apps/web/src/lib/host.ts` 读取 `window.__OPENAGENTPACK_KIT_BRIDGE__`，缺失时回退浏览器实现。

- `sdk/protocol`：同构契约（事件、SSE 帧、错误码、API schema、Skill token 与共享 DTO），
  只通过 `/protocol` 子入口导出；对上游 SDK 只允许 `import type` 与浏览器安全的
  `./session-events` 子路径。确认令牌与 Identity 属于 server-only 实现，留在 `apps/server`。
- `sdk`：源码与公开入口按功能组织（ADR-0026）。`chat`、`sessions`、`files`、`agents`、
  `usage`、`auth` 的 hooks 就近放在各功能的 `hooks/`。通用 `hooks/` 复用订阅、生命周期、
  查询工具和屏幕判断，公开 `/hooks` 只导出 `useIsMobile`；Kit Context 归
  `providers/kit/react/`，公开 `/providers/kit/react` 只导出 `KitProvider`、`useKitClient`、
  `useKitContext`。React 仅允许位于上述八个目录，不保留顶层 `react/`、SDK 根聚合入口或旧
  `adapters/react` 入口。`sdk-hooks-boundary` 将通用 hooks 的仓库内依赖限制为自身、
  `state.ts`、`protocol/` 与 `internal/`，禁止带入 KitClient、Context 或业务模块；
  `sdk-kit-react-boundary` 将 Kit React 接入的仓库内依赖限制为 Kit 自身，不得引入其他
  Provider 或功能流程。生命周期、订阅、查询与 Kit Client 解析工具保持内部使用。
- 数据处理继续遵守 Stream → Request → Provider → Chat：`kit-sdk/stream` 负责
  字节解码和原始 SSE 分帧；`kit-sdk/request` 负责 HTTP；Provider 定义后端接口、事件合同
  与消息转换策略；Chat 持有快照和消息，并负责连接、重连、发送、停止与审批。
  纯消息转换独立在 `messages/`；`kit-sdk/providers/bailian` 提供原始百炼 SSE 接入，
  仅使用上游 SDK 的浏览器安全 `session-events` 子路径。数据入口**禁 React、禁 Node-only API**。
- 组件调用流程按功能归入 `sessions`、`files`、`chat/composer` 与 `usage`，复用已有
  Request、Chat 和 `state.ts`，React hooks 只管理订阅与生命周期。
  `createKitClient({ request, operations })` 不构造默认 transport、不添加协议头；未配置能力拒绝调用，
  `supports(operation)` 用于隐藏入口。Web 仅在 `backend.ts` / `chat-backend.ts` 填写示例协议。
  ArtifactHost 是注入接口，实际开窗、文件选择、保存和 object URL 仍在 Web 本地 host。
- Console 的 `src/lib/admin/` 管理固定控制面请求、成员用量与 Operation 观察/恢复；
  查询与提交状态复用 `kit-sdk/state`，协议帧读取复用 `kit-sdk/providers/kit`。
  SDK 不提供 `/admin` 子入口，协议 DTO 仍在 `/protocol`，管理业务归属见 ADR-0025。
- `chat-ui`：视觉组件，只依赖 SDK 功能 hooks、消息类型与共享协议，**禁依赖 server**。
- 公共 `Layout` 统一桌面侧栏、移动抽屉、页头与内容区。`sidebar` 插槽接收关闭动作与
  关闭按钮；`header` 插槽接收移动菜单入口。布局只处理视觉与交互，不持有路由、认证、
  请求或会话生命周期。`SessionSidebar` 只渲染会话目录区（智能体分组、最近、搜索与行内
  操作），不提供整页与移动抽屉编排，因此 `Layout` 以 Radix Dialog 组合抽屉能力，
  复用现有 theme token。
- 体验页的 `features/layout/experience-layout.tsx` 使用 `Layout` 组合广场、用量与聊天：
  侧栏 rail（品牌、新建入口、`SessionSidebar` 会话目录、导航与账号）由调用方组装成
  一个 aside 放入 `sidebar` 插槽，桌面与移动抽屉共用同一内容，同一时刻只挂载一份；
  Radix Dialog 管理模态焦点、Escape 与返回焦点。调用方把受控
  会话确认弹窗传给 `Layout.dialogs`，抽屉打开时弹窗进入其焦点范围，跨断点仍可见，
  plan → 显式确认流程继续由业务持有。
- 体验页经 KitClient 读取本人会话关联的全部智能体，展开分组时才带 `agent_slug` 查询前 10 条，
  向下滚动到该组尾部追加下一页。服务端在分页前过滤归档，游标绑定身份与筛选，不依赖上架目录
  或 Provider 事件查询。各组与全局「最近」分别缓存，单组失败不影响其他组或最近列表。
- SDK `sessions/session-pages.ts` 共用十条分页、取消、异常游标检查、按会话 ID 去重和失败重试；
  公开 `useSessionDirectory` 绑定各组和最近，`useSessionSearch` 使用同一分页逻辑。
  会话的点击来源也由 Shell 的 `useSessionDirectory` 持有，侧栏重挂载时保留「最近」或智能体
  分组的选中位置，避免切换页面、移动抽屉重开及跨断点时回退到其他分区。
  缓存留在 Shell，折叠再展开、切换会话和移动抽屉关闭后保留已加载页；目录变更与当前执行状态
  收敛后重取已加载组和最近的首屏。服务端为受理的回合保存 `clientMessageId/event_ids` 等
  操作证据，由完整事件账本和 pending turn 共同投影运行态：旧 idle 不得结束尚未完成的回合，
  只有匹配本轮的终态证据才清除 pending turn。发送受理后回取摘要；目录里仍有非当前会话处于
  running，或当前会话的实时相位已收敛但摘要仍是 running 时，侧栏轮询并只把最新摘要合并回
  已加载行，不重置分页。选中行的实时相位只做视图覆盖，不回写目录；共享泵在订阅者离开后
  继续跟踪 running 回合到真实终态。分页失败保留原游标和列表，仅明确重试后继续。
  `SessionPageList` 复用公共 SessionList，通过共享滚动区中各列表的组尾位置触发加载，
  同时提供加载更多按钮。搜索经 `/api/kit/sessions?q=` 覆盖全部未归档会话索引，结果按 Agent
  分组展示并独立分页，不依赖分组展开或已加载页。
  新聊天页最近使用直接消费按活动序排列的智能体目录，不依赖会话加载进度或展示不完整总数。
  显式完整读取目录的 SDK 调用仍由 SDK 的 `sessionDirectory` 负责，侧栏不调用此方法。
- 聊天页使用 `AgentHeader` 的 `compact` / `leading` 插槽，将移动菜单与连接状态合入同一
  固定高度页头；名称保留原生选择器，右侧以 `StatusIndicator` 的 `badge` 变体展示状态，
  长名称与错误文本在各自区域内收缩。新建会话统一从侧栏进入。公共组件默认样式保持兼容，业务图标判定继续复用
  `isIconImageSource`。页面只保留布局、导航、组件绑定和纯 UI 状态；附件、额度等调用流程由公开 SDK 编排。
- 消息区通过 `Chat` → `MessageList` → `Message` 的 `workspace` 变体复用公共组件，
  按 `--kit-chat-width` 居中限制阅读宽度；用户保留右侧气泡，助手正文使用无外框布局。
  输入与审批内容对齐到同一阅读列，宽表格在独立可聚焦区域内横向滚动。
  消息内容在列表自身纵向滚动，稳定消息／分片身份、流式跟随和会话切换行为不变。
- 工作区 `Chat` 将 `variant` 传给默认 `Sender`，采用上方编辑区、下方操作栏；`prefix` 在左、
  `suffix` 在右，`header` 附件仍在同一输入边框内。自定义 sender 由调用方显式选择该变体。
  默认 `Sender` 保留原有同行布局及提交、停止、草稿、输入法和禁用合同。审批卡
  位于主消息流末尾，输入卡上方只保留等待提示。消息留白放在滚动内容层，附件面板
  和长草稿也独立限制高度，防止短视口下挤出操作栏。
- `Chat` 的可选 `multiAgent` props 经 `MessageList` 在主消息流的派发位置呈现子 Agent
  卡片：数据与动作来自 `useChat().multiAgent`，chat-ui 不请求网络。展开卡片按需加载只读
  历史，分页或重试不清空已有结果；主输入持续挂载，草稿和附件不受卡片开合影响。
  资源面板的 `SubAgentPanel` 按名称归并派发任务，通过弹窗读取同一份线程历史。
  主审批与停止仍由主会话编排，旧 `threads` 消息分组与 SDK 线程选择接口保持兼容。
- `Layout` 默认通过 `fitViewport=true` 适配移动浏览器的可视视口：只向自己的根容器写入
  当前可用高度，软键盘出现时限制布局；浏览器缩放不触发此收缩。缺少 VisualViewport 时
  使用窗口高度及 CSS 视口兜底。其他宿主可传 `fitViewport={false}` 自行管理高度；其他
  chat-ui 组件只消费容器样式，不独立监听可视视口。
- 正文排版复用 `Markdown` 的语义标签与冻结 token，代码围栏继续交给 `CodeHighlighter`，
  工具栏和局部滚动内容分别布局；行号不进入复制内容。标题、列表、引用、链接、行内代码及
  亮暗语法高亮由 chat-ui 统一呈现，sanitize 与模块级 Mermaid renderer 保持原有边界。
- 执行过程复用 `ReasoningBlock` 与 `ToolCallCard`：思考与工具步骤默认收起，摘要行露出
  动词与内容预览，状态用图标表示；正文分片终结该轮执行后容器收起，消息完成后全部收起，
  手动展开选择保留。参数与结果分区展示。
  原生折叠状态依附稳定分片，同一生命周期阶段的累计快照保留手动选择；正文、工具与文件
  保留交错顺序。工具审批独立可见，允许与拒绝一步直提，冻结参数在卡上完整可查。
- 欢迎态复用 `EmptyState` 与 `Prompts` 整体居中，推荐问题按可用宽度排列；加载态使用
  `EmptyState loading`，错误态复用 `ErrorState`。广场、个人用量和成员登录共用主题卡片、
  控件与焦点样式，仍由原有 hooks 和页面编排持有数据、路由及认证状态。
- 员工端在 `apps/web/index.html` 的根节点通过 `data-kit-appearance="workspace"` 选择独立
  的暖灰视觉基础；亮暗色板、语义字号、实色表面、选中／焦点、状态色和圆角／阴影统一定义
  在 `chat-ui/theme.css`。管理端与默认组件预览不启用该属性，保留原有色板；Portal 与
  移动抽屉继承页面根节点主题。
- `server`：只依赖 `protocol`（共享 DTO），运行时依赖 `@openagentpack/sdk`。
- UI 组件栈边界：antd 仅限 `apps/console`（ADR-0015），其余 app 与全部 packages 禁止；
  对话链路组件（消费 SessionEvent/消息分片/会话状态）在所有端一律 `kit-chat-ui`。
- 由 `.dependency-cruiser.cjs` 强制，规则名与包级 `AGENTS.md` 一一对应。

Skill 是开发期内容，不加入上述运行时分层。人工源与生成脚本位于 `scripts/skills/`，
最终 Skill 生成到 `assets/skills/`。脚本读取 Kit 公开 TypeScript 类型与导出，生成英文
API 参考和文档站示例。这些示例只引用公开包入口，按文档编译用途排除孤立入口检查，
不放宽实际运行时代码的依赖边界。Skill 不执行网络接入，不取代 `ChatProvider`、hooks
或 SDK 的实现。

### SDK 数据四层职责

Stream 源码位于 `packages/sdk/src/stream/`，与 HTTP 的 `request/` 目录并列；
分别从 `kit-sdk/stream` 与 `kit-sdk/request` 导入。Request 复用 Stream，Stream 不反向依赖
Request；沿用下表中的职责与原有实现。

| 层 | 输入与输出 | 边界 |
| --- | --- | --- |
| Stream | `ReadableStream<Uint8Array>` → `AsyncGenerator<RawSseMessage>` | 解码、分帧、取消、释放 reader；不请求网络、不解析 JSON |
| Request | 路径、RequestInit → Response、JSON 或原始 SSE 帧 | URL、动态身份头、fetch、HTTP 错误；默认无重试、无超时、无 Kit 协议头 |
| Provider | 后端响应 → SDK `SessionEvent`；事件 → `ChatMessage` 的转换策略 | 管理一次连接及就绪/历史；提供无跨会话状态的 `transformMessage` |
| Chat | Provider 与事件快照 → `SessionSnapshot` 和会话动作 | 持有 ledger 与消息；调用 Provider 转换、维护乐观消息、重连、发送/停止/审批 |

`createTransport` 是现有 Kit 协议传输入口，组合 Request 与 Kit 帧消费，保留协议头和
45 秒有效帧超时。`KitClient` 是 Kit Server 的业务 API 门面，仍支持目录、会话与文件。
`createChatController` 从 `kit-sdk/chat` 提供，`useChat` 从 `kit-sdk/chat/hooks` 提供；
React hooks 只管理订阅与组件生命周期。
标准事件后端通过公开 `createSessionEventChatProvider` 配置 Request、订阅请求及四个业务操作，
可选配置线程查询；JSON 包装和路径归调用方。它复用现有标准事件控制帧处理，不加载原始 SDK 转换器。
Web 的 `lib/chat-backend.ts` 是实际运行的示例配置，明确填写 Kit Server 的路径、版本头及
响应映射；页面通过 `useChat({ sessionId, provider })` 接入，文档和自建后端使用同一公开工厂。
登录 Controller 的 `createChatProvider(request)` 为本次身份创建 Provider，Request 复用固定
应用令牌及取消边界。HTTP/SSE 鉴权失效清除本次身份，退出使旧 Provider 和 Client 一起失效。
会话目录、文件、广场和限额继续作为示例应用的独立业务接口，通过公开 Client/hooks 接入并记录在文档中。
原始 Provider 必需 RequestClient 和六项 `buildRequest` / `mapResponse` 配置；
构造和转换保留业务后端定制能力，网络请求统一经 Request 执行，见 ADR-0008。
线程查询为两项可选操作；`createBailianThreadOperations` 预置百炼标准 REST 路径与响应，
自建后端可保留标准 API，也可覆盖路径和包装转换。线程页使用独立 SDK normalizer，
不改变活动 SSE 的增量状态。Chat 独立保存补充历史与查询代次，只影响子线程消息，
不修改主会话的 cursor、phase、审批与乐观消息；Session reset 会使补充历史失效。
内部依赖由 `sdk-stream-boundary`、`sdk-request-boundary`、`sdk-provider-boundary`
限制，禁止低层反向引用 Provider 或 Chat。
`sdk-state-boundary` 限制通用状态只依赖协议；`apps-sdk-public-entries` 限制应用只消费 SDK
公开入口。SDK 数据层与 React 适配层均禁止反向依赖 Console。
`streamProtocolFrames` 公开复用既有帧读取，只消费注入的 Request 与路径，不配置管理业务或身份。
`sdk-message-transform-boundary` 限制 `messages/` 仅依赖协议与自身的纯展示逻辑，
不反向依赖 Chat，也不引入 Request、Stream 或后端 Provider。Provider 定义转换规则、Chat
执行重建并保存结果的边界见 ADR-0009。
`sessions/load-directory.ts` 是 Client 可复用的独立读取叶子，不能引用 Client 或会话工作流；
Provider 不能经功能聚合入口间接载入高层流程，Chat 核心不能反向引用 Composer。
功能入口隔离规则禁止通用功能引入原始百炼转换器；只有显式使用
`kit-sdk/providers/bailian` 时才加载 SDK 的浏览器转换依赖。默认消息转换同样受此隔离约束。

## 管理端页面路由与静态部署

管理端以 Browser History API（`pushState` / `replaceState` / `popstate`）实现路径路由；
应用仍是静态 CSR，不需要服务端渲染。URL 决定页面与资源定位，认证只拦截内容，不丢弃原路径。
根路径 `/`、旧上架目录 `/catalog`、旧导入预设包页 `/preset-packs/import`、旧工作台 `/project` 及其子页面和无法识别的路径规范化到 `/templates`。
旧 `agent` 定位参数会清除，旧工作台不再渲染或请求项目数据；智能体资产父菜单同样进入模版列表。
管理端不提供独立上架目录页面；上下架与展示配置维护由模版管理承载，底层 Catalog 数据与接口保留。
成员管理直接展示成员列表，不提供用户组界面；旧 `/groups` 及其子路径规范化到 `/members`，保留 `?api=` 等宿主参数。
已有用户组、成员关系和控制面 API 保留，页面不再发起用户组查询或写入。

| 页面 | 路径 |
| --- | --- |
| 创建智能体、智能体管理 | `/templates/new`、`/templates` |
| 模版详情、编辑、详情调试 | `/templates/:id`、`/templates/:id/edit`、`/templates/:id/debug` |
| 日志、用量汇总 | `/operations`、`/usage` |
| 成员列表、创建、用量详情 | `/members`、`/members/new`、`/members/:id/usage` |
| 评测与报告 | `/eval`（`?workspace=&run=` 定位工作区和报告） |

创建页初始只展示创建方式选择，不挂载配置表单与资源草稿。「导入现有配置」打开既有「导入预设包」抽屉，成功后挂载回填表单，取消或失败保留选择页；「从零开始创建」挂载原有空白表单。
从零创建的表单不显示页头导入入口，导入回填后的表单页头仍提供「导入预设包」抽屉。单选远端 Agent 后，通过 `/api/admin/preset-packs/agents/:agentId/resources`
查询 Provider 可见的全部关联会话。Gateway 使用 SDK 公开 `listSessionSummaries` 的 `agent_id/page`
过滤和分页，按会话 ID 去重，再以最多 4 个会话并发合并 `getSession` 的环境/密钥库/创建资源与
`listRemoteSessionResources` 的全部当前挂载页。只返回元数据和资源引用，不查询事件、不落库；
同会话引用按资源身份、挂载路径和权限去重，不同权限保留给导入冲突校验。
资源分页失败保留此前已读取的全部页及会话配置，并设置 `complete=false`，会话列表失败不交付截断结果。
此入口只服务预设包发现，不恢复通用会话运营；客户端经既有 `useAdminQuery` 管理取消与迟到响应。
页面将结果按资源类型分组，同类型按底层资源 ID 跨会话去重，合并挂载路径、权限与来源；
每组独立分页，不展示会话列表或会话 ID。接口继续保留会话粒度以支撑发现与部分失败标记。
资源列表通过点击整行或聚焦后 Enter/空格打开配置详情，才调用现有只读接口；详情加载成功后才可确认选择，不提供「查看配置」操作、checkbox 或全选。
已选行使用 antd success 绿色 Tag，并在选择状态列提供取消入口，取消不触发详情；加载、提交及详情打开期间禁止激活资源行。
选择状态按类型约束：环境确认后替换旧环境，文件/记忆库/密钥库最多多选 10/8/10 个；复用创建页既有数量常量，分组展示规则，达到上限只禁止新增选择、不禁止查看。
环境、记忆库、密钥库复用既有安全配置合同及展示组件，文件只读取上传文件目录元数据；选择状态和查询生命周期由 console 管理。
记忆条目只在用户查看详情时读取并展示，不进入预设包或模版引用配置；不读取文件正文、会话事件或密钥值。
条目快照无法完整读取时，重新通过未归档记忆库目录核验身份，展示原库名称及条目未完整读取提示，允许确认复用引用并提供重试；
元数据不可读或库已不可用仍禁止选择，不将读取失败伪装成空条目。
创建页抽屉使用 `PresetPackSelection`，通过 `useRemoteAgents` 查询完整远端智能体列表，
支持名称/ID 搜索、分页单选与资源多选，不依赖 SQLite 已保存目录。
「导入」经 `presetPacks.preview` 重新核验所选资源、固定版本与元数据，只返回白名单配置，不写预设包或模版。
创建方式选择与表单页头的抽屉直接回填当前创建页，不提供侧栏独立页面或 Shell 跨页载荷。
已有配置或未发布资源时先确认替换，再以独立资源草稿回填；展示名称、分类和文案在当前页面内保留。
同一智能体及资源组合也可重导入，未确认或失败不改变原表单，批次清理沿用既有流程。
新导入不向 URL/history.state 写入配置或保存 ID，刷新回到创建方式选择页。历史已保存记录及 `?preset=<id>` 兼容读取并直接展示回填表单，
当前导入入口不调用 create/list/get 保存目录接口。后续调试、保存和发布继续沿用原有流程与确认闸门。

基础配置的远端 Agent 详情复用上述只读发现接口，查看详情时预读，检测期间「确认选择」显示加载状态。
点击智能体详情的「确认选择」后传递有效预读结果，选择抽屉关闭即提示是否使用关联资源，不再等待第二次查询；
未确认或取消详情不弹提示、不更改表单。提示确定并关闭后再打开资源多选抽屉；初始快照、页头导入和本地未发布 Agent 不触发自动检测。
查询与资源多选共用一次发现结果，仍经 `presetPacks.preview` 核验所选身份和挂载信息。
资源选择组件通过可选操作区与反馈区容器，将「使用所选资源」及提交失败提示挂载到 Drawer footer，使用按钮与取消按钮并列，错误位于按钮上方；选择、校验及提交状态仍留在同一组件，滚动不影响操作与失败反馈的可见性。
关联结果仅合并到当前页面的运行时草稿，不重建基础配置或展示配置；同身份保留已有编辑，环境单选，
合并后超量或文件路径冲突整体拒绝。无资源不提示，失败或空的部分结果可重试/取消；卸载取消在途查询与提交。

「日志」页 `/operations` 使用 `admin.audit.list` 展示当前管理身份的操作审计，按时间倒序分页，不提供刷新按钮。
服务端从认证上下文取得主体，在查询和总数统计前过滤；管理员与审计员均只能读取本人记录，客户端不能指定其他主体。
列表展示时间、操作类型与对象，不展示操作人；智能体新建、编辑、删除、上下架使用操作时的脱敏名称快照，
删除对象后仍可查看。旧日志缺少名称时显示目标 ID；加载失败提供重试，不显示为空记录。
审计写入、列表和总数共用智能体操作白名单，仅保留新建、编辑、删除、上架和下架，包含旧目录接口的对应操作。
资源草稿/发布过程、成员/组、限额、登录、文件和会话等其他动作不写入；旧非白名单记录在分页前排除，不删除历史数据。
长任务的 Operation 状态与 SSE 仍服务发布流程，日志页不再以长任务进度列表作为操作记录。

模版详情的 `?version=N` 固定已保存历史版本；成员用量 `?from=usage` 保留返回用量列表的来源，
`?limits=edit` 打开既有个人限额表单。新建/编辑的 `?step=preview` 标识预览步骤；其草稿仍只存内存，
刷新或直接访问缺少已准备预览的地址时，新建回创建方式选择页，编辑或历史预设包链接回配置，不自动创建或发布资源。弹窗与资源选择抽屉属于页面操作，
不会把未保存内容或确认状态写入地址。导航仅清除自己管理的参数，保留 `?api=` 及宿主参数。

`console-router.tsx` 统一侧栏、页内导航与历史遍历，操作忙碌时锁定；浏览器返回时先恢复当前历史条目，
再沿用未发布批次退出确认，取消保留原 URL 与草稿，确认后才真正切换。保存完成的定位同步不重发写请求。
成员用量深链通过 `admin.members.get` 按 ID 查询公开资料，不扫描整个目录，也不依赖列表中的对象。
创建成员深链先确认管理员身份，auditor 仅显示只读提示。

Vite 开发与 preview 服务已有 SPA fallback。生产静态服务器必须把前端路径回退到 `index.html`，
并保留 API 与静态资源自己的路由；不能将 API 错误改为 HTML。仓库目前没有管理端生产反向代理配置，
部署方需配置等效规则。以专用管理端域名的 Nginx 为例：

```nginx
# /api/ 的代理由部署方配置，优先于前端回退。
location /assets/ { try_files $uri =404; }
location / { try_files $uri $uri/ /index.html; }
```

本路由表以域名根路径部署为约定；前后端可跨域，API 地址仍沿用公开配置解析。

### 独立发布产物

`pnpm build:release` 在 Node 24 环境构建后端、体验页、管理端和静态文档站，输出至
被忽略的 `.scratch/releases/kit-*` 独立目录。后端由 `pnpm deploy --prod` 收集生产依赖，
入口为 `server/dist/bin.js`（相对于发布产物目录）；三个静态站点位于 `sites/web`、`sites/console`、`sites/storybook`。
`release.json` 记录构建时的提交与工作区修改状态，不把本地产物等同于已发布版本。
成功后生成固定入口 `.scratch/kit-release.tgz`，仅在完整打包成功后替换该压缩包。
文档站的 prebuild 会重建 chat-ui，因此在其他应用构建完成后单独构建，避免并发清理依赖产物。
独立发布使用 Next 内置 Webpack，显式执行原有 prebuild 与搜索索引复制，避免依赖
Turbopack 编译进程的临时监听端口；文档站自身的开发及默认构建命令保持原配置。

发布产物不复制根 `.env` 或本地数据库；凭据由部署环境仅向后端注入。
数据目录与本地资源必须位于持久化磁盘，独立于可替换的代码产物，并避免并发启动多个写实例。

## Server 内部结构

上游 SDK 使用 npm 正式发布的 `@openagentpack/sdk@0.10.0`，由精确版本与
`pnpm-lock.yaml` integrity 锁定，不再依赖仓库内归档或修改 SDK 编译 chunk。
server 仅使用 SDK 公开导出，浏览器仍只消费安全的 session-events 子入口。

```
apps/server/src/
  app.ts            createKitServer(options) → Hono app（组合中间件与路由）
  index.ts          CLI 入口：读 env → 建 app → @hono/node-server 起服务
  config.ts         env 解析与校验（失败即退出，不带默认凭据跑）
  gateway/          ProviderGateway 抽象 + sdk.ts（真实）+ mock.ts（演示与测试）
                    + bailian-rest.ts（建会话挂附件的窄口子，见其文件头与 docs/research/）
                    + sdk-context.ts（ProjectRuntimeContext 装配，live 脚本共用）
  services/         identity（anonymous / jwt / admin 多令牌+角色）/ sessions / session-streams /
                    event-buffer / tool-approvals /
                    attachments（挂载路径解析）/ confirm-gate / rate-limit / metrics /
                    catalog / templates（本地模版资源复核、保存与上架确认）/ project / operations / members（本地账号创建与密码派生）/
                    member-usage（累计采集）/ session-deletion + session-mutations（删除协调与写入保护）
  store/            node:sqlite + 幂等迁移 + DAO（catalog / templates / members / sessions / quota / operations / audit /
                    session-usage 数值快照 / session-deletions 阶段）
  routes/           kit/*（数据面）admin/*（控制面）config / healthz
```

关键不变量：

1. **路由不直接调用 SDK**，一律经 `ProviderGateway`。这样 mock 与真实 provider 走同一条
   路径，也让上游 API 变化只影响一个文件。SDK 的形状事实（list 返回 `{data}`、会话只认
   声明键、建会话必须带 environment、apply 需走 backend 感知的 sync 等）记录在
   `docs/research/sdk-session-runtime.md`，改 gateway 前必读。
2. **事件不落库**。SQLite 存 catalog、已保存模版配置目录与不可变配置版本、成员目录、session 本地索引、成员累计用量数值快照、
   删除阶段、月度限额数值增量与请求幂等索引、兼容 Credits 账本、operation 与审计。快照只含归属与运营字段，不含事件、消息正文或
   附件字节。成员密码仅存随机盐与 scrypt 派生值，不保存明文；Provider 凭据不落库。
3. **凭据不出服务端**：`CredentialResolver` 只在 gateway 内部使用；错误与日志脱敏。
4. **破坏性动作两段式**：`plan` 发一次性 `confirmationToken`，执行请求必须回传
   （字段名是 snake_case：`plan_id` / `confirm_token`）；上下架同样走这条闸门。
5. **管控面角色分离**：`auditor` 只读，写方法在中间件层统一拒绝（不逐路由加判断，避免漏）。
6. **单实例假设（v1）**：事件缓冲、限流令牌桶、确认令牌的「已消费」集合、成员刷新队列和
   会话写入 / 删除互斥都在进程内存，
   SQLite 是单写者文件。多副本部署需要 sticky session（同一 `subjectId`/会话固定到同一副本）
   或把这些进程内状态换成共享实现（`EventBuffer` 已接口化，预留 Redis adapter）；在此之前不要
   水平扩容，否则重连重放与限流都会失真。

### 成员累计用量与删除协调

Gateway 从 SDK 公开 `getSession().attributes` 读取累计 usage/stats，`member-usage` 按
本地 `member_id = subjectId` 遍历全部 experience 会话，`session-usage` 按 session_id
替换数值快照。管理端经 console 本地 AdminClient、成员用量控制器和 admin hooks 读取缓存和采集进度，
不直接访问 Provider。详情分页不限制汇总范围；Agent 筛选同时作用于汇总与明细。

成员列表只调度当前页成员，普通读取使用 60 秒 TTL，新建待采集会话可提前刷新。同一成员
刷新合并，进程内最多 4 个有效采集任务，详情等待 15 秒后标失败并忽略迟到结果。SDK 详情
API 无取消信号，因此不能保证超时底层 HTTP 立即结束。按游标分批扫描，服务重启后可重新
扫描；逐会话采集版本保证迟到结果不能覆盖较新或已封存的快照。某条失败保留以前已知数值
并标明失败，其他会话继续采集。

成员会话删除经过原有 plan 与显式确认后，由 `session-mutations` 拒绝新的消息、审批等
写入，并等待已进入的写请求结束。`session-deletion` 确认执行已结束（待审批也须中断），
重新查询用量，事务提交快照后才向 Provider 发 DELETE。远端删除与 SQLite 不是跨系统
事务，因此 `session-deletions` 持久化准备、封存、删除中、结果不明与已删除阶段。
结果不明时维持写入保护；重启后仍按阶段核实，不盲目恢复发送或自动重放删除请求。
重试采集不能覆盖此前已发出 DELETE 的持久事实，GET 仍存在不能消除网络错误带来的
不确定性。发出 interrupt 后的保护也保留到显式删除完成，避免旧请求迟到时影响新执行。

确认远端删除后，保留快照并移除正常会话索引；历史统计不因删除而减少。保护只应用于真实
本地成员的 experience 会话，匿名 / 外部 JWT 和 admin_debug 不加入成员统计。
这条链路不增加事件存储或 SDK 转换。累计展示与月度限额使用不同的数值索引。

### 成员月度限额

`services/usage-limits.ts` 在既有订阅就绪、工具审批与删除保护之后、Gateway 消息发送或
允许工具执行之前检查真实本地成员的月度状态。`store/usage-limits.ts` 保存默认/个人配置、
首次计量时间、逐会话累计基线、执行受理月、每月增量及请求指纹/结果 ID，不保存事件正文。
`services/quota.ts` 对本地成员仅记录 Turn 运营索引；匿名和外部 JWT 保留兼容 Credits 行为。

读状态与发送共享成员级串行锁，读取最新 Provider 数值后再判定；已删除会话使用封存快照。
启用指标无法确认时拒绝新消费。有限额的成员在上一轮尚未结束时不能并发开始下一轮；确认
结束仍依赖 Provider 主会话状态与历史，不把子线程 idle 当作结束。成功受理请求可幂等回读，
发送结果不明则持久化保护，重启后也不盲目重发。拒绝审批、中断和确认删除不受额度阻止。

首次数值只建基线；以后增量归到最近一次 Kit 受理执行的 UTC 月，跨月一轮归开始月。
Provider 只有累计统计，状态结束与统计写入未被证明原子同步，延迟指标可能归到下一次受理月；
因此这是后续发送管控而非精确月账单或单轮硬上限。页面与协议必须公开这个边界。

体验页 `MemberUsageView` 从既有 `useUsageLimits` 的同一状态响应展示每日 Token、每月 Token
和每月执行时长卡片。每日卡直接消费 `day_state.tokens/day/reset_at`，共享限额卡片与 MeterBar，
周期文案分别使用今日/本月已用、每日/月度上限；日与月分别呈现服务端状态。未知用量不显示为零，
刷新失败保留已有快照并提示错误；逐日热力图不作为日限额或重置时间的事实来源。
用户端 Token 展示经 `lib/format-token-count.ts` 统一使用英文千进制 K/M/B/T，最多两位小数、
去末尾零并处理舍入跨单位；完整值保留在原生悬停提示中。卡片、热力图及超限提示共用此规则，
仅改变文字表示，进度条及准入判断继续消费原始数值，执行秒数与 Credits 不缩写。
`lib/beijing-time.ts` 统一将绝对时间转换为 `Asia/Shanghai`，覆盖重置、计量开始、最近采集及
申请/审批记录，不依赖浏览器时区。后端 UTC 计量不变；日聚合键对应的北京时间起点为 08:00，
每日卡与热力图明确标出分界，不将服务端日聚合量重新解释为北京零点至零点的用量。

## 数据流（会话订阅与一轮执行）

以下是默认 Kit Server 链路，既有 `useChat(sessionId)` 调用方式不变。

1. 页面选择会话，controller 建立持久的 `/api/kit/sessions/:id/stream` 订阅。
   server 为该会话共享一个上游 pump：先连接并暂存实时快照，再读完分页历史，归并后发出
   `reset → event* → ready`。只有收到 `ready` 才允许发送消息或审批响应。
2. 用户发送消息，SDK 保存独立的乐观消息；server 校验归属并等待 pump 就绪，然后调用
   `gateway.sendEvent()`。消息与审批 POST 都只发送一次，断流恢复不会重发业务请求。
3. gateway 通过 SDK 的 `snapshot` 模式消费完整 `SessionEvent`。server 在内存中维护
   最新事件索引与有界变更日志。每次有效更新分配 `epoch:sequence`，以 SSE `id` 下发；
   `event_id` 是事件身份，不能用于充当传输游标。
4. SDK 对同 `event_id` 做快照替换并重建投影，保持首次展示顺序与稳定分片 ID；React adapter
   订阅消息、子线程、产物、执行阶段和审批待办；chat-ui 按分片顺序渲染。
5. 主会话进入 `idle` 且不含 `requires_action` 时本轮收敛，连接继续保持。`requires_action`
   保持等待审批，普通消息禁发，草稿仍可编辑。停止、失败、中断与网络状态独立表达。
6. 审批待办由最新主状态的 batch/call 标识定位。审批卡展示冻结的实际工具参数，允许与拒绝
   均为一步直提、每次只处理一项；server 再读 Provider 历史校验归属、当前待办与重复响应，
   经 gateway 写入 `tool_approval_response`。未知工具协议只读展示。详见 `docs/protocol.md`。
7. 浏览器断线只恢复 Kit 订阅；SDK 负责 Provider 连接恢复。有效 `after` 游标重放变更日志，
   无效或过期游标触发全量 `reset`，SDK 在 `ready` 时原子替换历史并保留乐观消息。
   最后一个订阅者离开时释放上游连接。事件始终不落库。

默认附件与产物下载继续由 `/api/kit/files/:fileId/download` 代理，浏览器不持有 Provider 凭据或
预签名 URL。Kit 协议 v2 要求前后端同步升级（ADR-0006）；SDK 版本交付状态记录在验收记录中。

## YAML 资源批次与管理员调试

Kit 仅提供 YAML 批次的资源创建、校验、Plan 与发布，不提供目录 Project、Build 或源码版本管理（ADR-0018）。
路由按管理员和批次身份绑定独立的 DraftResourceService，ResourceDraftGateway 仅处理本批声明，无物理项目路径参数。
ProviderGateway 不继承目录接口。server-no-directory-sdk 禁止 server 生产源码依赖 SDK 目录与源码版本入口。

当前 YAML、Kit 修订号、SDK state 检查点和成功证明按 draft_id 保存到 SQLite；网络等待期间不持有事务。
SDK 管理 state 语义与资源差异；完整本批资源使用 create-only scope。File/Skill 字节使用独立受控暂存，
MCP 候选只来自当前声明和显式填写、导入的官方配置，不扫描历史主项目。
声明和 state 均为空时仅生成 SDK 只读空计划，不刷新远端；前端直接进入预览且保留空批次。
空声明仍有 state 时拒绝规划，空批次不能执行发布，不产生成功回执。

Provider 凭据由部署配置解析后显式注入 SDK 运行时；Vault 值仅存批次独立内存 Map。
Kit 在配置副本的 Vault 密钥字段中解析随机引用；SDK 关闭全局环境变量展开，提示词与初始化正文按字面值处理。
运行链路不写 process.env；YAML、state、回执及日志不保存明文凭据。重启后未发布值须重新输入；
已完整成功后的收尾只读取 state 与成功证明，不重新解析已发布密钥。

Plan 绑定主体、批次、修订号、YAML/上传内容哈希与 SDK 计划；显式确认后再次规划核对，执行同一计划。
SDK 仅在 Kit 显式选择 `resultDetail: "structured"` 时返回语义指纹、逐资源身份与安全错误合同。
SDK 默认模式保持原返回结构与异常语义，Bailian CLI 不接入此新模式。
Gateway 以白名单将结果投影成 Kit PublicationReport，Operation 在成功证明/回执/清理之前保存终态报告；
StateBackend 边界失败也保留已取得结果。服务与 UI 不识别 SDK 异常或解析 Provider 文案。
报告是执行事实，完整成功证明和批次恢复阶段仍归 Kit 控制；`retryable` 不触发写重试。
完整成功后先写成功证明，再验证六类绑定、保存最小回执，最后清理声明、state、证明和上传暂存。
部分成功、未知结果或重启中断保留现场，禁止自动重发；清理失败只重试收尾。
退出使用批次清理凭证、阶段检查、在途请求等待与互斥保护，不能因另一浏览器打开页面而丢弃已有内容。

追加迁移将旧 directory 批次原记录、回执和关联文档原样存入 kit_retired_directory_drafts，
从活动集合移除并释放管理员名额。原磁盘项目、state 与成功证明文件保留，不自动读取、转换、清理或调用远端。

管理员调试通过远端 Agent ID/版本和运行时引用创建 admin_debug Session，不需要项目声明或 Catalog。
已有项目来源的 Session 保留元数据并可继续通过 Session ID 读取和操作，不再支持按项目声明创建或枚举。
调试继续复用 SessionService、共享 SSE pump、审批和文件服务，保留用途、主体隔离及 Provider 就绪检查。

## 自建百炼后端接入

`ChatProvider` 是前端到业务后端的适配合同（ADR-0007），不是多服务商抽象。上游仍为
百炼 Managed Agent。Controller 接收 SDK `SessionEvent`，组件消费转换后的 `ChatMessage`。

```text
Kit Server → KitClient → createKitChatProvider ──────────────────────┐
                                                                  │
自建后端 → 原始 SSE → kit-sdk/providers/bailian → SDK session-events 转换 ─────┤
                                                                  ↓
                            ChatProvider → Controller/Store → useChat → UI
                              转换策略        调用并持有消息     ChatMessage
```

- `createKitChatProvider(client)` 转发既有 Client 的五项会话能力，保持请求路径、Kit 控制帧
  与游标行为。KitClient 也结构兼容此合同，既有 Controller 调用无需迁移。
- 两个 Provider 工厂显式使用 `transformSessionEvent` 作为 `transformMessage`。该纯转换将
  `SessionEvent` 整理成消息与 Artifact，位于 `messages/`，不调用 SDK 运行时。
  自定义 Provider 可覆盖规则；省略时由 Chat 使用相同默认规则，保留旧五方法调用行为。
- `createBailianChatProvider` 接收 RequestClient 与 `openStream`、`listEvents`、
  `sendMessage`、`interrupt`、`toolApprovals`、`submitToolApproval` 六项操作配置。
  `buildRequest` 构造地址和参数，`mapResponse` 映射响应；Provider 统一执行请求，
  管理解帧、历史分页、就绪屏障、资源清理与 SDK 纯转换。应用鉴权在 Request 中配置。
- SDK 的 `createBailianSessionEventNormalizer` 维护百炼原始事件的累计转换。Kit 不复制
  内部累加器，不加载 SDK Node 主入口；完整正文路径显式关闭脱敏与截断，不改变 SDK 默认值。
  `SessionEvent` 类型也从同一浏览器子入口引用，纯浏览器类型检查无需加载 Node 声明。
- Chat 持有最新事件 ledger，按线程从当前快照重建临时消息列表，并逐事件调用 Provider 的
  `transformMessage({ messages, event, identity })`；返回的消息由 Chat 持有。转换不修改原始
  事件、不维护跨调用缓存，保留稳定消息和分片身份，支持同 ID 替换、清空及产物撤回。
- Controller 统一安排订阅重试，保持乐观消息、快照替换、执行状态及审批编排。适配器每次
  只处理一次连接，不另开重试循环、不重发消息和审批。
- `useChat({ sessionId, provider })` 可以脱离 `KitProvider`。显式实例优先于 Context；
  实例与会话稳定时保持连接，切换或卸载释放旧订阅并隔离迟到回调。
- 自建后端负责会话权限、实际发送与审批校验、历史完整性及真实上游订阅就绪保证。
  Session 创建与列表、文件上传下载由调用方后端管理，不进入 ChatProvider 五方法合同。

原始模式在初连与重连时均完整重建历史，没有 Kit 传输游标。没有分片水位的 `in_progress`
历史不能作为后续增量正文的追加基线；SDK 保留可确认展示并等待权威完整快照。订阅、历史与
实时缓冲合并完成后才开放 ready，不能把 HTTP 200 或首条业务消息当作通用就绪保证。
同 ID 历史/缓冲冲突缺少版本证据、或仍有未解析消息身份的孤立内容分片时拒绝 ready，
不假定会话空闲。详细恢复合同见 `docs/protocol.md`。

## 浏览器与自定义宿主接入

- 默认应用启动时读 `GET /api/config` 得到 `apiBaseUrl` 与能力开关；**禁止假设同源**。
  自建后端模式通过调用方运行时配置明确提供接口基地址，同样不假设与页面同源。
- `resolveApiBaseUrl` 优先级：`window.__OPENAGENTPACK_KIT__.apiBaseUrl`（宿主注入） >
  显式地址（默认应用来自 `?api=`） > `/api/config` 返回的 `apiBaseUrl` >
  `location.origin`。origin 仅作无其他地址时的引导兜底，不能覆盖明确的跨源配置。
- 管理端令牌按规范化后的完整 `apiBaseUrl`（含路径前缀）隔离保存；改变地址不继承其他
  后端的令牌。无目标的旧版令牌只允许迁移到当前 Console origin 的根后端；跨域或其他
  路径须在显示目标地址的登录表单中重新输入。公开配置探针始终不携带管理员令牌。
- 体验页先公开读取配置，再按最终 `apiBaseUrl`（含路径前缀）从 sessionStorage 恢复成员令牌。
  SDK `auth/member-auth` 管理登录、恢复、撤销与固定身份 Client；React 的
  `useMemberAuth` 绑定生命周期，页面仅在认证完成后挂载 `KitProvider`。退出、过期或 401
  取消旧 Client 的 HTTP/SSE，按 generation 重建整棵业务页面，清理会话、草稿和附件。
  等待响应头和读取正文都受身份取消信号保护；自定义 fetch 忽略 signal 时也结束旧请求，
  并取消迟到响应的正文，不额外增加请求超时或重试。
  恢复或撤销遇到网络错误时显示重试，不回落为匿名，不向另一后端转发旧令牌。
- 体验页的 `src/lib/host.ts` 读取注入的宿主能力；能力缺失时回退浏览器实现。
  主题偏好优先采用宿主注入值，为 null 时继续读取浏览器暗色偏好；文件下载优先调用宿主
  `saveFile`，不支持时统一走 `saveBlobInBrowser`，不在业务组件重写对象 URL 下载逻辑。

## 安全边界

管理端「成员管理」通过独立 `members` 路由 → service → store 创建本地账号，不经
ProviderGateway，不改变 SDK 或 ChatProvider 合同。成员列表只读取公开资料；
自动生成密码仅随创建响应返回一次（`Cache-Control: no-store`），不进入列表、审计或浏览器
持久存储。自定义密码不回传。体验页默认使用本地成员登录，详见 ADR-0010 与 ADR-0011。
密码验证和登录令牌签发在服务端执行；SQLite 存令牌哈希和有效期，每次请求校验。
独立登录之间分别撤销；退出或到期终止对应的已建立 SSE，不中断 Provider 的 Agent 执行。

| 边界 | 措施 |
| --- | --- |
| 凭据 | 只在 Kit Server 或自建后端的 env / 密钥管理；不进库、不下发、不入日志（脱敏过滤器） |
| 终端用户 | 默认成员登录，`IdentityProvider` → 稳定 `member_id`；会话与用量按 subjectId 过滤；匿名须显式开启 |
| 管理端 | `ADMIN_TOKEN` + `KIT_ADMIN_TOKENS`（`admin` 可写 / `auditor` 只读，中间件强制）；审计主体是令牌指纹；企业 RBAC/BUC 留后续 |
| 成员目录 | `admin` 创建、`auditor` 只读；用户名大小写不敏感唯一；密码只存加盐派生值，普通成员不会获得管理端权限 |
| 流量与体积 | 按 subject 令牌桶限流（429 + `retry-after`）；JSON 与上传分别有请求体上限（413） |
| 观测 | `GET /api/admin/metrics`（Prometheus 文本）；label 只用路由模板/方法/状态码 |
| 跨域 | `KIT_CORS_ORIGINS` 白名单，支持 loopback 端口通配（`http://127.0.0.1:*`，默认已含）；通配对非 loopback 域名一律忽略 |
| 文件 | 上传记录 subjectId；历史挂载索引只迁移唯一 subject 的归属，歧义拒绝且不覆盖已有上传记录；下载验证归属或本人 Session 的 Provider Artifact；不下发预签名 URL |
| 破坏性动作 | plan → 一次性确认令牌 → 执行；缺令牌 409/400 拒绝 |

## 上游恢复能力边界

本节描述默认 Kit Server → SDK 的网络接口；自建后端原始流的恢复由上述 ChatProvider 链路负责。

Kit 的 ready 闸门保证首次上游订阅和历史合并完成后再提交。当前 SDK 只有成功连接的
`onReady`，没有公开的断链状态回调，因此 SDK 内部短暂退避期间 Kit 无法可靠阻止所有新 POST；
恢复后由 SDK 历史补拉收敛，业务 POST 不自动重发。若需要严格禁止这段时间的提交，须先扩展
SDK 公开连接状态，本轮不读取 internal 实现。

SDK 恢复时避免把无分片水位的 in_progress 历史与新 delta 直接相加；中间文本可能暂时被
当前连接的局部快照替换，最终以 completed 全量快照收敛，不承诺断流期间逐字无损连续。
