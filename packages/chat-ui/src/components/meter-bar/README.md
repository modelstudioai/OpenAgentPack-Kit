# MeterBar 用量条

将用量和额度映射为进度条，不参与计量或准入判断。

- `value` / `max` 为已用值与额度，比例限制在 0–100%。
- `unlimited` 仅展示轨道；`max <= 0` 不计算比例，额度含义由调用方说明。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `value` | `number` | 是 | — | 当前已用量 |
| `max` | `number` | 是 | — | 生效上限，调用方计入当月加油包 |
| `unlimited` | `boolean` | 否 | `false` | 不限量时只显示轨道 |
| `className` | `string` | 否 | `""` | 附加 Tailwind 类 |

## 导出与使用

本目录维护：MeterBar。

包方式接入仍使用公开入口：

```tsx
import { MeterBar } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add meter-bar
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/plaza.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
