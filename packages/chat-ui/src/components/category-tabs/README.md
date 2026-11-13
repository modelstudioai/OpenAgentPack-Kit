# CategoryTabs 广场分类

展示“精选”与已提供的分类，支持方向键及 Home/End 导航。

- `categories` 配置分类，`active` 为当前选中项，`onChange` 返回新的分类 ID。
- 键盘切换只滚动分类条，筛选请求由调用方接入。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `categories` | `{ id: PlazaCategory; name: string; count: number; }[]` | 是 | — | 必填，分类列表 |
| `active` | `PlazaTabId` | 是 | — | 必填，分类枚举或 `featured` |
| `onChange` | `(next: PlazaTabId) => void` | 是 | — | 必填，由调用方筛选数据或重新查询 |

## 导出与使用

本目录维护：CategoryTabs、PlazaTabId。

包方式接入仍使用公开入口：

```tsx
import { CategoryTabs } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add category-tabs
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/plaza.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
