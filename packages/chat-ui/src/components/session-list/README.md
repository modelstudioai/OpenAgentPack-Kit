# SessionList 会话列表

以会话摘要展示选中态、运行标记、操作菜单和行内重命名。

- `sessions` / `activeId` 注入列表与选中项，`onSelect` 回传完整会话摘要。
- `menu` 注入业务操作，编辑和实时状态由 props 控制；组件不查询或删除会话。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `sessions` | `{ session_id: string; agent_slug: string; created_at: string; title?: string \| undefined; status?: string \| undefined; last_event_at?: string \| undefined; }[]` | 是 | — | 必填，按展示顺序排列的会话摘要；空数组显示「暂无会话」 |
| `activeId` | `string \| null` | 是 | — | 必填，当前选中会话的 `session_id` |
| `onSelect` | `(session: SessionSummary) => void` | 是 | — | 必填，选择会话：回传该行会话摘要（导航所需的 `agent_slug` 随点击携带）；选中状态由调用方更新 |
| `menu` | `((session: SessionSummary) => ReactNode)` | 否 | — | 行尾「更多操作」菜单：每行渲染时调用 `menu(session)`，返回元素闭包持有该行会话——⋯ 触发按钮、弹层与菜单项全部由业务渲染；删除等破坏性动作由业务自备确认弹窗。函数身份无需稳定 |
| `editingId` | `string \| null` | 否 | — | 受控行内重命名：设为会话 id 让该行进入编辑态（通常在菜单「重命名」项 `onClick` 里设置），退出后由调用方清空 |
| `onEdited` | `((id: string, title: string) => void)` | 否 | — | 编辑提交（Enter 或失焦）后回调；入参为会话 id 与去空白、截断到 120 字符的新标题，清空或与现标题相同视为取消、不触发 |
| `onEditEnd` | `((id: string) => void)` | 否 | — | 编辑态退出（提交或 Escape）时回调；受控模式下由调用方在此清空 `editingId` |
| `activeStatus` | `"running" \| "attention" \| "failed" \| "completed"` | 否 | — | 当前选中会话的实时状态，优先于该行索引状态——回合收敛后索引要等列表重取才更新；只作用于打开行，不传时该行按 `session.status` 展示。取值为中性展示词，协议相位由调用方映射：`running`=生成中、`attention`=需注意（如等待审批）、`failed`=失败、`completed`=刚完成（纯前端提示：由调用方在回合收敛时设置，点击行或切换会话后清除） |
| `variant` | `"default" \| "workspace"` | 否 | `"default"` | `workspace` 使用舒展行高与按输入方式显隐的操作槽 |
| `ariaLabel` | `string` | 否 | `"会话列表"` | 导航的无障碍名称；同一页面有多个会话列表（分组、最近）时用不同名称区分 |
| `className` | `string` | 否 | — | 添加到列表滚动容器的 Tailwind 工具类 |

## 导出与使用

本目录维护：SessionList；内部 filterSessions。

包方式接入仍使用公开入口：

```tsx
import { SessionList } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add session-list
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[tooltip](../tooltip/README.md)、[process-step](../process/step/README.md)。

同目录测试：[session-list.test.tsx](session-list.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/general/session-list.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
