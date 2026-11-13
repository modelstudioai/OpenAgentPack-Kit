# Actions 操作列表

展示操作项、复制按钮与受控赞踩反馈。静态子组件及其兼容别名共用本目录实现。

- `items` 与 `onClick` 组织普通操作，`variant` 选择外观。
- 复制使用 `text` / `onCopy`，反馈值与变更回调由调用方维护。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

### Actions

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `items` | `ActionsItem[]` | 否 | `[]` | 操作按钮与子菜单配置 |
| `onClick` | `((info: ActionsClickInfo) => void)` | 否 | — | 可用叶子项点击后的统一回调；展开子菜单本身不触发 |
| `children` | `ReactNode` | 否 | — | 组合 `Actions.Copy`、`Actions.Feedback` 或自定义操作 |
| `variant` | `ActionsVariant` | 否 | `"borderless"` | `items` 按钮外观；组合子组件可分别设置 |
| `className` | `string` | 否 | — | 根节点的 Tailwind 工具类 |
| `aria-label` | `string` | 否 | `"操作列表"` | 操作组的无障碍名称 |

### Actions.Copy / ActionsCopy

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `text` | `string` | 是 | — | 待复制的原始文字 |
| `onCopy` | `((text: string) => void \| Promise<void>)` | 否 | 浏览器剪贴板 | 注入复制实现：成功 resolve，失败抛错；省略时用浏览器剪贴板 |
| `disabled` | `boolean` | 否 | `false` | 禁止复制 |
| `label` | `string` | 否 | `"复制"` | 按钮名称与无障碍名称 |
| `iconOnly` | `boolean` | 否 | `false` | 只显示图标（无障碍名称仍读 `label`），复制状态文字照常出现 |
| `variant` | `ActionsVariant` | 否 | `"borderless"` | 按钮外观 |
| `className` | `string` | 否 | — | Tailwind 工具类 |

### Actions.Feedback / ActionsFeedback

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `value` | `ActionsFeedbackValue` | 是 | — | 调用方持有的反馈值 |
| `onChange` | `(value: ActionsFeedbackValue) => void` | 是 | — | 新反馈值：重复点击当前选项回传 `default` |
| `disabled` | `boolean` | 否 | `false` | 禁止修改反馈 |
| `variant` | `ActionsVariant` | 否 | `"borderless"` | 按钮外观 |
| `className` | `string` | 否 | — | Tailwind 工具类 |

## 导出与使用

本目录维护：Actions、Actions.Copy / ActionsCopy、Actions.Feedback / ActionsFeedback。

包方式接入仍使用公开入口：

```tsx
import { Actions } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add actions
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

同目录测试：[actions.test.tsx](actions.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/feedback/actions.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
