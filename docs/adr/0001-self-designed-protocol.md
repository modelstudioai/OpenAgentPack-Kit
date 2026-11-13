# ADR-0001：自研协议与 hooks，事件契约复用 SDK SessionEvent

## 背景

kit 需要一套「前端 ↔ Node server ↔ Provider」的流式协议。Vercel AI SDK（`ai@7`、
`@ai-sdk/react@4`）提供成熟的 UI Message Stream 与 `useChat`，AI Elements 提供配套组件。
但 managed-agent 的语义比「一次性 LLM 补全」宽：Session 有生命周期与状态机、Event 是开放
类型集合（工具/MCP/线程/状态/中断/结果评估）、有 Artifact 文件交付、有多 Agent 子线程、
有 Deployment 与 Operation 这类长任务，且 RN 原生 `fetch` 不支持流式响应体。

## 决策

1. **不依赖 AI SDK 运行时**：协议帧、hooks、状态机、重连与去重、host bridge 全部自研，
   只借鉴 ai-sdk.dev 的 DX 与文档组织、AI Elements 的 copy-in 组件形态。
2. **事件语义不重造**：canonical event 直接采用上游 `@openagentpack/sdk` 的 `SessionEvent`
   契约；浏览器侧只通过 SDK 的 `./session-events` 子路径（其自身声明为 browser-safe）或
   `import type` 复用，前后端共用同一条 raw → `ProviderSessionEvent` → `SessionEvent`
   映射管道。
3. 传输用 `fetch` + `ReadableStream` 读 SSE，不用 `EventSource`（理由见 `docs/protocol.md`）。

## 理由

- 避免把 session/thread/artifact/operation 语义硬塞进上游协议的 metadata，也避免被上游
  breaking change 牵着走（AI SDK 一年内经历 v5→v6→v7 三次主版本）。
- 复用 SDK 契约则避免了「同一份 provider 事件在前后端有两套解析」的经典 bug 源，并且天然
  继承上游对未知事件类型的宽容处理（开放联合，不丢帧）。
- 自研传输层让四端（浏览器/H5/Electron/WebView）行为一致，且能自带 `Authorization`。

## 后果

- 需要自己维护 SSE 解析、重连、去重、乐观消息与其测试（已在 `docs/protocol.md` 固化规则）。
- 不能直接使用 AI Elements 组件；kit-elements 需自建（见 ADR-0005）。
- 与 AI SDK 生态互操作需要额外适配层（暂不做，若社区有需求再加 `kit-ai-sdk-adapter`）。

## 备选方案

- 直接依赖 `ai` + `@ai-sdk/react`：上手最快，但语义受限、上游协议演进风险高。
- 完全从零发明事件模型：会与 SDK 的 provider 映射分叉，双份解析必然漂移，已否决。
