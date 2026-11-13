# ADR-0005：elements 采用 copy-in registry 形态

> 命令载体已由 [ADR-0022](./0022-repository-scripts-not-cli-package.md) 调整为
> `pnpm kit:add`；copy-in registry 的产品决策不变，本文保留当时的命令表述。

## 背景

自研协议（ADR-0001）意味着不能直接用 AI Elements 组件。组件如何交付有三种形态：
copy-in registry（用户把组件源码复制进自己项目）、npm 带样式组件包、只出 headless
primitives。

## 决策

1. `@openagentpack/kit-elements` 以 **copy-in registry** 为主要形态（对齐 shadcn/AI
   Elements 的分发方式），同时保留 npm 包形态便于直接依赖与版本升级。
2. 组件基于 `@radix-ui/react-*` + Tailwind v4 + CVA；设计常量冻结在 `theme.css` 的 CSS
   变量里，业务代码不得新增颜色/间距/圆角/阴影常量。
3. **headless 与视觉严格分层**：状态与行为在 `kit-core` / `kit-react`，`kit-elements`
   只做渲染与交互；组件内部不得 `fetch`，数据一律来自 hooks。
4. **新组件门槛**：必须有至少一个真实调用方（`apps/web`、`apps/console` 或 templates），
   不为预建需求做组件库。
5. 破坏性操作组件必须提供 AlertDialog 语义（apply/destroy/publish/下架/删除会话）。

## 理由

- 体验页是用户产品的一部分，需要能改到像素级；copy-in 让定制不受发版节奏限制。
- headless 与视觉分层保证 `kit-react` 可被任意 UI（含未来 RN 原生 UI、第三方设计体系）
  复用，也让 M6 的 WebView 策略有退路。
- 冻结 token + Tailwind 工具类避免样式散落，是管理端与体验页视觉一致的前提。

## 后果

- 需要维护 registry 清单（组件名 → 文件 → 依赖）与 `agents-kit add <component>` 复制命令。
- copy-in 后用户改动的组件不再随 kit 升级；需要在文档里给出「升级 diff」指引（M4）。
- 管理端的重控件（表格、树、代码编辑器、diff 视图）也要按同一套规范自建，M3 成本上升
  （与 ADR-0002 的后果叠加）。

## 备选方案

- npm 带样式组件包：升级方便，但深度定制受限于 CSS 变量。
- 只出 headless primitives：包最小，但「帮用户快速搭出体验页」的开箱效果差。
