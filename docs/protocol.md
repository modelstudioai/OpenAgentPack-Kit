# 协议

自研协议的范围是**传输帧、游标与重连、去重与乐观消息、错误模型、确认令牌**；事件语义
不重造，直接采用上游 `@openagentpack/sdk` 的 `SessionEvent` 契约（见
[ADR-0001](./adr/0001-self-designed-protocol.md)）。

## 为什么不用 EventSource

体验页需要携带 `Authorization`（成员令牌或可信 JWT）、需要在同一连接语义下做 POST 与中断、需要
自己控制重连节奏；`EventSource` 三者都做不到。因此统一使用 `fetch` + `ReadableStream`
读取 SSE 文本流，由 `@openagentpack/kit-sdk/protocol` 的 `createSseParser()` 解析。

## 帧与连接（协议 2.0）

默认数据面要求登录，成员身份使用 `Authorization: Bearer <Kit 登录令牌>`，不放在 URL。
登录 / 恢复 / 退出的 HTTP 合同见 `docs/interfaces.md`。退出或令牌到期后，已建立的成员
SSE 发出 `error`（`code: unauthorized`、`retryable: false`）并关闭；客户端清理该身份的
状态并重新登录，不按断流恢复重连。仅关闭订阅不会向 Provider 发送 interrupt。
客户端暂停读取造成背压时，服务端最多等待 250ms 写出认证错误，之后强制释放连接与
上游订阅；不能以保证错误帧送达为由无限保留已撤销的连接。

本节定义 Kit Server 的默认 wire protocol。自建后端原始流无需发送这些控制帧，接入规则见
下文「自建百炼后端的 ChatProvider 合同」。

事件正文始终是 SDK 的 `SessionEvent`，Kit 只扩展传输控制。业务帧使用标准 SSE `id:`
携带不透明的 `epoch:sequence` 游标；它不同于业务 `event_id`，同一业务事件的快照可以更新多次。

| 帧 type | data 形状 | 语义 |
| --- | --- | --- |
| `reset` | `{ session_id }` | 游标不可续传，开始重建 Provider 事件集合；保留本地乐观消息 |
| `event` | `SessionEvent` | 最新累计快照；SSE `id` 是本次传输游标 |
| `ready` | `{ session_id, after, replayed, cursor }` | 上游已连接、历史及缓冲事件已回放；允许发送 |
| `done` | `{ session_id, status, last_event_id, reason, cursor? }` | 流正常关闭；不替代业务事件的完成状态 |
| `error` | `{ code, message, retryable }` | 明确的流错误；按 retryable 决定重连 |
| `ping` | `{ t }` | 每 15s 保活；客户端 45s 无有效帧视为静默断流 |
| `operation` | `{ operation_id, phase, progress, message? }` | 控制面 Operation 进度 |

`reset/ready/done/error/ping/operation` 不是业务事件，不进入消息归并。
重建采用 `reset → 历史 event → 缓冲 event → ready → 实时 event`，客户端在 ready 原子切换
Provider 事件集合。普通 Turn 结束和等待工具批准都保留连接；会话切换/卸载取消浏览器订阅，
最后一个订阅者离开后释放上游连接。

## 默认 Gateway 与历史恢复

- 百炼历史显式使用 `event_format: "snapshot"`；流订阅 `event_deltas: ["message", "reasoning"]`。
  SDK 已合并内容分片，Kit 不重新解析 `raw`，也不再次追加累计正文。
- 百炼实时流可混合 `event_start.event`、`event_delta.event_id` 与完整业务快照。SDK 统一
  提取业务身份，将 `reasoning_delta.reasoning` 和 `content_delta.content` 累计为现有
  `SessionEvent`；这些封装类型不直接进入聊天展示。完整消息快照覆盖累计正文，独立的
  `session_status` 决定会话阶段；单条消息完成不能代替会话 idle。
- 完整正文调用 sanitizer 时传 `{ redact: false, truncate: false }`，不传 `includeRaw`；
  Provider 凭据、请求头和 SDK context 不进入响应，错误与日志仍脱敏。
- 每个 Session 共用一个上游 pump：先建立连接并缓冲实时事件，再按升序读完历史分页，
  合并后开放 ready。分页使用不透明 `page_token/next_page_token`，重复页游标明确失败。
  HTTP 历史与 SSE 的到达先后不代表快照的新旧；同 ID 重叠只接受相同快照或可证明的
  `in_progress → completed` 推进，丢弃迟到的 `in_progress` 降级。没有版本证据的冲突
  必须在 ready 前明确失败，不能用缓冲帧无条件覆盖历史。
- 用户消息及工具审批先等待 pump ready，再 POST 一次。SDK 的 `sendRemoteSessionEvents`
  是通用发送入口，本身不负责等待订阅就绪。
- server 内存保存最新事件索引和有界变更日志；事件正文不落 SQLite。浏览器 `after` 只用于
  Kit 传输日志，不作为百炼原生游标。日志被淘汰、epoch 变化或旧游标不可识别时发送 reset。

## 快照归并与 Turn

- 按 `event_id` 更新原事件槽位：相同快照幂等，不同快照替换；保留事件原顺序。
  已完成事件不被迟到的 `in_progress` 降级。没有 Provider ID 的事件以传输身份区分。
- 字段缺失保留已有值；显式空字符串、`content: []` 和 `metadata.artifacts: []` 清除对应展示。
  Chat 从最新事件索引按线程重建消息，逐事件调用 Provider 的 `transformMessage` 策略。
  默认 `transformSessionEvent` 保留稳定分片 ID 以保护折叠状态，只合并相邻同类文本。
- `metadata.event_status` 表示单条消息生命周期；`metadata.status`/`content[].data.session_status`
  表示会话状态。`idle + requires_action` 是等待批准，不是正常完成；子线程 idle 不结束主 Turn。
- 目录运行态由完整事件账本与受理中的 pending turn 共同推导。发送受理时只记录
  `client_message_id`、Provider 回执事件 ID 和发送前状态标记，不保存消息正文；pending turn 在
  本轮用户回显与主会话终态形成匹配证据前保持 running。历史或重放中的旧 idle 不得清除它。
  没有上游泵的存量 running 在列表兜底对账时，不能仅凭详情 idle 判定完成，必须核对历史投影。
- 工具调用/结果按线程与 `call_id` 关联，同名并发不能按名称误配。参数与输出保留字符串或对象。
- Artifact 优先取 SDK 派生的 `metadata.artifacts[]`，单数 `artifact` 仅作兼容。SDK 从已识别的
  `mark_artifacts` 工具结果提取文件；该数组不是 Provider 原生 SSE 字段。
- 未知事件和内容块保留，通过安全文本/JSON 兜底展示，不执行 HTML 或自动加载未知资源。
- 乐观消息独立于 Provider 索引，按 `client_message_id`/POST 返回事件 ID 对账；reset 保留本地
  pending/failed，切会话后的旧回调被 generation 隔离。连接断开不伪造完成、不自动重新发送。
  重建继承已知身份的首次位置和相同快照的原观察次序；旧 idle 不能因回放获得新位置而
  解锁尚未回显的发送。真实回显及本轮完成状态仍可在恢复后结束 Turn。

## 默认链路的重连与取消

SDK 负责 server→Provider 连接恢复；controller 负责浏览器→Kit Server 连接恢复。
后者沿用指数退避（500ms 起、最大 15s、8 次、±20% jitter），携带最后成功消费的传输游标。

| 情况 | 处理 |
| --- | --- |
| 网络错误 / 意外 EOF / 静默超时 / 可重试流错误 | 带 after 退避重连；不重发用户消息或审批 |
| 401/403、协议版本冲突、不可重试 Provider 错误 | 停止自动重试，提示具体原因 |
| reset | 原子重建 Provider 事件集合，保留乐观 overlay |
| done | 关闭传输，不把未完成消息直接标为完成 |
| 主动 abort / 会话切换 | 释放 reader、定时器和上游订阅，不重连、不交付已取消的缓冲帧 |

## 自建百炼后端的 ChatProvider 合同

体验页使用公开 `createSessionEventChatProvider` 和显式 `useChat({ sessionId, provider })`，
Kit Server 是标准事件示例后端。订阅采用本文相同的控制帧：后端先完成历史与实时对账，再发
`ready`；客户端通过 `after` 配置传递不透明变更游标。工厂不内置 URL、鉴权或版本头，
这些由示例配置提供；无有效帧超时和自然断流继续报可恢复错误。
同一工厂可配置自建后端的路径、HTTP 方法、JSON 包装与线程页顺序。原始百炼 SSE 仍走
`createBailianChatProvider`；二者交付同一 `SessionEvent`，不重复转换标准事件。
标准事件工厂默认等待 `ready` 最多 30 秒，45 秒无有效帧中断；配置只能取正整数。

`ChatProvider` 复用五个会话方法：`stream`、`sendMessage`、`interrupt`、`toolApprovals`、
`submitToolApproval`。参数与返回值沿用 SDK Client 的公开类型，五项均必需。
显式 Provider 仅替换该 `useChat` 的后端接入；Kit Server HTTP 协议、默认方法和默认值不变。

可选 `listThreads(sessionId, { limit?, pageToken?, signal? })` 返回线程摘要分页，
`listThreadEvents(sessionId, threadId, options)` 返回 `EventsPage`。两者统一使用
`next_page_token`；Provider 的事件页在页内按时间升序，下一页表示更早历史。
默认 Kit Client 与百炼标准操作预设负责将 HTTP 的最新在前顺序反转；Controller 不猜测时间排序。
未实现查询的旧 Provider 仍可显示 SSE 已知子线程，`historyAvailable=false`，不显示无效分页入口。

### 主子 Agent 与补充历史

- `metadata.thread_id` 是事件归属；只有 `sthr_*` 属于子 Agent，`thrd_*` 留在主 Agent。
  缺失时兼容 `metadata.session_thread_id`；`to_session_thread_id`、`from_session_thread_id`
  以及转交事件数据中的引用只用于发现子线程，不改变消息归属。
- `session_status` 始终是会话状态；`thread_status` 只更新对应子 Agent。子线程 idle、分页
  返回的旧状态、线程选择与历史加载都不能改变主 Turn、审批或 Session SSE 的 `after` 游标。
- `ready` 后查询线程列表，实时事件也可发现新线程。首次选择加载最新一页，加载更多向前
  合并；再次选择刷新最新页并保留已加载的旧页。每个 Thread 独立保存 loading/error/cursor。
- 补充历史与实时事件按 `event_id` 合并完整快照；请求期间到达的实时更新优先，completed
  不回退。历史加载不调用主 Store 的 `applyEvent`，不改变乐观消息或审批覆盖状态。
- Session/Provider 切换与卸载取消查询，代次检查丢弃迟到结果；Session SSE reset 使补充
  历史失效并在 ready 后重新加载，防止已撤回事件复活。切换线程不重新建立 Session SSE。
- `useChat().multiAgent` 是共享展示与动作合同；`Chat` 原生呈现页签与只读子 Agent 历史。
  主输入、草稿、附件及审批保留，子页仍提供返回主 Agent 和停止整轮执行的入口。

Provider 还可提供 `transformMessage({ messages, event, identity })`，返回
`{ messages, artifacts? }`。这是浏览器内的展示转换策略，不是新增后端操作或 SSE 字段。
`messages` 是当前线程在本次重建中的临时消息数组，可修改或返回替代数组；`identity` 来自
Chat 的稳定事件身份。策略不修改事件、不缓存跨调用消息，必须保留稳定消息及分片 ID。
Chat 持有返回结果、事件账本、执行与审批状态；改变展示不能绕开发送或审批约束。
两个内置工厂均使用 `transformSessionEvent`；旧 Provider 省略此项时采用同一默认规则。

`stream` 负责一次订阅，接受 `AbortSignal`，通过 `onReset/onEvent/onReady/onDone/onPing`
通知 Controller。`onEvent` 必须提供 SDK `SessionEvent`；生命周期通知不等于自建后端必须
发送同名 SSE 帧。`onReady` 只表示历史与实时重建完成，`canSend` 还受执行与审批状态约束。
订阅重试由 Controller 调度，Provider 不应嵌套自动重连或重发写操作。

### 原始流接入与最小后端合同

`createBailianChatProvider` 接受一个 `RequestClient` 与以下六项操作配置，生成五方法 Provider。
每项操作由 `buildRequest(input, context)` 返回 `{ path, init? }`，由
`mapResponse(response, { input, signal })` 返回业务结果；HTTP 统一通过 Request 执行。
旧自由请求回调配置已迁移，见 ADR-0008。

| 操作 | 输入与必需结果 |
| --- | --- |
| `openStream` | 输入 `{ sessionId }`；映射返回 `{ response: Response, ready: Promise<void> }`，body 为百炼原始 SSE，ready 代表真实上游订阅已建立 |
| `listEvents` | 输入 `{ sessionId, pageToken? }`；返回 `{ events: Record<string, unknown>[], nextPageToken?: string \| null }`，原始历史完整升序，分页游标不透明 |
| `sendMessage` | 输入 `{ sessionId, body }`；返回真实 `session_id/accepted/event_ids`，保留乐观消息身份 |
| `interrupt` | 输入 `{ sessionId }`；返回实际中断受理结果，不伪造执行已结束 |
| `toolApprovals` | 输入 `{ sessionId }`；返回最新 `requires_action`、batch/call 身份及完整请求参数 |
| `submitToolApproval` | 输入 `{ sessionId, decision }`；返回正式 allow/deny 的受理结果，后端再次校验权限与待办 |
| `listThreads`（可选） | 输入 `{ sessionId, limit?, pageToken? }`；返回 `SessionThreadsResponse` |
| `listThreadEvents`（可选） | 输入 `{ sessionId, threadId, limit?, pageToken? }`；返回完整原始快照页，页内升序，下一页为更早历史 |

操作配置不规定固定 URL 或响应包装，不增加 `docs/interfaces.md` 中的 Kit Server op。
创建 Session、会话列表和文件仍使用调用方后端。URL 来自明确运行时配置；Request 的动态
headers 只提供应用身份，百炼凭据保留在后端。原始适配器只提交一次写请求，不自动重试。

`createBailianThreadOperations({ basePath? })` 预置百炼标准
`GET /api/v1/agentstudio/sessions/:sessionId/threads` 与
`GET /api/v1/agentstudio/sessions/:sessionId/threads/:threadId/events`，使用 `limit/page`，
并映射 `{ data, next_page }`；调用方可更换代理前缀或覆盖操作的请求/响应映射。
此预设仅包含两项线程查询，不声称自动解决自建后端的订阅 ready 或应用身份认证。
每次线程历史查询创建独立 SDK normalizer，只接受完整快照页，不要求主会话状态事件，
也不触碰活动 SSE 的累计分片状态。没有独立线程 SSE、创建/归档线程或子线程输入能力。

Provider 将同一取消信号用于构造、鉴权、请求和响应映射；`init` 不允许覆盖 `signal`。
`openStream.mapResponse` 必须返回仍可读取的 body 和独立 ready Promise，不读取 body，
也不先等待 ready。连接超时覆盖上述步骤、就绪和完整历史；迟到响应仍关闭，取消后停止交付。

原始 SSE 经通用 parser 解帧，不能传给只认识 Kit 控制帧的 `decodeFrame`。UTF-8 跨块、
CR/LF/CRLF、多行 `data`、注释心跳与业务 JSON 分别处理，业务对象交 SDK
`createBailianSessionEventNormalizer` 累计转换。正确的未知事件保留；非法 JSON、关联字段
缺失及无法支持的恢复合同明确失败。SDK 仍默认脱敏、截断；Kit 完整事件路径显式传入
`{ redact: false, truncate: false }`，不输出 `raw`，错误只使用安全摘要。

### 就绪与历史交叉

1. 打开流并立即读取、缓冲实时事件；同时等待上游就绪信号。
2. 确认上游就绪后发 `onReset`，以升序读完历史分页。
3. 通过 SDK 合并历史和缓冲流，保护已完成快照，核对当前会话状态与审批身份。
4. 发 `onReady`，store 原子替换 Provider 事件并保留本地乐观消息，之后继续交付实时更新。

空闲会话也必须能完成此流程；不能等第一条业务消息才宣布 ready。
代理 HTTP 200 只有在后端明确保证「上游订阅建立后才发送响应头」时才可作为就绪依据。
也可提供独立握手信号；该信号由接入方实现，Kit 不猜测后端已就绪。
就绪等待、历史和 reader 任一失败都取消本次尝试，不能先允许发送再修补历史。

相同 `event_id` 允许快照更新，不能只按 ID 丢帧。历史和实时交叉到达时以事件身份、
完成状态及可验证顺序决定有效快照；不能让较早的缓冲业务状态覆盖较新的历史状态。
同一实时连接中已缓冲事件的到达顺序是已知的，不因两个新身份的 `created_at` 相同而拒绝；
同 ID 状态更新也要保留更新发生的顺序，不能只覆盖首次出现的位置后丢掉后续状态变化。
消息的展示位置仍按首次出现固定。历史与实时之间无法验证的先后关系继续明确失败。
对于历史中不存在的新消息或推理，先在首次观察位置合并缓冲的同 ID 累计快照，再判断与
历史的顺序；`event_start` 缺少的 `created_at` 可由同 ID 后续快照补齐，已提供的创建时间
保持首次定位依据，不随后续快照移动消息。不会保留每条增量
对应的累计全文副本，也不会将会话状态更新折叠到首次观察位置。若同 ID 的全部快照仍缺少
定位时间，不能借用相邻事件或本地时间；非空历史恢复继续拒绝 ready。
重建期间，同 ID 的历史与缓冲快照发生冲突，又没有版本证据或明确的进行中到完成转换时，
必须拒绝本次恢复；`created_at` 只是创建时间，不能作为同 ID 更新的版本号。
仍未匹配到消息身份的孤立 `object: "content"` 不能被当作空历史而忽略：旧内容帧通过
`msg_id` 关联，`event_delta` 通过 `event_id` 关联；关联未解决时拒绝 ready。缺少足以判断
当前会话状态的证据时同样报告恢复错误，不能默认推断 idle。

### 重建、错误与清理

- 首版每次连接完整重读历史，不向百炼传递 Kit `after`，不把 SSE `id` 或业务 `event_id`
  当作逐帧回放游标。默认 Kit 模式仍使用原有 `after` 续传。重建成本随历史增长。
- `in_progress` 历史没有分片水位：保留可确定的展示、身份与执行状态，不将正文作为新 delta
  的追加基线。恢复等待权威完整快照，不能承诺断流期间逐字连续；迟到进行中帧不能降级完成快照。
- 历史分页、就绪等待、实时静默、单帧与缓冲队列都有有限边界。达到上限或分页循环时失败，
  不截断历史、不丢帧后继续宣布 ready。每次订阅独立保存转换与缓冲状态。
- HTTP/流内协议错误按 `KitError.retryable` 决定是否重试；401/403 和合同错误停止自动重试。
  原始流自然 EOF 与静默超时均报可重试错误，不合成业务成功。普通 Turn 完成或审批等待
  继续保留订阅；停止受理不等于执行结束。自定义 `ChatProvider` 可通过 `onDone` 通知明确的
  传输结束；原始适配器不臆造百炼的结束标记，也不解释 Kit `done` 或 OpenAI `[DONE]`。
- abort 同时终止 reader、就绪等待、历史查询与排队交付，并清理定时器、缓冲与 SDK 状态。
  切换 Provider/Session 后旧回调不能更新新会话。断流恢复不重发消息、批准或拒绝。

原始适配器可通过以下正整数配置调整边界，不改变默认 Kit transport 的设置：

| 配置 | 默认值 |
| --- | --- |
| `connectTimeoutMs`（握手与完整重建总时限） | 30000 |
| `idleTimeoutMs`（无有效帧或心跳） | 45000 |
| `maxBufferedFrames`（实时缓冲数量） | 1024 |
| `maxBufferedBytes`（实时缓冲字节） | 8 MiB |
| `maxHistoryEvents`（单次完整重建事件数） | 10000 |

## 工具审批

`tool_approval_request.content[].data` 中的 `batch_id + call_id` 标识一次请求，包含工具名、
冻结参数、`tool_type: builtin|mcp` 及可选 `server_label`。当前有效集合由最新主会话
`session_status.content[].data.stop_reason` 的 `requires_action/pending_batch_id/pending_call_ids`
决定，不能用历史请求独自激活批准按钮。信息不完整时仍阻止普通发送。

- 查询：`GET /api/kit/sessions/:id/tool-approvals` 返回当前集合及请求详情。
- 决策：同路径 `POST { batch_id, call_id, result: "allow"|"deny", deny_message? }`，一次一个调用。
  拒绝原因可选且最多 200 字符，这是 Kit 产品限制，不是 Provider 上限。
- 服务端校验归属、最新 pending、匹配请求和已有响应；同一审批串行，过期或已处理返回 409。
  通过 SDK 发 `tool_approval_response`（`role: user`），子线程身份从请求推导。
  审批刷新结合共享缓存已知的状态更新次序、完整历史和查询期间实时变化；历史数组的
  最后位置不能替代同 ID 快照的更新时间。无法判断先后的冲突须拒绝查询与提交，
  不能用旧缓存复活已经撤销的审批。
- 审批卡在消息流内完整展示冻结参数（摘要 + 可展开原文）；允许与拒绝都是一步直提，
  不提供自动批准或参数编辑。提交成功仅表示已提交，后续执行和剩余审批由 Provider 事件确认。
  网络结果不明先查询，不自动重发，再次提交须人工确认。
- 提交前查询若因新事件或重建而失效，本次决定必须拒绝，不能沿用旧缓存发送；用户刷新待办
  并重新确认后才可再次提交。完全相同的重复快照不使查询失效，查询返回的参数变化仍须重新审查。
- 普通 Sender 在 requires_action 时保留草稿并禁发送；审批状态可以刷新，也可请求停止。
  生命周期 apply/destroy/publish 等原有 plan/confirmation 闸门不因此改变。

自建后端由 `ChatProvider.toolApprovals/submitToolApproval` 提供相同语义，地址由调用方决定；
上述 Kit HTTP 路径仅用于默认模式。Controller 提交前刷新与参数比对保护用户审查过程，
不能替代自建后端的身份、归属、当前 batch/call 与重复响应校验。

## 错误模型

统一 `KitError`：`{ code, message, details?, retryable }`，HTTP 与流内共用一套 code。

| code | HTTP | 含义 |
| --- | --- | --- |
| `invalid_request` | 400 / 413 | 参数校验失败（zod 详情在 `details`）；请求体超上限时用 413 |
| `unauthorized` | 401 | 缺身份或令牌无效 |
| `forbidden` | 403 | 身份有效但无权（含访问他人 session） |
| `not_found` | 404 | 资源不存在或不属于当前身份 |
| `conflict` | 409 | 状态冲突（如向已终止会话发消息、附件仍在扫描未就绪 → `retryable: true`） |
| `confirmation_required` | 428 | 破坏性动作缺少有效确认令牌 |
| `quota_exceeded` | 403 | 月度额度耗尽（`details` = `{month, limit, used, remaining, reset_at, metric?}`）；本地成员 metric 为 `tokens` 或 `active_seconds`，无 metric 为兼容 Credits；拒绝不写 Turn 账本，前端保留草稿并提供检查额度入口 |
| `request_pending` | 409 | 已有一条待审批的提额申请，不能重复提交 |
| `rate_limited` | 429 | 触发按 subject 的令牌桶限流；`retryable: true` 且带 `retry-after` 秒数 |
| `provider_error` | 502 | Provider 返回错误（连接与审批使用安全摘要，不透传原始错误正文） |
| `not_implemented` | 501 | 该 op 尚未实现（对照 `docs/interfaces.md` 状态列） |
| `internal` | 500 | 未分类服务端错误 |

## 确认令牌（破坏性动作）

```
POST /api/admin/projects/:name/plan
  body { action: "apply" | "publish" | "destroy" | "restore", version_id? }
  → 200 { data: { plan_id, confirm_token, diff, destructive, expires_at } }
POST /api/admin/projects/:name/apply
  body { plan_id, confirm_token }
  → 202 { data: { operation_id } }  # 缺/伪造/重放令牌 → 428 confirmation_required
```

会话级破坏性动作走同一条闸门（`action: archive | delete`）：

```
POST /api/kit/sessions/:sessionId/plan     body { action }
  → 200 { data: { plan_id, confirm_token, destructive: true, expires_at, diff } }
POST /api/kit/sessions/:sessionId/archive  body { plan_id, confirm_token }
DELETE /api/kit/sessions/:sessionId        body { plan_id, confirm_token }
```

- 字段名一律 snake_case（与 openapi.json 一致）；token 是服务端 HMAC 签名的一次性串，
  绑定 `plan_id + 动作 + subject`，默认 TTL 5 分钟；
- 消费即失效（重放 428）；空/畸形令牌先被 schema 拦下（400 invalid_request）；
  `destructive=false` 的项目 plan 也必须展示 diff 并由用户显式确认后回传；
- **服务端与所有脚本都不得代替用户生成或补全确认**，也不存在 `--yes` 之类的旁路参数。

### 项目审阅与长任务恢复

项目 Plan 在服务端保存项目、管理员主体、动作、审阅源码 revision、Build hash 与计划指纹。
执行前再次读取，并在 SDK 目录锁内核对；修改声明使旧 Plan 失效，远端变化也需要重新生成
计划。Restore 另外绑定目标版本、当前 head 和源码 revision，只恢复源码，不改变远端。
所有确认按钮使用 AlertDialog 展示影响，缺少、伪造和重放令牌不能执行。

模版资源批次通过 `/api/admin/resource-drafts/:name/resources` 使用同一确认与 Operation 合同。
新批次的 Plan 绑定 Kit revision、当前 YAML 哈希、上传内容哈希及 SDK 返回的 `resource-plan-v1:` 语义指纹；
执行前在批次互斥保护下重新规划核对，匹配后执行同一 SDK 计划。前端不调用目录 Build，接口不暴露源码路径或 SDK state。
成功证明与回执先持久化，再清理临时声明和 state；部分成功或重启中断保留现场，禁止自动重发（ADR-0017）。

Apply/Publish/Destroy 受理后立即返回 operation_id，后台执行；Operation SSE 每次连接先
返回当前完整快照，再推送阶段、脱敏日志、结果与终态 done。客户端从持久的 ID 恢复观察；
自然 EOF/45 秒静默超时重连观察流（500ms 起、最大 15 秒、8 次、±20%），不重发写请求。
迟到的初始 GET 不能覆盖较新 SSE。服务重启后 pending/running 标为 failed/interrupted，
提示远端结果待核对，不自动重跑。

发布 Operation 额外提供可选 `publication` 与 `error_details`，HTTP GET 与 SSE 使用同一快照合同；
旧记录缺字段时仍按原 `status/result/error` 读取，不推断历史执行结果。
`publication.outcome` 为 `succeeded | failed | partial | unknown`，`mutation_started` 表示是否已调用 Provider 写方法。
逐资源结果只含类型、逻辑键、`succeeded | failed | skipped | unknown`、已知 `remote_id/version` 与安全错误信息。
`error_details` 只含 `code/phase/retryable/mutation_started/http_status?`；不传 SDK 原异常、错误字符串、原响应、Plan 或 state。
`retryable` 表示临时性错误，不授权重发写操作。SDK 已开始写入后异常保守标为 unknown。
SDK 完成后 StateBackend 最终保存失败仍保留已知结果；绑定、成功证明、回执和清理失败各自标记阶段。
执行报告成功不能替代完整成功证明，不能据此自动生成回执或跳过收尾校验。
多步创建失败时，报告保留 Provider 已返回的父资源身份（例如 Vault 已创建、Credential 创建失败），
但未完成的资源不写成已收敛的 SDK State；删除完成后也保留此前已知的资源身份供核对。

批次 `recovery_action` 由服务端持久阶段与成功证明决定：`replan` 允许重新准备并显式确认，
`read_result` 只允许读取核对，`finalize` 只补回执/清理，`none` 表示已完成。
管理端保留终态资源结果，按该字段展示操作；部分成功、未知结果与中断不开放重新发布。
恢复时独立读取 Operation 明细，读取失败或迟迟未返回只影响展示，不阻塞服务端允许的动作；
迟到的旧报告不能覆盖新一次发布结果。`finalize` 返回 409 时保留服务端错误与收尾入口，
不得回退到 Plan；仅未提供 `recovery_action` 的旧响应沿用原 409 兼容分支。

管理员调试沿用同一 Kit v2 SessionEvent、共享 pump、ready 屏障、历史/实时去重与 after
游标恢复，仅入口改为 `/api/admin/debug/sessions/:id/*`。普通 Turn 结束仍保持连接；审批、
消息发送不会因重连重发。会话和文件的 admin_debug 用途及管理员主体在每次访问时检查。

## 成员会话删除与用量保留

以下额外保护只针对真实本地成员的 `purpose=experience` 会话。匿名 / 外部 JWT 的体验
会话与管理员调试不进入成员用量统计。所有删除继续执行原有 plan → 展示影响 → 用户显式
确认流程，不能由客户端自动代填确认令牌。

1. 确认后取得当前会话的删除互斥，拒绝新的消息、审批恢复、手动中断或归档等冲突写入，等待
   已受理的写请求结束；其他会话不受影响。
2. 查询 Provider 状态。`running`、`rescheduling` 或 `idle + requires_action` 尚未结束，
   发出 interrupt 后轮询确认。详情没有 `stop_reason` 时，还要核对分页历史中的主会话状态。
   主会话历史仍为 running 时，不能仅凭详情 idle 或无需审批认定结束。中断请求成功、
   单条消息完成或 SSE 断开，都不能代替执行结束确认。
3. 确认停止后重新读取详情，获取 Provider **当次返回的最新累计值**。输入、输出 token
   必须存在且有效；缓存与时长缺失可保留为部分统计，不补零。将该快照在 SQLite 中成功
   提交并封存，拒绝迟到后台采集覆盖，然后才发送远端 DELETE。
4. 删除成功后事务保存已删除标记并移除正常会话索引，保留成员归属、Agent 与数值快照，
   继续参与成员累计统计。删除前的会话内容不会因此被 Kit 留存。

停止确认、详情获取或快照保存失败均不发 DELETE，返回可重试的 `409 conflict`。
错误的 `details.stage` 区分 `stop`、`capture`、`delete`、`finalize`；
`execution_stopped` 明确执行是否已停止，防止用户把「删除失败」误认为任务仍在继续。
已停止但保存失败时，应提示「执行已停止，会话未删除，请重试」，不得自动恢复执行。

默认停止与删除协调总超时为 30 秒，状态轮询间隔 500 毫秒。已发出 DELETE 后的网络错误
可能代表远端已经删除或仍在执行。连接重置、SDK 网络异常与本地超时都按结果不明处理；
随后 GET 仍能查到会话也不能证明 DELETE 未被受理，不能据此解封快照或恢复写入。
明确 404 且存在封存快照时可以完成本地收尾，其他读取错误不能当 404。
超时或无法确认结果时，返回 `deletion_uncertain=true`，保留快照、删除阶段及写入
保护。用户重新取得计划并显式确认重试后先核对状态；进程重启也不能丢失这项保护或重放
旧确认操作。重试必须获取新计划并再次确认；确认令牌的进程内消费记录仍遵循单实例约束。
远端已删但本地标记失败时同样保留快照，提示本地状态待恢复。从 `deleting` / `uncertain`
恢复后，重新采集快照不能将持久阶段退回 `captured`；后续数据库写失败或进程退出，也须
保留此前已发出 DELETE 的事实，以便再次确认时根据 404 和封存快照完成本地收尾。

发出中断后采用保守的写保护策略：停止确认、后续采集或保存失败都保留保护，直到用户显式
确认的删除流程完成。原执行可能自然结束，重试查到 idle 不能证明旧 interrupt 请求已经
结束，因此不能在后续失败时解锁；重启恢复同样不能丢失这项保护。尚未发出任何中断或
删除、也没有遗留保护的普通采集失败可释放本次锁。审批历史等待超时会取消本地等待并释放订阅。

该流程保证发出 DELETE 之前已有有效的持久化用量快照；尚未验证 Provider 的统计写入与
停止状态具有事务一致性，因此不将快照称为最终账单结算。上线前已删除且没有记录的
会话无法补算；管理员在 Kit 之外删除远端会话也可能使最后用量无法采集。

## 附件与文件挂载

```
POST /api/kit/files                       multipart 字段 file → 201 { data: { file_id, filename, size } }
POST /api/kit/sessions                    body { agent_slug, files: [{ file_id, filename?, mount_path? }] }
                                          → 201 { data: { session_id, …, files: [{ file_id, mount_path }] } }
POST /api/kit/sessions/:id/messages       body { text, attachments?: [{ file_id, filename?, mount_path? }] }
                                          → 202 { data: { session_id, accepted, event_ids } }
```

- 挂载入口只有**运行时挂载**（端点实测 2026-11-02、沙箱物化判定 2026-11-03，矩阵见
  `docs/research/bailian-session-file-mount.md`）：
  - **新建会话**：客户端把附件放进 `POST /api/kit/sessions` 的 `files`；服务端建会话后立即经
    SDK 公开 API `mountRemoteSessionResource`（provider `POST /sessions/:id/resources`，
    `type: "file"`）逐个挂进 sandbox 再返回 201。挂载失败视为建会话失败：回滚已挂载资源并
    删除刚建的 provider 会话；
  - **已有会话随消息**：`messages.attachments` 非空时，服务端先挂载再发送；**发送失败自动
    卸载回滚**。管理员调试会话不开放随消息挂载（仍 400）；
  - 为什么不走创建时挂载：`POST /sessions { resources: [{ type: "file_resource", … }] }`
    返回 200 且 `GET /sessions/:id` 在 `resources` 里回显绑定，但**沙箱不物化**（agent bash
    报 `No such file or directory`）——比拒绝更隐蔽；SDK 0.8 发的 `type: "file"` 被判
    `400 Invalid resource`，顶层 `files: [...]` 也是假成功（200 但不挂载）。创建载荷对文件
    只有陷阱没有正路，`GatewayCreateSessionInput` 刻意没有 `files`；gateway 的
    `src/gateway/bailian-rest.ts` 窄口子只承载版本绑定与记忆/密钥资源（上游修复后删除）；
  - 运行时挂载不产生会话事件，也**不会**出现在 `GET /sessions/:id` 的 `resources` 回显里——
    本地 `kit_sessions.files_json` 是展示权威；
- `mount_path` 省略时由服务端解析为 `/mnt/session/uploads/<安全文件名>`（bailian sandbox 前缀是
  `/mnt`；文件名只取 basename、剥前导点、空白转 `_`，同会话内重名自动加 `-2`，建会话挂载与
  随消息挂载共用同一去重集合）；显式 `mount_path` 必须是绝对路径，运行时挂载的前缀合法性由
  SDK 校验（`/mnt/session/uploads/…` 或 `/uploads/…`）；
- 挂载映射只有 mount 响应本身（含 provider 侧内部副本 `file_id` 与资源 id `sesrsc_…`），
  本地 `kit_sessions.files_json` 只是冗余索引；文件内容**不进** kit 数据库
  （不变量：运营库不落事件正文，也不落文件字节）；
- **消息气泡的附件展示**：provider 事件不带附件信息，客户端展示分两段——发送期间的乐观
  气泡由前端自带 attachments；刷新后的历史重建依赖会话详情的 `message_files`（按发送响应
  `event_ids` 关联，落 `kit_sessions.message_files_json`）。`event_ids` 与乐观气泡 ack 匹配
  同源，provider 回显的 `event_id` 命中关联即补附件分片；Chat Store 侧回显替换与 `setMessageFiles`
  注入两条来源按 `file_id` 去重。首条消息（新建会话）会同时传建会话 `files` 与消息
  `attachments`：服务端对已绑定 file_id 跳过重复挂载、失败不回滚，但同样落关联；
- 升级时从历史挂载索引补齐唯一 subject 的文件归属，原身份继续下载与重新挂载；跨身份
  歧义不授权，已有上传记录不覆盖，无索引证据的旧文件需重新上传。迁移不读取或落库事件正文；
- 上传后文件要先过扫描（实测 `checking → available` 约 15~20s）才可绑定；客户端经
  `files.status`（`GET /api/kit/files/:fileId`）在上传后轮询到 `available` 再发送，
  附件卡在扫描期间显示「处理中」并禁发；轮询遇到审核终态（provider 状态枚举
  `rejected` / `type_rejected`）立即把该附件转为失败卡；服务端发送前的扫描闸门
  （有界等待 → 可重试 409）保留为兜底；
- 上传前置拦截（protocol `uploadTypeRejectionReason` / `uploadSizeRejectionReason`，
  服务端与前端同一份文案与常量）：黑名单扩展名（实测 `.mjs` 被 provider 415 拒绝）在
  服务端返回 400 `invalid_request`，前端不发请求直接按失败卡展示；上传文件大小上限
  `KIT_UPLOAD_MAX_BYTES`（默认 20 MiB，protocol `UPLOAD_MAX_BYTES`，provider 合同上限
  50MB），业务校验超限返回 400；multipart 请求体总大小超过该上限加 4096 字节时，由入口
  中间件返回 413。下载统一走 `GET /api/kit/files/:fileId/download` 服务端代理，屏蔽
  预签名 URL 过期问题。

调试附件使用 `/api/admin/debug/files`，只可挂载到同管理员的新调试会话。产物下载经
对应调试文件端点并校验真实会话历史；不向体验接口共享文件归属。

## 技能 token（skills 载荷与消息正文语法）

「/ 选择技能」的消息正文语法（见 [ADR-0016](./adr/0016-skill-inline-token.md)；
纯函数冻结在 protocol `skill-directive.ts`）：

```
POST /api/kit/sessions/:id/messages       body { text, skills?: ["name", …], … }
```

- **两个形态**：输入侧 `/name` 标记（`/` + 技能名 + 一个分隔空格）由 Sender 在光标处插入，
  是**原子整体**——光标落在标记内或紧随其后时退格一次整体删除（含其后分隔空格），选区与
  标记相交时删除范围扩展到完整标记；协议侧 `[使用 Skill:name]` token 由服务端转换而来，
  随事件回显、即气泡正文的一部分。
- **skills 载荷是授权名单**：可选 `skills?: string[]` 从文本 token 派生（`skillInputTokens`
  按首现顺序去重），与 `text` 并列发送。服务端（体验与管理员调试、mock 与 live 共用的
  发送服务层）只转换名单内技能名的输入标记（`composeSkillDirective`），未授权名与手打的
  未知 `/foo` 原样保留；无技能时省略字段。
- **compose 边界规则**：标记前须是行首或空白、后须紧跟空白或行尾；`asd/name`、`/name,b`
  （紧跟标点）、路径片段不转换。
- **气泡还原**：`parseSkillDirective(text, knownSkills)` 按已知技能名精确匹配切分协议
  token，在原位穿插渲染 chip；未知名的 token（历史会话、第三方客户端产生）按原文显示，
  名单缺失时整段纯文本。正文里手打的未知 `/foo` 不受影响。
- mock 与 live gateway 走同一转换路径；SDK 原生支持 skills 后只需替换这一处 compose
  调用（组件层 API 不动）。
- live 验证待探针：含 token 的任务是否触发技能 function_call（P1）、无 token 对照（P2）、
  事件 metadata 回显保留（P3），见 ADR-0016 后果节。

## 版本协商

本节只适用于 Kit Server；自建后端通过调用方的协议版本合同管理，不自动发送 Kit 版本头。

`GET /api/config` 返回 `protocolVersion: "2.0.0"`。Kit 前后端同步升级，不维护旧快照流。
客户端校验主版本并在发送、流订阅、审批请求携带 `x-kit-protocol-version: 2.0.0`；
服务端拒绝缺失或主版本不匹配的请求（409），不会静默降级成语义不同的旧流。

## 上游恢复能力边界

以下为默认 Kit Server 使用 SDK 网络接口时的边界，原始流自建后端遵循上文 ChatProvider 合同。

Kit 的 ready 闸门保证首次上游订阅和历史合并完成后再提交。当前 SDK 只有成功连接的
`onReady`，没有公开的断链状态回调，因此 SDK 内部短暂退避期间 Kit 无法可靠阻止所有新 POST；
恢复后由 SDK 历史补拉收敛，业务 POST 不自动重发。若需要严格禁止这段时间的提交，须先扩展
SDK 公开连接状态，本轮不读取 internal 实现。

SDK 恢复时避免把无分片水位的 in_progress 历史与新 delta 直接相加；中间文本可能暂时被
当前连接的局部快照替换，最终以 completed 全量快照收敛，不承诺断流期间逐字无损连续。

## Session 月度限额

- 本地成员的 experience 会话按 UTC 月、输入加输出 Token 和 `active_seconds` 分别计量。
  不加缓存 Token，不使用会话存在时长。任一启用指标达到上限返回 403 `quota_exceeded`；
  启用指标缺失、倒退或查询失败返回 409 `conflict`，`details.usage_unavailable=true`，可重试。
- 服务端检查位于 ready、归属、待审批与删除保护之后，Gateway 新消费之前；默认与个人配置
  均由服务端裁决。只对真实本地成员启用，管理员调试、匿名与外部 JWT 不加入此账本。
- 累计值首次成功采集只建立基线；后续差值按该轮受理时的 UTC 月记录，跨月轮次归开始月。
  旧累计值不回填到当月。查询时间不是实际消费时间，Provider 延迟上报的差值可能归入后续
  受理月，因此不是精确月账单。限额只拦截后续发送与允许审批，不自动截断已经运行的一轮。
- 跨月待审批继续检查该轮开始月的用量。已结算旧月会话的查询失败不阻塞其他会话的新月
  发送，但重新使用该会话前仍须取得启用指标的有效基线。受理时指标无法计量会保留该月未知
  标记，后续第一次读到累计值不能把此前消费伪装成零或确定的当月值。
- 发送前仅同步采集目标基线；启用限额时再采集受理月相关会话及尚未确认结束的请求。
  不限量发送不等待无关历史会话；读取成员用量仍可全量采集。采集期间政策收紧时，补齐新
  政策需要的会话后重新检查，不能沿用旧的不限量判断放行。
- 有限额时，前一轮未确认结束不得并发发起新一轮。已受理请求的相同 `client_message_id`
  返回此前结果，内容不同则 409；网络失败等不确定发送持久化为未知结果，不盲目重复发送。
  重启不会清除保护；用户可查看会话并通过原有确认删除流程收尾。只存请求指纹、事件 ID、
  主会话状态标识和数值基线，不存事件正文或消息文本。
- Provider 明确拒绝的发送不属于未知结果：撤销该次请求占位及准入时修改的月份/未知标记，
  保留准入前已采集的真实消耗，允许用户重试且不阻塞其他会话。超时、断网和无法证明未受理
  的错误仍保留原保护，不自动重发；明确拒绝的错误也必须脱敏。
- 完成判断要求本轮受理的事件 ID 已可见，并有新的主会话结束状态摘要，或同一缓冲世代中
  晚于本轮回显的主状态变更。同 ID 快照的首次数组位置、`created_at` 或重建缓冲后的新序号
  不能替代更新证据。跨轮完全复用状态 ID 和摘要且缺少变更证据时保持待确认；子线程 idle
  和 `requires_action` 不能证明主会话已完成。
- 被拒绝的草稿和附件保留；重新检查必须确认全部启用指标可用且未超限才能恢复 Composer，
  查询失败或返回 null 不能解禁。成员额度读取失败不得退回 Credits 页面。

## Credits 用量（兼容口径）

匿名与外部 JWT 保留以下行为。本地成员继续记录 Turn 运营索引，但不受 Credits 上限控制，
其体验页展示 Session 月度限额；兼容 `/api/kit/quota` 返回不限量标记，不能代替新限额查询。

- **1 个 Turn = 1 Credit**。扣减只发生在服务端接受 `sessions.messages.send` 的那一刻
  （rate-limit、订阅就绪及工具审批校验之后、gateway 发送之前）；前置校验拒绝
  （如待审批的 409 `conflict`、超限的 403 `quota_exceeded`）不写账本。
- **幂等**：`usage_turns` 上有部分唯一索引 `(session_id, client_message_id)`
  （`client_message_id` 非空时）。同 id 重放不重复扣费，也不会因额度已耗尽而误拒已受理的 turn。
- **不退费**：send 受理后 provider 侧失败（5xx/中断）v1 不退还 Credit；账本是审计依据。
- **限额解析**：`limit = override ?? policy`（`-1` = 不限量），`remaining = limit + Σ当月 packs − used`。
  月/日键为 **UTC**（`YYYY-MM` / `YYYY-MM-DD`）；`reset_at` = 次月 1 日 UTC；pack 仅其 `month` 内有效。
- **闸门关系**：配额操作（policy/override/pack/review）不是 IaC 破坏性动作，不走 plan→confirm
  闸门；但每一次写都进 `kit_audit`。与按 subject 的令牌桶限流（429 `rate_limited`）正交共存。
- 账本只存 turn 计数索引（subject/agent/session/day/month），**不存事件正文与消息文本**。
