# ADR-0021：将 elements 包重命名为 chat-ui

## 背景

`@openagentpack/kit-elements` 是一个过于宽泛的名字。它主要服务 Chat 产品体验，但 `<table>`、
`<select>`、DOM element 等语境也让 `elements` 无法说明包的职责；在包清单、依赖图和 copy-in
命令里都需要额外解释。

包内主体是 Chat 对话链路：消息、Markdown、执行过程、工具审批、输入框、附件、会话目录和
Agent 信息。另有 `Layout`、Agent 广场和用量可视化等外围组件，它们服务同一 Chat 产品外壳，
不是独立于 Chat 的另一套通用设计系统。

## 决策

1. 目录从 `packages/elements` 改为 `packages/chat-ui`。
2. 包名从 `@openagentpack/kit-elements` 改为 `@openagentpack/kit-chat-ui`。
3. copy-in registry 的名字与 schema 同步改为 `kit-chat-ui`；`theme.css` 与 `registry.json`
   子路径保持不变。
4. `scripts/kit`、Skills API 抽取、Tailwind `@source`、模板 alias、文档和依赖声明全部同步。
5. 不改变组件实现、公开组件名或 registry 组件键；这是命名与归属调整，不是 API 行为变更。

## 理由

- `chat-ui` 直接说明组件服务 Chat 产品，避免与 DOM element 或通用设计系统混淆。
- 保留独立的 `theme.css` 与 copy-in registry，继续支持组件源码复制和设计 token 冻结。
- 统一包名后，使用方可以明确区分数据 SDK（`kit-sdk`）与视觉层（`kit-chat-ui`）。

## 后果

- 所有 import、workspace dependency、package filter、CSS `@source`、Vite alias 和 Skills 生成物
  需要一次性迁移。
- 包内仍保留会话导航、Agent 发现和用量可视化；它们是 Chat 产品外壳组件，不作为纯消息组件
  对待。若未来需要独立通用 UI 包，应按真实复用需求另拆，而不是恢复 `elements` 泛名。

## 备选方案

- 保留 `elements`：名称泛化，无法表达 Chat 产品边界，已否决。
- 只改目录、不改包名：会造成路径与 import 语义不一致，已否决。
- 改名为 `components`：仍然过于泛化，且无法区分数据层与视觉层，已否决。
