# AgentHeader 智能体页头

展示智能体图标、名称、描述与操作区。图片和 emoji 统一经 `isIconImageSource` 判断。

- `agent` 注入智能体摘要，其中包含名称、图标和描述。
- `agents` 配合 `onPickAgent` 可将标题变为切换器；`actions` 可替换或隐藏操作区。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

### AgentHeader

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `agent` | `{ slug: string; display_name: string; suggested_prompts: string[]; capabilities: { streaming: boolean; fileUpload: boolean; artifacts: boolean; threads: boolean; reasoning: boolean; }; category: "other" \| "data" \| "general" \| "writing" \| "coding"; featured: boolean; description?: string \| undefined; icon?: string \| undefined; opening_remarks?: string \| undefined; theme?: { accent?: string \| undefined; iconBackground?: string \| undefined; } \| undefined; } \| null` | 是 | — | 必填，Agent 展示信息；展示 `display_name` / `description` / `icon`，`null` 显示「未选择 Agent」占位 |
| `agents` | `{ slug: string; display_name: string; suggested_prompts: string[]; capabilities: { streaming: boolean; fileUpload: boolean; artifacts: boolean; threads: boolean; reasoning: boolean; }; category: "other" \| "data" \| "general" \| "writing" \| "coding"; featured: boolean; description?: string \| undefined; icon?: string \| undefined; opening_remarks?: string \| undefined; theme?: { accent?: string \| undefined; iconBackground?: string \| undefined; } \| undefined; }[]` | 否 | — | 可切换的已上架 Agent；与 `onPickAgent` 同时传入且非空时，标题渲染为原生 `select` 切换器，长名单行省略并保留 `title` 提示 |
| `onPickAgent` | `((slug: string) => void)` | 否 | — | 切换器选择后回调；路由、会话选择与消息状态由调用方更新 |
| `leading` | `ReactNode` | 否 | — | 标题左侧入口，如移动端侧栏开关；紧凑模式下与图标一起不收缩 |
| `compact` | `boolean` | 否 | `false` | 工作区页头：固定 `h-16`、省略描述、右侧操作区最多占 40% 宽 |
| `actions` | `ReactNode` | 否 | — | 自定义操作区：显式传入（含 `null`）时替代默认新会话按钮；右侧内容建议可收缩，避免长文本挤压标题 |
| `onNewSession` | `(() => void)` | 否 | — | 未传 `actions` 时的默认「新会话」按钮回调 |

### isIconImageSource 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `icon` | `string \| undefined` | 是 | — | 待判断的图标值；以 `http:`、`https:`、`data:`、`/` 或 `./` 开头时返回 true，其余值（含 emoji、普通文本和 undefined）返回 false。 |

返回 `boolean`，供图标展示复用。

## 导出与使用

本目录维护：AgentHeader、isIconImageSource。

包方式接入仍使用公开入口：

```tsx
import { AgentHeader } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add agent-header
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

同目录测试：[agent-header.test.tsx](agent-header.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/general/agent-header.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
