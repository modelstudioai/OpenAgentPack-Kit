# SessionSidebar 会话目录

组合智能体分组、最近会话、搜索与行内操作，复用 SessionList 和状态组件。

- `groups`、`recent`、`search` 注入各页的数据及加载/错误状态。
- `searchInput` / `onSearchInput` 控制查询词，`onSelect` 回传会话和来源分区。
- 展开懒加载、分页、重试与编辑通过回调接到 SDK，组件不持有后端流程。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `groups` | `SessionSidebarGroup[]` | 是 | — | 智能体分组（各组独立分页状态），顺序即展示顺序 |
| `recent` | `SessionSidebarPage` | 是 | — | 「最近」分区的分页数据 |
| `loading` | `boolean` | 否 | `false` | 分组清单本身的加载中：分组区还没内容时展示目录级状态 |
| `error` | `string \| null` | 否 | — | 分组清单错误文案；分组区还没内容时展示错误与重试 |
| `onReload` | `(() => void)` | 否 | — | 目录级错误的重试回调 |
| `activeId` | `string \| null` | 是 | — | 当前打开的会话 id |
| `activeSection` | `SessionSidebarSection` | 否 | `"groups"` | 高亮归属分区；不传按分组归属（深链/外部导航的默认视图） |
| `activeStatus` | `SessionSidebarActiveStatus` | 否 | — | 打开行的实时状态标记，只作用于归属分区里的那一行 |
| `activeGroupId` | `string \| null` | 否 | — | 自动展开的分组 id（通常来自路由的 agent slug）；只开不关 |
| `onSelect` | `(session: SessionSummary, section: SessionSidebarSection) => void` | 是 | — | 选中会话：回传该行会话摘要与点击来源分区，导航所需 `agent_slug` 随点击携带、分区用于高亮归属 |
| `onNewChat` | `((groupId: string) => void)` | 否 | — | 分组行「+」新建回调；不传则不渲染该入口。上架核验与路由由调用方自理 |
| `menu` | `((session: SessionSummary, section: SessionSidebarSection) => ReactNode)` | 否 | — | 行尾操作菜单 render prop：返回的元素闭包持有该行会话与来源分区；删除等破坏性动作由业务自备确认弹窗 |
| `editing` | `SessionSidebarEditing \| null` | 否 | — | 受控的分区独立编辑态：编辑框只点亮指定分区里的那一行 |
| `onEdited` | `((id: string, title: string) => void)` | 否 | — | 编辑提交（Enter 或失焦）：入参为会话 id 与去空白、截断到 120 字符的新标题；清空或同名视为取消 |
| `onEditEnd` | `((id: string) => void)` | 否 | — | 编辑态退出（提交或 Escape）：受控模式下由调用方在此清空 `editing` |
| `actionError` | `string \| null` | 否 | — | 目录动作（新建/重命名等）的就地错误提示，渲染为可关闭的错误行 |
| `onDismissError` | `(() => void)` | 否 | — | 关闭错误行回调 |
| `searchInput` | `string` | 是 | — | 搜索框受控值：非空时进入搜索视图 |
| `onSearchInput` | `(value: string) => void` | 是 | — | 搜索框输入回调 |
| `search` | `SessionSidebarPage` | 否 | — | 后端检索结果页：注入后搜索覆盖全部历史会话（含未加载行），按 agent 分组展示；分页状态与取数动作仍归调用方 |
| `agentName` | `((slug: string) => string)` | 否 | — | 检索结果分组头的展示名解析；不传用 slug |
| `className` | `string` | 否 | — | 追加到根节点的 Tailwind 工具类。 |

## 导出与使用

本目录维护：SessionSidebar。

包方式接入仍使用公开入口：

```tsx
import { SessionSidebar } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add session-sidebar
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[session-list](../session-list/README.md)、[states](../states/README.md)。

同目录测试：[session-sidebar.test.tsx](session-sidebar.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/general/session-sidebar.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
