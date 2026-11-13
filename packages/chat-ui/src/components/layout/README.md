# Layout 页面布局

提供桌面侧栏、移动抽屉、页头、主内容与右侧面板布局。

- `sidebar`、`header`、`aside` 与 `children` 注入区域内容。
- 侧栏与右侧面板控制对象只负责展示和开关；响应式判断复用公开 SDK。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

同时支持 `HTMLAttributes<HTMLDivElement>` 的标准 DOM 属性；表中列出布局参数与常用 `className`。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `sidebar` | `ReactNode \| ((controls: LayoutSidebarControls) => ReactNode)` | 否 | — | 桌面侧栏与移动抽屉共用的内容，同一时刻只挂载一份；缺省或 `null` 为纯内容布局 |
| `header` | `((menuToggle: ReactNode) => ReactNode)` | 否 | — | 自定义页头，把 `menuToggle` 接进页头操作位（如 `AgentHeader.leading`）；通栏盖住内容区（含资源面板上方） |
| `mobileTitle` | `ReactNode` | 否 | — | 未提供 `header` 时移动端默认页头的标题 |
| `sidebarLabel` | `string` | 否 | `"导航菜单"` | 抽屉的无障碍名称，同时用于打开 / 关闭入口文案 |
| `dialogs` | `ReactNode` | 否 | — | 调用方持有的受控确认弹窗；抽屉打开时进入其焦点范围，跨断点仍可见，待确认状态不要只放进侧栏内部 |
| `aside` | `ReactNode \| ((controls: LayoutAsideControls) => ReactNode)` | 否 | — | 右侧资源面板；桌面为页头之下的停靠右列（与正文同面白色），移动端为全屏覆盖层 |
| `asideOpen` | `boolean` | 否 | `true` | 面板受控开合；桌面收起时列宽过渡到 0，内容保持挂载并置 `inert` |
| `asideLabel` | `string` | 否 | `"资源面板"` | 面板的无障碍名称，用于覆盖层标题与关闭按钮 |
| `onAsideOpenChange` | `((open: boolean) => void)` | 否 | — | 面板关闭（Esc / 移动端关闭按钮 / 跨到移动断点）时回传；打开由调用方置位 |
| `fitViewport` | `boolean` | 否 | `true` | 移动端随可视视口限高，软键盘弹出后收缩；宿主自管高度时关闭 |
| `children` | `ReactNode` | 是 | — | 主内容区（Chat、广场、用量页等） |
| `className` | `string` | 否 | — | 追加到根节点的 Tailwind 工具类。 |

## 导出与使用

本目录维护：Layout。

包方式接入仍使用公开入口：

```tsx
import { Layout } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add layout
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

同目录测试：[layout.test.tsx](layout.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/layout.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
