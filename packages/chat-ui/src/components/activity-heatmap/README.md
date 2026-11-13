# ActivityHeatmap 活跃热力图

按日期展示对话活跃程度，以当前数据的最大值划分强度。

- `days` 中每项提供 `day` 与 `turns`，日期也作为稳定 key。
- 统计口径、日期范围和排序由调用方准备，组件不聚合后端数据。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `days` | `{ day: string; turns: number; }[]` | 是 | — | 必填，按展示顺序排列，day 必须唯一 |

## 导出与使用

本目录维护：ActivityHeatmap。

包方式接入仍使用公开入口：

```tsx
import { ActivityHeatmap } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add activity-heatmap
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/plaza.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
