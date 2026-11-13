# ADR-0015：antd 仅限管理端（apps/console）使用

状态：已接受（2026-11-03）。本 ADR 部分修订 ADR-0002 决策第 1、4 条中「全仓禁 antd」的
结论；「零内网依赖」针对 `@ali/*`、`@alife/*`、内网域名与内网网关的原义不变。

## 背景

ADR-0002 当年把 antd 与内网包一起列入全仓禁用，动机是开源可行性：内网生态以「antd +
私有微前端组件 + 私有网关」打包出现，且当时假设管理端引入 antd 会在开源迁移时等于重写。
事实上 antd 是 MIT 开源包，不破坏 Apache-2.0 合规，被禁的实质是内网包与内网网关，antd
只是连坐。代价记录在 ADR-0002 后果里：管理端的表单、表格、树、上传等重控件全部自建，
工作量显著高于用 antd。管理端后续功能（模版向导、用量、成员等）持续为这些重控件付出
自建成本，而体验侧以 copy-in 组件库为产品形态，不承受该成本。

## 决策

- **antd（锁 v6：原生支持 React 19，不引入 v5 + React 19 patch）只允许在 `apps/console`
  依赖与 import**。禁用侧明确覆盖 `packages/*` 全部（protocol/sdk/elements 是硬边界）、
  `apps/web`、`apps/storybook` 与 `templates/*`。
  在 console 之外引入 antd 触发 AGENTS.md 执行红线的 stop-and-block。
- **对话链路组件一律用 `@openagentpack/kit-elements`**：凡消费 SessionEvent、消息分片、
  会话状态，或走 ChatProvider/kit-react hooks 合同的组件（Chat、MessageList、Sender、
  审批卡、ToolCallCard、SubAgentCard、ArtifactCard 等）不使用 antd，没有「优先但可例外」
  的口子；例外需在 MR 记录理由。管理端其余新代码 antd 优先；页面上已存在且好用的
  elements 用法不强制替换。
- **迁移以页面为单位、渐进进行**：摸到哪个页面用 antd 重写哪个页面；同页两套表格/弹窗
  体系是待收敛状态，不是目标形态。对话区域（模版调试 Tab、预览步骤的对话组件）不随
  页面迁移。
- **破坏性操作的交互合同不动摇**：先展示 plan diff、显式确认、无 `--yes` 旁路是协议层
  闸门；「AlertDialog 语义」在 console 放宽为「模态 + 焦点受管 + 显式确认」，允许 antd
  Modal 实现，推荐条款优先复用 elements AlertDialog。
- **主题归口**：console 通过唯一的 antd 主题配置文件（首次引入时建立在
  `src/lib/antd-theme.ts`，经 `ConfigProvider` 生效）定制 token，对齐管理端现有中性色板；
  antd 组件内部样式豁免「Tailwind 工具类 + `theme.css`」要求，页面级布局样式仍走
  Tailwind；elements `theme.css` 与 antd 主题互不引用。
- **双守卫**：dependency-cruiser 新增 `antd-console-only` 规则管源码 import 边界（进
  `pnpm check:architecture`）；`check-no-inner-deps` 管 package.json 依赖声明准入
  （console 白名单，其余位置报错）。
- **不引入 `@ant-design/x`**：其对话组件与「对话链路一律 kit-elements」冲突；
  `docs/research/antdx-*` 仅作 API 与交互参考。不为 console 产物设 bundle 硬门禁。
- console 开源时随仓库交付，antd 依赖不构成开源阻碍。

## 理由

- 管理端是内部效率工具，表格/表单/树/上传等重控件用 antd 直接换掉自建成本；体验侧是
  copy-in 交付物，视觉与体积敏感，维持 Radix + Tailwind v4 + CVA 单一栈。
- antd 与「零内网依赖」无实质冲突，把它从 ADR-0002 的禁用清单里拆出，只收回「管理端
  不得用 antd」这一条，不放松任何内网约束。
- 对话链路绑定 kit-elements 是因为渲染合同（SessionEvent 快照归并、稳定分片 id、主题
  token、ChatProvider 编排）只有 elements 实现，antd 没有对等物；「优先」在实践中会
  退化为无约束。

## 后果

- console 存在两套组件体系并存的过渡期（既有页面 elements、迁移后页面 antd），视觉一致
  性由 antd 主题 token 对齐现有中性色板兜底；同名交互（弹窗、表格、表单）在相邻页面可能
  风格不同，接受到全部页面收敛为止。
- antd v6 与 Tailwind v4 preflight 有已知共存怪癖（button cursor、border 样式等），处置
  约定见 `apps/console/AGENTS.md`「UI 组件栈」节。
- console 产物体积显著增大；管理端内网使用、性能不敏感，不设 bundle 门禁。
- 守卫与规则同步演进：改动本决策前先改本 ADR 与 `apps/console/AGENTS.md`。

## 备选方案

- 维持全仓禁 antd（ADR-0002 原样）：管理端重控件继续自建，成本持续，已否决。
- 引入 `@ant-design/x` 做管理端对话：与「对话链路一律 kit-elements」冲突，已否决。
- antd v5 + `@ant-design/v5-patch-for-react-19`：仓库已是 React 19.3，v6 原生支持，
  无理由引入 patch 层，已否决。
- console 开源时不随仓库交付：需要维护「开源剥离」流程，成本高于接受一个 MIT 依赖，
  已否决。
