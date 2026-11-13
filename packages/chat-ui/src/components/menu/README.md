# Menu 操作菜单

在同一目录维护 Radix 菜单的组合原语，提供键盘导航、关闭和焦点恢复。

- 通过 Trigger、Content、Item 组合菜单，业务动作放在菜单项回调中。
- 删除等操作在业务层接入确认流程，菜单本身不执行请求。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

表中列出 Radix 菜单参数与常用 DOM 属性，其余声明中的标准 DOM 属性继续透传。默认值列中“Radix”表示本组件未覆盖该默认行为。

### Menu

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `children` | `ReactNode` | 否 | Radix | 菜单的组合子元素。 |
| `dir` | `("ltr" \| "rtl")` | 否 | Radix | 文本与键盘导航方向；不传时由 Radix 的方向上下文决定。 |
| `open` | `boolean` | 否 | Radix | 受控的菜单打开状态。 |
| `defaultOpen` | `boolean` | 否 | Radix | 非受控模式的初始打开状态。 |
| `onOpenChange` | `((open: boolean) => void)` | 否 | Radix | 菜单打开状态变化时回调。 |
| `modal` | `boolean` | 否 | Radix | 是否启用模态菜单交互，由 Radix 管理焦点与外部交互。 |

### MenuTrigger

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `disabled` | `boolean` | 否 | Radix | 禁用触发器或菜单项；禁用项不会被键盘选中。 |
| `className` | `string` | 否 | Radix | 追加到对应节点的 Tailwind 工具类。 |
| `children` | `ReactNode` | 否 | Radix | 菜单的组合子元素。 |
| `onClick` | `MouseEventHandler<HTMLButtonElement>` | 否 | Radix | 透传到对应元素的点击回调；菜单项动作通常使用 onSelect。 |
| `asChild` | `boolean` | 否 | Radix | 使用唯一子元素作为实际 DOM 节点，并合并 Radix 的属性与交互。 |

### MenuContent

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `className` | `string` | 否 | Radix | 追加到对应节点的 Tailwind 工具类。 |
| `children` | `ReactNode` | 否 | Radix | 菜单的组合子元素。 |
| `onClick` | `MouseEventHandler<HTMLDivElement>` | 否 | Radix | 透传到对应元素的点击回调；菜单项动作通常使用 onSelect。 |
| `asChild` | `boolean` | 否 | Radix | 使用唯一子元素作为实际 DOM 节点，并合并 Radix 的属性与交互。 |
| `side` | `"top" \| "right" \| "bottom" \| "left"` | 否 | Radix | 弹层相对触发器的优先方位；碰撞时由 Radix 调整。 |
| `sideOffset` | `number` | 否 | `6` | 弹层与触发器之间的间距。 |
| `align` | `"center" \| "start" \| "end"` | 否 | `"start"` | 弹层相对触发器的对齐方式。 |
| `alignOffset` | `number` | 否 | Radix | 沿对齐轴的额外偏移。 |
| `arrowPadding` | `number` | 否 | Radix | 箭头定位时与弹层边缘之间的留白，透传 Radix。 |
| `avoidCollisions` | `boolean` | 否 | Radix | 是否按边界进行碰撞避让。 |
| `collisionBoundary` | `(Element \| null) \| (Element \| null)[]` | 否 | Radix | 碰撞检测使用的边界元素或元素列表。 |
| `collisionPadding` | `number \| Partial<Record<"top" \| "right" \| "bottom" \| "left", number>>` | 否 | Radix | 碰撞边界的统一或分方向留白。 |
| `sticky` | `("partial" \| "always")` | 否 | Radix | 弹层与触发器的贴合策略，透传 Radix。 |
| `hideWhenDetached` | `boolean` | 否 | Radix | 触发器不可见或脱离可视区域时是否隐藏弹层。 |
| `updatePositionStrategy` | `("always" \| "optimized")` | 否 | Radix | 弹层位置的更新策略，透传 Radix。 |
| `onCloseAutoFocus` | `((event: Event) => void)` | 否 | Radix | 关闭时恢复焦点前的回调，可阻止默认焦点恢复。 |
| `loop` | `boolean` | 否 | Radix | 键盘移到首尾后是否循环导航。 |
| `onEscapeKeyDown` | `((event: KeyboardEvent) => void)` | 否 | Radix | 按 Escape 时回调，可阻止默认关闭。 |
| `onPointerDownOutside` | `((event: CustomEvent<{ originalEvent: PointerEvent; }>) => void)` | 否 | Radix | 在弹层外按下指针时回调，可阻止默认关闭。 |
| `onFocusOutside` | `((event: CustomEvent<{ originalEvent: FocusEvent; }>) => void)` | 否 | Radix | 焦点移到弹层外时回调。 |
| `onInteractOutside` | `((event: CustomEvent<{ originalEvent: PointerEvent; }> \| CustomEvent<{ originalEvent: FocusEvent; }>) => void)` | 否 | Radix | 弹层外发生指针或焦点交互时回调。 |
| `forceMount` | `true` | 否 | Radix | 强制保留挂载，透传 Radix。 |

### MenuItem

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `disabled` | `boolean` | 否 | Radix | 禁用触发器或菜单项；禁用项不会被键盘选中。 |
| `className` | `string` | 否 | Radix | 追加到对应节点的 Tailwind 工具类。 |
| `children` | `ReactNode` | 否 | Radix | 菜单的组合子元素。 |
| `onClick` | `MouseEventHandler<HTMLDivElement>` | 否 | Radix | 透传到对应元素的点击回调；菜单项动作通常使用 onSelect。 |
| `onSelect` | `((event: Event) => void)` | 否 | Radix | 点击或键盘选中菜单项时回调，可阻止默认关闭。 |
| `asChild` | `boolean` | 否 | Radix | 使用唯一子元素作为实际 DOM 节点，并合并 Radix 的属性与交互。 |
| `textValue` | `string` | 否 | Radix | 菜单项用于键盘字符查找的文本；复杂 children 可显式提供。 |

## 导出与使用

本目录维护：Menu、MenuTrigger、MenuContent、MenuItem。

包方式接入仍使用公开入口：

```tsx
import { Menu } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add menu
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

同目录测试：[menu.test.tsx](menu.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/basic/menu.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
