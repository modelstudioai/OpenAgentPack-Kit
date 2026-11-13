# 目录与放置规则

## 顶层

```
apps/            可运行应用（server / web / console / storybook）
packages/        可复用包（sdk / chat-ui / eval）
assets/          生成产物（当前为 assets/skills；dist 不入库）
templates/       脚手架源模板（web-experience）
docs/            权威文档（见 AGENTS.md 权威顺序）+ adr/ research/
scripts/         仓库级脚本（dev、kit、skills、check-docs、check-no-inner-deps、lint-changed、build-release）
.githooks/       本地 hook（core.hooksPath）；完整本地验收使用 pnpm gate
```

- 上游 SDK 使用 npm 正式发布的 `@openagentpack/sdk@0.10.0`，由精确版本与
  `pnpm-lock.yaml` integrity 锁定。
- `scripts/build-release.mjs` 负责构建四个部署目标并收集后端生产依赖；产物放在被忽略的
  `.scratch/releases/kit-*`，不把 `.env` 或本地数据库纳入发布产物。
- `scripts/kit/` 承载仓库内脚手架命令：`kit:create`、`kit:add`、`catalog:list`。
  它不是 workspace 包，不发布 npm，也不提供独立 bin；外部可分发 CLI 的
  决策见 ADR-0022。`create` 生成的项目会得到指向本仓库脚本的 `pnpm kit:add` 命令。

## 包内

```
packages/<name>/
  src/            源码；公开入口见 package exports（SDK 按功能设置）
  src/protocol/generated/  自动生成的 OpenAPI 类型，不手改、不写测试
  tests/          跨模块测试与 fixture；单文件单测与源码同目录 <name>.test.ts
  AGENTS.md       该包不变量 + 「加一个新 X 时」步骤 + 强制它的闸门
  package.json    private: true（开源前）+ publishConfig（开源后直接发）
  tsconfig.json   extends ../../tsconfig.base.json
  tsup.config.ts  需要产 dist 的包（sdk/chat-ui/eval）
```

- 文件名与目录名一律 **kebab-case**；导出符号 camelCase / PascalCase。
- 一个文件一个主要职责；生产源码 > 800 行、测试 > 1000 行时按变化原因拆分。
- 测试与被测源码同目录（`foo.ts` ↔ `foo.test.ts`）；需要 fixture 或多模块协同时放
  `tests/`，fixture 放 `tests/fixtures/`（入库前必须脱敏，见 `apps/server/AGENTS.md`）。
- Chat UI 的独立组件放 `packages/chat-ui/src/components/<component>/`，执行过程组件放
  `components/process/<component>/`；每个目录包含 `index.tsx`（纯逻辑或聚合入口用 `index.ts`）、
  中文 `README.md` 和已有单测。复合组件的静态子组件与私有辅助逻辑随主组件维护；
  `chrome`、`plaza`、`states`、`tool-approval` 保留为兼容 copy-in 的重导出入口。
  `src/index.ts` 维护公开导出，`registry.json` 的 file/deps 与复制后相对导入同步调整。
- 需要真实凭据的脚本放 `apps/server/tests/live/`（`smoke` / `record` / `cleanup`）：
  默认跳过，`KIT_LIVE=1` 才跑；`record.ts` 只读，不创建/修改/删除远端资源。
- `src/internal/` 表示包内私有实现，不得从 barrel 导出；跨包只能走声明的公开功能入口。
  `@openagentpack/kit-sdk/providers/bailian` 是原始百炼后端接入入口，其他功能入口不导入
  其上游 SDK 运行时转换依赖。SDK 不保留根入口、`/adapters/react`、`/react`、`/request/stream` 或 `/bailian`。
- SDK 按下表归属功能，源码与导入入口一致（ADR-0026）。功能 hooks 位于该模块的 `hooks/`，
  通用订阅、生命周期、查询工具与屏幕判断放 `src/hooks/`；Kit Context 与 Client 解析放
  `src/providers/kit/react/`。不保留顶层 `src/react/`，不集中导出功能 hooks。

| SDK 源码目录 | 责任 | 公开入口（省略 `@openagentpack/kit-sdk`） |
| --- | --- | --- |
| `chat/` | Controller、Store、重连、子线程、首次发送 Composer | `/chat`、`/chat/hooks` |
| `sessions/` | 会话目录、分页、搜索、详情、操作与独立目录读取 | `/sessions`、`/sessions/hooks` |
| `files/` | 上传、扫描、取消、产物类型与操作 | `/files`、`/files/hooks` |
| `agents/hooks/` | Agent 目录、广场、资源查询 hooks，复用 Client | `/agents/hooks` |
| `usage/` | 用量、额度申请与恢复 | `/usage`、`/usage/hooks` |
| `auth/` | 成员认证、身份隔离、登录态存储 | `/auth`、`/auth/hooks` |
| `messages/` | 消息类型与纯展示转换 | `/messages` |
| `request/` | HTTP 请求，调用独立 Stream 模块读取 SSE | `/request` |
| `stream/` | SSE 字节解码与分帧，取消与 reader 释放 | `/stream` |
| `providers/` | 后端合同和请求映射；Kit、标准事件、百炼适配 | `/providers`、`/providers/kit`、`/providers/session-events`、`/providers/bailian` |
| `protocol/` | DTO、Schema、事件与协议帧 | `/protocol` |
| `config/`、`state.ts` | 宿主配置、通用调用状态 | `/config`、`/state` |
| `hooks/` | 通用订阅、生命周期、查询工具与屏幕判断 | `/hooks`：仅 `useIsMobile`；其他工具内部使用 |
| `providers/kit/react/` | Kit Context、Client 解析 | `/providers/kit/react`：仅 `KitProvider`、`useKitClient`、`useKitContext` |

- Stream 与 Request 为并列功能目录：Request 复用 Stream，Stream 不反向依赖 HTTP 请求。
  其他功能保持原有运行时依赖方向：Provider 不依赖会话
  工作流或 React；Chat 核心不反向依赖 Composer。`sessions/load-directory.ts` 只依赖
  协议与内部取消工具，Client 直接引用此叶子模块，不引用 sessions 的聚合入口。
- React 仅允许位于六个功能的 `hooks/`、通用 `hooks/` 与 `providers/kit/react/`。
  通用 hooks 的仓库内依赖仅限自身、`state.ts`、`protocol/` 和 `internal/`；Kit React 接入
  仅依赖 Kit 自身，不引入其他 Provider 或功能流程。数据入口不反向导入上述 React 模块。
- `messages/` 的 `transformSessionEvent` 只做纯转换，不依赖 Chat、网络或 SDK 运行时。
  Provider 定义转换策略，Chat 的 projection 按快照调用，Store 持有结果与乐观 overlay。
- `providers/kit/transport.ts` 放 Kit 协议传输，`providers/http-operation.ts` 共用请求构造、
  响应映射与取消执行；`state.ts` 共用查询代次、单飞和快照订阅，不新建并行实现。
- package exports、tsup 入口与 Skill API 模块表必须一致；根聚合文件与旧目录不作为兼容层保留。
  单模块测试随实现移动，跨功能合同测试放 `packages/sdk/tests/`。
- Web 的 `src/lib/backend.ts` 配置公开 Client operations；`src/lib/chat-backend.ts` 只填写示例后端的路径、协议头与响应映射，交给公开
  `createSessionEventChatProvider`；聊天页显式注入 Provider。它不重新实现流解析或消息累加。

- `protocol/project.ts` 与 `protocol/debug.ts` 放共享管理端 DTO；console `src/lib/admin/` 的
  `client.ts`、`member-usage.ts`、`operation.ts` 放 Kit 管理请求、成员用量与 Operation 恢复，
  业务合同测试随源码放置。该目录 hooks 只订阅和管理生命周期；通用状态测试位于 SDK
  `src/state.test.ts`，前后端通过 SDK 公开入口消费共享能力。
- console `features/navigation/console-route.ts` 定义页面路径与可恢复参数，`console-router.tsx`
  管理 Browser History、导航锁定与退出确认；`features/members/member-usage-route.tsx` 根据路由 ID
  读取成员资料并装配用量页。浏览器导航验收放 `apps/web/e2e/console-routes.spec.ts`。
- console `features/preset-packs/preset-pack-selection.tsx` 提供创建页导入抽屉的选择内容，首个智能体模块复用
  `features/catalog/use-remote-agents.ts` 查询完整远端 Agent，浏览器内每页展示 10 条；不读取本地模版或创建资源。
  `preset-pack-session-resources.tsx` 按类型分组展示单选 Agent 的运行时资源，`preset-pack-resource-groups.ts`
  负责同类型按资源 ID 跨会话去重及挂载信息合并；页面不展示会话。DTO 位于 protocol `preset-packs.ts`，
  server `routes/preset-packs.ts` 提供只读入口，`gateway/sdk-preset-pack-resources.ts` 承载 SDK 分页与限并发读取，
  `gateway/preset-pack-resources.ts` 统一引用白名单投影与去重；Mock 投影独立于已有的大型模拟消息生成器。
  `services/preset-packs.ts` 只读核验当前选择，`store/preset-packs.ts` 仅兼容旧版保存目录；
  `create-template-page.tsx` 初始展示导入或从零创建的方式选择，选择后挂载既有编辑器，并保留已导入的内存草稿；`template-draft.ts` 负责回填映射。
  `template-preset-picker.tsx` 在创建页抽屉中使用 `PresetPackSelection` 的远端列表和资源多选，并处理替换确认；不提供独立导入页面。
  `template-agent-runtime-resources.tsx` 负责基础配置选中远端 Agent 后的检测提示及资源选择抽屉，
  与页头导入共用 `preset-pack-session-resources.tsx` 的查询和 `PresetPackResourceSelection`，不重建基础配置。
  资源选择组件提供可选操作区与反馈区挂载容器，将基础配置的使用按钮和失败提示显示在 Drawer footer，继续由同一组件管理禁用、提交及回填。
  `template-agent-detail-drawer.tsx` 在查看详情时预读资源，经列表和选择器的确认回调传递有效结果，确认后不重复查询。
  `preset-pack-resource-detail-drawer.tsx` 负责单个运行时资源的只读配置预览及确认选择，通过资源行点击或键盘激活打开，列表不提供查看操作按钮或直接勾选；
  复用环境、密钥库详情视图及记忆条目组件，文件仅读取现有目录元数据，不新增后端操作。
  `preset-pack-memory-configuration.ts` 在条目不可完整读取时核验原库目录并返回摘要，保护仅复用引用的选择路径；
  同目录测试覆盖完整预览、摘要降级、原库不可用及取消读取。
  `preset-pack-resource-selection.ts` 统一环境单选替换及其他类型多选上限，复用创建页数量常量；同目录测试保护替换、取消、去重及数量边界。
  `template-draft.ts` 的关联映射保护已有资源编辑、按 ID 补充及合并约束；对应业务不变量测试位于 `template-draft.test.ts`。
- console `features/operations/operations-page.tsx` 展示操作审计；server `routes/audit.ts` 与
  `store/audit.ts` 提供分页查询，合同为 protocol `api.ts` 中的 `AuditLogView` / `AuditLogsPage`。
  智能体操作审计和浏览器验收分别放 `apps/server/tests/audit.test.ts` 与 `apps/web/e2e/operation-logs.spec.ts`。
- `protocol/groups.ts` 放本地用户组与管理端成员摘要合同；server `routes/groups.ts`、
  `services/groups.ts`、`store/groups.ts` 分别负责 HTTP、确认/审计和本地关系事务。
  console 已移除用户组界面，成员入口在 `features/members/`；旧用户组路径由
  `features/navigation/console-route.ts` 归一到成员列表，界面回归放 `apps/web/e2e/member-groups-removal.spec.ts`。
- `protocol/resource-drafts.ts` 定义一次性资源批次及最小回执；server 的 `store/resource-drafts.ts`、
  `services/resource-drafts.ts`、`routes/resource-drafts.ts` 管理所有权、发布恢复及生命周期，
  `services/draft-resources.ts` 管理批次内资源，`gateway/resource-draft-yaml-files.ts` 管理数据库成功证明与上传清理。
  `gateway/yaml-draft-*` 分别负责声明、独立上传、SDK state 与发布，`mock-yaml-draft.ts` 负责模拟远端写入。console 的
  `template-resource-draft.tsx` / `use-template-draft-project.ts` 供资源创建和发布流程共用批次。
  `template-resource-draft-owner.ts` 管理页面对批次的所有权、退出/迟到创建清理及跨标签页互斥；
  发布结果未知的批次仍交由原发布恢复流程处理。
- `protocol/templates.ts` 放已保存模版合同；server 的 `routes/templates.ts`、`services/templates.ts`、
  `store/templates.ts` 分别处理接口、资源复核/审计与配置目录持久化。console `features/templates/`
  包含新建/编辑两步向导、保存与列表/详情，浏览器流程由 `apps/web/e2e/template-*.spec.ts` 保护。
  `template-configuration-fields.ts` 统一创建预览与管理列表的基础配置展示合同；`template-list-configuration.tsx`
  负责当前页配置去重读取、名称补齐、失败重试与表格字段，复用既有客户端和查询 hooks，不新增列表 Provider 聚合接口。
  `template-editor-page.tsx` 是创建与编辑的共享表单和资源批次入口，两个页面仅负责空白初始化或读取最新快照；
  `template-save-action.tsx` 串联配置与预览步骤、资源发布/解析及保存名称表单；`template-wizard-steps.tsx` 提供步骤导航，预览复用 `template-debug-preview.tsx` 并按运行时绑定管理会话；
  `template-local-resources.tsx` 聚合持久本地声明、新建结果和完整发布绑定，`template-resource-candidates.ts` 按真实 ID 合并本地/云端候选；
  五类资源新建成功自动选择并同步配置摘要，本地引用通过独立元数据保留项目与声明身份；
  `template-publish-resources.ts` 组织待发布资源清单与中文类型/操作，普通 noop 不展示，危险项保留；
  `use-template-publish.ts` 在资源无变更且计划复核通过时直接继续保存，有变更时审阅清单并显式确认发布；
  `use-template-resource-resolution.ts` 在发布成功或确认无需资源变更后读取完整绑定，原子更新全部候选及草稿，失败后只读重试；
  `protocol/project-resource-bindings.ts` 定义完整绑定列表与严格解析合同，`routes/draft-resource-bindings.ts` 与
  `gateway/yaml-draft-publish.ts` 经独立批次资源服务精确读取 SDK state 的 ID/Agent 版本，不访问凭据。
  `template-agent-list.tsx` 默认选取远端 Agent 列表中的具体版本；`template-agent-version-picker.tsx`
  经 console 管理端 client 与查询 hook 按需读取历史版本，缺失默认版本时自动查询并取最大正整数；
  `template-agent-version-history.tsx` 在选择抽屉中展示版本时间线并查询展开版本的配置；
  `agent-version-configuration.ts` 适配历史配置展示形状，`agent-version-configuration-view.tsx`
  负责只读模型/工具/MCP 卡片与技能标签，
  `gateway/agent-version-detail.ts` 负责白名单配置投影与脱敏，浏览器不接收 Provider 原始属性；
  `template-agent-multiagent-fields.tsx` 负责协调模式开关与已有子 Agent 搜索多选；
  `gateway/agent-multiagent.ts` 仅投影名册与协调模式标记，无损转换受支持的远端成员身份。
  `gateway/sdk-agent-skill-names.ts` 通过公开 SDK 按技能引用补齐名称，结果仍经过上述脱敏投影；
  `template-environment-detail-drawer.tsx` 按打开时查询环境详情，`environment-detail-view.tsx`
  负责概览、云端预装包和脱敏元数据的展示，确认选择由调用方处理；
  `template-environment-configuration.tsx` 提供默认展开的环境表单和配置导入抽屉，
  `template-environment-form.tsx` 复用 `environment-create-fields.tsx`，其中 `environment-networking-fields.tsx`
  编辑访问模式、可选服务访问开关和主机列表，通过批次资源 API 保存 YAML 声明；
  `template-environment-form-draft.ts` 负责表单与声明转换、变更比较和复制边界，
  `use-template-environment-detail.ts` 统一读取远端详情或本地声明；下一步统一准备 Agent 和环境，
  未修改复用原资源，修改远端配置保存副本，本地未发布配置按原声明 ID 更新；
  `template-upload-dropzone.tsx` 为文件与 Skill 提供点击/键盘/拖拽选择；`template-file-dropzone.tsx`
  负责单文件选择校验；`template-file-configuration.tsx` 展示默认文件表单，
  `template-file-picker.tsx` 将可搜索列表放入导入抽屉，`template-file-draft.ts` 管理内容替换和路径保留；
  `use-template-file-form.ts` 与 `template-file-upload-owner.ts` 在下一步通过既有文件接口暂存、预览并保存变化项，
  未改动的云端文件复用原引用，未提交暂存由页面清理，已提交声明由资源批次管理；
  `template-memory-configuration.tsx` 展示记忆库默认表单，`template-memory-picker.tsx` 提供配置导入抽屉，
  `template-memory-draft.ts` 区分新库元数据与挂载权限/说明；`use-template-memory-form.ts` 在下一步
  顺序保存新库并逐项回填已成功引用；导入后名称、描述与条目未变时复用原库，修改后新建副本；
  `template-saved-resources.tsx` 只读补齐模版详情的基础配置、环境和记忆内容，复用既有资源查询 hooks；
  `template-memory-entry-list.tsx` 为创建页与详情共用条目路径/正文展示，详情不传编辑操作；
  `template-memory-entries.tsx` 管理条目列表和编辑弹窗；`sdk-memory-store-configuration.ts` 经公开 SDK 完整读取远端条目，
  `memory-store-configuration.ts` 统一投影和复制限制，本地配置接口读取已解析条目。新批次的初始化正文保存在 YAML，SDK 按字面量校验并在显式确认后初始化；
  `template-vault-configuration.tsx` 默认展示密钥库表单，`template-vault-picker.tsx` 承载可搜索导入列表；
  `template-vault-draft.ts` 管理新库输入、导入基线和变更比较，`use-template-vault-form.ts` 在下一步逐项保存本地声明，
  每项成功立即移除页面密钥输入，部分失败重试不重复创建已成功项；未修改复用原库，修改后新建副本，原库不变；
  `template-vault-detail-drawer.tsx` 提供 `useTemplateVaultDetail`：配置页导入后加载可编辑基线，候选列表通过只读抽屉按需查看；
  读取远端详情或待发布声明，只展示密钥名称、变量名和生效域名；
  `gateway/sdk-vaults.ts` 通过 SDK 公开 runtime 查询并投影密钥元数据，`routes/admin-vaults.ts` 提供管理端详情路由；
  `template-vault-credentials.tsx` 管理待添加密钥列表，`template-vault-credential-dialog.tsx` 提供名称、变量值和生效域名的嵌套编辑弹窗；
  `gateway/yaml-draft-document.ts` 将显式 MA 配置传给 SDK，Vault 随机引用只在本批内存 Map 解析，不写全局环境；
  `template-agent-form.tsx` 收集 Agent 配置，`template-agent-model-picker.tsx` 复用表单下拉选择模型，
  `managed-agent-models.ts` 保存用户要求的实际目录固定快照；`template-agent-capability-picker.tsx` 按需查询并多选 Skill/MCP 引用，
  在「我的 Skill」中合并本地共享声明与云端自定义 Skill，保留各自引用形状和失败恢复；
  `template-skill-upload-dialog.tsx` 先选择单个 Skill 文件并展示卡片，确认后复用项目上传队列保存共享 Skill，
  将返回的共享声明交给能力选择区自动合并已选引用，再刷新父表单 revision，不创建远端资源；
  `routes/remote-skills.ts`、`services/remote-skills.ts` 与 `gateway/sdk-remote-skills.ts` 通过公开 SDK 读取云端 Skill 安全摘要，
  保存前复核固定版本，不读取 Skill 正文或触发远端写操作；`routes/draft-agents.ts` 经独立批次资源服务
  将新批次分派到 `yaml-draft-gateway.ts`；YAML 批次通过独立的 draft-resources service 和 yaml-draft-gateway 处理声明、确认和发布。
- console 已移除旧 `features/project/` 工作台页面，仍使用的文件与 Skill 暂存队列放在
  `features/templates/use-project-uploads.ts`；server 的 YAML gateway 适配 SDK 公开对象接口，`services/draft-resources.ts` 管确认/审计/并发，
  `services/debug.ts` 与 `routes/debug.ts` 管调试用途和主体归属。

## Skill 源与生成物

Skill 不是 workspace 包，也不参与应用运行时依赖。人工源与生成器在 `scripts/skills/`，
最终目录在 `assets/skills/`；只有 `scripts/skills/src/` 允许人工编辑：

```
scripts/skills/
  src/<skill-name>/
    metadata.json   name / description / displayName / shortDescription / defaultPrompt
    skill.md        SKILL.md 正文
    catalog.json    公开 API 到英文用途、文档与示例的映射
    references/     英文行为说明
    examples/       英文 TS/TSX 示例，参与类型检查并同步到文档站
  generate.mjs      生成、校验与 API 模型入口
  pack.mjs          确定性离线打包
  tests/            生成、链接、打包与浏览器边界测试
  tsconfig.json     示例类型检查

assets/skills/
  <skill-name>/     生成的最终 Skill：SKILL.md、agents/、references/、examples/
  dist/             离线 tgz 产物（gitignore）
```

- `kit-components` 覆盖 `kit-chat-ui` 全部公开组件、静态子组件与兼容别名；以公开 barrel
  为范围依据，不能只检查 registry 顶层项。内部实现组件不进入公开 API。
- `use-kit-chat` 指导 Hook 与生命周期；`kit-chat-provider` 指导默认及自建百炼后端合同。
  三者共用现有公开类型，不复制协议实现、不引入第二套事件模型。
- Skill 正文、参考、元数据、示例注释与示例界面文案使用英文；本站说明与权威文档仍为中文。
- `pnpm gen:skills` 从 `scripts/skills/src/` 生成 `assets/skills/`、API 参考与 MDX 示例；
  `pnpm check:skills` 只检查，`pnpm pack:skills` 生成离线包。生成区不手改。
- `pnpm typecheck:skills` 编译示例，`pnpm test:skills` 保护生成漂移、链接、英文内容、
  独立离线包和浏览器依赖边界。语义说明与 API 结构分别维护并共同校验。
- 文档站入口为 `apps/storybook/content/docs/skill/index.mdx`，保留 `/docs/skill/` URL。
  下载文件由构建准备到 `apps/storybook/public/skills/`，不提交这些复制件或压缩包。
  离线包保留当前生成文件的实际修改时间；storybook 的 build 禁用 Turbo 缓存，避免只修改文件
  时间或更换 checkout 后复用旧时间戳的归档。
- SDK 栏目与 Skill 栏目的代码标记块均引用上述 `examples/`；公开入口重导出的同一类型
  按 TypeScript 符号身份去重，参考优先列出其主入口，不按同名猜测两个合同相同。

## app 内

- 体验页品牌由 console 的 `features/branding/` 经管理端品牌接口维护；server 的
  `store/branding.ts` 保存名称、Logo 配置与上传文件，`routes/branding.ts` 负责权限及公开图片响应隔离。
  Web 的 `lib/branding.ts` 按运行时 API base 拼接上传地址并保留路径前缀。
- `features/chat/experience-sender.tsx` 组合 Sender 与 Suggestion 的技能选择；资源面板保留在
  `features/chat/aside-panel.tsx`。SDK 的 `agents/hooks/use-agent-resources.ts` 从同一次详情请求
  投影工具、技能、MCP 与可选 `memory_stores`，不恢复 Web 私有查询 hook。

```
apps/web|console/
  src/features/<feature>/   按业务特性组织（页面 + 局部组件 + 局部 hook）
  src/lib/                  app 级工具与 API 客户端装配（不放进 packages 的东西）
  src/app.tsx / main.tsx    入口与路由
  index.html                Vite 入口
```

管理端页面按 `docs/interfaces.md` 的控制面 op 分组，一个 op 家族一个 feature 目录。

本地成员管理在 `apps/console/src/features/members/`；对应 server 的 `routes/members.ts`、
`services/members.ts` 与 `store/members.ts`。密码派生只在服务端实现，API DTO 在
`@openagentpack/kit-sdk/protocol`，不引入 UI 组件库依赖。

成员用量 DTO 在 `packages/sdk/src/protocol/session-usage.ts`；Gateway 的 `session-usage.ts`
只做 Provider 详情白名单映射。server 的 `services/member-usage.ts` 调度全量分批采集，
`store/session-usage.ts` 保存与汇总累计快照；`services/session-deletion.ts` 与
`session-mutations.ts` 协调删除前停止、采集与并发写入，`store/session-deletions.ts` 保存
删除阶段。新增 API 仍属于 `routes/members.ts`，管理端详情位于原 `features/members/`。
Provider HTTP 合同测试放 server/tests，跨 store/service 的归属、分页、删除恢复回归同层
验证；UI 测试不重复原始字段映射。

成员管理客户端与无框架用量 Controller 位于 `apps/console/src/lib/admin/`；
console `src/lib/admin/use-member-usage.ts` 只订阅 Controller 并管理生命周期。

月度限额 DTO 在 `packages/sdk/src/protocol/usage-limits.ts`；server 的 `routes/usage-limits.ts`、
`services/usage-limits.ts`、`store/usage-limits.ts` 分别负责接口、发送检查与数值增量持久化。
管理端入口位于 `apps/console/src/features/usage/`，体验端额度与恢复提示位于
`apps/web/src/features/usage/`；双方经 SDK client / React adapters 访问同一合同。

成员认证在 server 的 `routes/member-auth.ts`、`services/member-auth.ts` 和
`store/member-sessions.ts`；`services/passwords.ts` 负责密码派生与验证，
`services/auth-stream.ts` 负责已建立 SSE 的撤销 / 到期。文件归属在
`services/files.ts`、`store/files.ts`，不保存文件字节或事件正文。
SDK 的 `auth/member-auth.ts` 管理固定身份 Client 与认证状态；`auth/hooks/` 的
`useMemberAuth` 绑定生命周期。体验页与生成模板的 `features/auth/` 只负责表单、浏览器
sessionStorage 和页面闸门，不复制 HTTP / SSE 认证逻辑。

体验页两级会话目录合同在 `packages/sdk/src/protocol/session-directory.ts`；server 的
`routes/session-directory.ts` 与 `store/session-directory.ts` 负责身份内的智能体枚举和索引分页，
`services/sessions.ts` 保留状态对账。SDK 的 `sessions/load-directory.ts` 编排逐组翻页、
取消与排序；web 侧栏不使用完整读取，SDK `sessions/session-directory.ts` 枚举智能体并管理分组缓存。
`sessions/session-pages.ts` 统一管理各组及全局最近的十条分页、取消、去重与失败重试，
`sessions/hooks/` 负责订阅与生命周期；`features/layout/session-sidebar.tsx` 把分组展开懒加载、
最近会话、高亮归属与行内编辑等目录 props 接到 kit-chat-ui 的 `SessionSidebar`，侧栏只编排展示。

体验页 `lib/format-token-count.ts` 统一每日/月度卡片、热力图和超限提示的 Token 数量缩写及
完整数值提示，不参与计量与准入判断；边界及舍入合同由同目录测试保护。
`lib/beijing-time.ts` 统一用户端绝对时间的北京时间转换与服务端聚合日起点展示；
同目录测试覆盖跨日、跨年与无效时间，浏览器在其他时区验证输出仍固定为北京时间。

## templates/web-experience（脚手架源模板）

```
src/features/auth/        成员登录表单与 sessionStorage 闸门
src/lib/host.ts           模板真实需要的宿主保存能力
src/lib/kit.ts            SDK / chat-ui 装配
src/app.tsx / main.tsx    最小体验页入口
```

- 仅作为 `pnpm kit:create` 的复制源，不是 workspace 应用；生成时会写入 `kit.repo.json`、
  改 tsconfig 与 Tailwind `@source` 路径，并注入 `pnpm kit:add`。
- 模板只保留可独立 install → typecheck → build 的最小体验页。

## 不放这里的东西

- 临时探针、截图、个人计划 → `.scratch/`（已 gitignore）
- 上游调研结论 → `docs/research/`
- 验收实测输出 → PR 描述或 CI artifact，不随仓库提交
- 凭据、`.env`、`.data/`、`*.sqlite` → 已 gitignore，任何情况下不入库
