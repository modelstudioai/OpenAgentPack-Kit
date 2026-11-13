# ADR-0016：技能以内联 token 承载，结构化载荷随行，服务端合成模型可读指令

> 实现位置已由 [ADR-0020](./0020-fold-protocol-into-sdk.md) 从 `packages/protocol`
> 调整到 `packages/sdk/src/protocol`；语法与职责不变。

状态：已接受（2026-11-06）。本 ADR 定义体验页「/ 选择技能」功能的数据承载方式：输入框
形态、载荷形状、语法与原子删除合同；消息协议见 [`docs/protocol.md`](../protocol.md)
的「技能 token（skills 载荷与消息正文语法）」。

## 背景

需求是输入框输入 "/" 从当前 Agent 已绑定技能中选择，选择后在输入框光标处出现 chip 形态
的高亮标记，消息发送时把所选技能带给 Agent；消息流里 chip 要**穿插在文本流中、保持各自
插入位置**（与 Qoder 同款，2026-11-06 用户拍板，推翻了早期「chips 集中于正文前独立成行」
的方案）。

承载层受上游 SDK 现状约束（2026-11-06 核实）：

- `SendMessageRequestSchema` 只接受 `text`（≤32000）、`client_message_id?`、
  `attachments?`，zod 剥掉未知字段；gateway 只拼
  `[{type:"message", role:"user", content:[{type:"text", text}]}]`。
- SDK `SessionEventInput` 虽是宽松 Record，但模型只看得见 text；SDK **没有 skill 专属
  事件类型**，技能执行以通用 function_call/tool_call 出现。「结构化字段进事件」无现成通道。
- gateway 发什么 text，事件回显就是什么 text（回显即用户气泡正文）——合成文本必须同时
  服务模型（可读指令）与展示（可解析、位置保真）。
- skill 名非严格 kebab-case（`skill_id` 允许大写/下划线），纯词法解析有误匹配风险。

## 决策

1. **文本内 token 承载选择**：选择技能后在 Sender 文本的**光标处**插入 `/name ` 标记
   （`/` + 技能名 + 一个分隔空格）；标记是消息文本的一部分，位置即插入位置。**标记是原子
   整体**：光标落在标记内或紧随其后时，退格一次整体删除标记（含其后紧邻的分隔空格），不
   逐字母删；选区与标记相交时删除范围扩展到完整标记。技能列表以 prop 传入 Sender
   （成员侧来源 `GET /api/kit/agents/:slug` 的 `resources.skills`）；无已绑定技能时 "/"
   不弹层；裸 token（正文为空）可发送。
2. **输入框内联 chip 视觉**：Sender 输入内核用 contenteditable（`contentEditable` div）：
   DOM 是编辑态的源，value 是其序列化投影（serializeEditable ↔ renderValueInto 往返；
   React 只渲染空容器，SSR 安全）。已知技能的 `/name ` 标记渲染成 `contentEditable=false`
   的原子 chip 节点（书本 svg 图标 + 名称的靛蓝 pill），无「必须与标记文本等宽」的约束；
   消息气泡里的 chip 同款带图标。**分隔空格归 chip 所有**：序列化把 `/name `（含尾随
   空格）记为标记全长，渲染时吸收标记后的一个空格不落进下一文本节点——渲染、序列化、
   原子退格三方按同一合同处理，往返逐字节一致。粘贴只收纯文本（execCommand insertText，
   富文本 HTML 不进草稿）；IME 合成期间（isComposing / keyCode 229）不触发自定义键盘
   处理，合成回车用于确认候选词；空草稿归一化为真空 DOM（无占位 br/编辑残骸），光标
   回最前，编辑器未聚焦时清空草稿不抢全局选区。无独立 chip 行。
3. **结构化载荷随行**：`SendMessageRequestSchema` 新增可选 `skills?: string[]`（提交时
   从文本 token 派生的技能名数组），与 `text` 并列；无技能时省略。它是「用户选了哪些
   技能」的结构化意图，也是 gateway 转换的**授权名单**：只有出现在载荷里的技能名，
   其 `/name` 文本标记才会被转换。
4. **服务端单点转换**：体验与管理员调试共用的发送服务层在调 gateway 前，把 text 中
   载荷授权的 `/name` 标记转成协议 token `[使用 Skill:name]`（composeSkillDirective 纯
   函数）；`GatewaySendInput` 合同不变，mock 与 live gateway 自动行为一致。SDK 原生支持
   skills 后，只需把这一个函数换成原生传参，组件层不动。
5. **气泡按位置穿插还原**：MessageList 用 `parseSkillDirective(text, knownSkills)` 按
   已知技能名**精确匹配**切分 `[使用 Skill:name]` token，在其原位渲染同款 chip；token
   名不在已知列表（历史会话、第三方客户端产生的文本）时按原文显示。正文里手打的未知
   `/foo` 不在载荷授权名单内，不会被转换，也不受影响。
6. **语法冻结在 protocol**：token 常量与 compose/parse 纯函数放 `packages/protocol`（零
   React/DOM/Node）；core 乐观投影与发送服务层用同一 compose，保证乐观气泡与回显正文
   逐字节一致。

## 理由

- 文本内 token 是唯一同时满足「模型可读」「位置保真」「回显即正文」的载体：token 随
  text 往返，气泡按位置还原不需要额外通道；gateway 转换只动一个函数。
- `skills` 载荷作为授权名单而非冗余：手打的未知 `/foo` 不被误转换；SDK 原生支持后，
  载荷即原生传参的形状，组件层 API 不动。
- 原子删除合同来自用户拍板：技能是整体概念，逐字母删除会把文本编辑退化成改错字；提及类
  编辑器（Slack/@mention）的标准行为。
- contenteditable 而非「透明 textarea + 覆盖层」：覆盖层要求 pill 视觉宽度与标记文本
  逐字节对齐（字体/行高/padding/滚动同步），chip 无法带图标，折行与贴边场景错位脆弱；
  contenteditable 真 chip 自由留白且可带图标，代价是重写 Sender 的键盘/光标/粘贴合同
  （原子退格、文本 offset 映射、纯文本粘贴），2026-11-06 用户拍板接受该成本。

## 后果

- `[使用 Skill:name]` token 语法成为协议合同的一部分：冻结后变更需考虑历史会话回显兼容。
  语法常量的任何改动只涉及 `packages/protocol` 与发送服务层。
- 输入框 token（`/name`）与协议 token（`[使用 Skill:name]`）是同一意图的两个形态：
  输入侧面向编辑，协议侧面向模型与展示；parse 只认协议侧。
- 指令是否真的触发技能执行**未经 live 验证**，登记为探针：P1（含 `[使用 Skill:x]` token
  的任务是否触发技能 function_call）、P2（无 token 对照）、P3（事件 metadata 回显保留）。
  P1 若为否，调整的是 compose 形态（如引导语），不推翻载荷形状与分层。
- mock gateway 经同一转换路径，本地 mock 与 live 行为一致。
- elements 的 chip 色板与动效进 `theme.css` 冻结 token；输入框与气泡 chip 同款（书本
  icon，web 资源面板 SkillIcon 同款 24 viewBox/1.5 描边，elements 内联自带 svg）。
- contenteditable 合同：宿主从 onChange 读到的 value 与渲染（chip ↔ `/name `）始终一致，
  投影 effect 在 DOM 偏离 value 时重建；jsdom 测试对 serializeEditable/renderValueInto
  往返与 SSR 容器形态断言兜底。

## 备选方案

- **指令头语法（`使用 Skill:a,b 正文`）**：一份头置文本服务模型与展示，实现最省，但
  chips 只能集中在正文前，无法还原插入位置；被「Qoder 同款位置保留」拍板推翻。
- **chips 集中正文开头（独立行或行内前置）**：语法与输入框不动，仅改渲染；不满足位置
  保留，已否决。
- **档 1（`/name` 标记文本 + chip 行镜像）**：位置保留但输入框是裸文本，无 chip 形态；
  用户明确要 Qoder 同款视觉，已否决。
- **透明 textarea + 覆盖层高亮**：保留受控 textarea 的键盘/IME 既有行为，但 pill 必须
  与标记文本逐字节等宽且无法带图标，字体/行高/padding/滚动多处同步脆弱；被
  contenteditable 真 chip 拍板推翻（2026-11-06）。
- **等待 SDK 原生支持再做**：需求已到；本方案在 SDK 支持后只需替换服务端 compose 一处。
  已否决。
