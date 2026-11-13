# OpenAgentPack-Kit Agent 规则

本文件适用于当前独立仓库的全部工作。执行和验收不依赖父目录的文档、workspace、全局
skill 或个人环境；所有产品代码、配置和测试写入本目录。

人类读者与 coding agent 读者同等对待：本文件是入口，权威细节在下面列出的文档里。

## 权威顺序

执行本目录工作时按以下顺序解决冲突，靠前的胜出：

1. `docs/adr/`：已接受且难以撤销的决策；
2. `docs/architecture.md`：进程、分层、依赖方向；
3. `docs/repository-layout.md`：源码与测试放置；
4. `docs/interfaces.md`：跨层接口与 op 对照表（新增后端操作的唯一真相）；
5. `docs/protocol.md`：SSE 帧、重连、去重、错误模型；
6. `docs/validation.md`：验收矩阵与真实 Cloud 规则；
7. 包级 `AGENTS.md`（`packages/*/AGENTS.md`、`apps/*/AGENTS.md`、
   `templates/*/AGENTS.md`）：该包局部约定。

历史实现（百炼 Managed Agent 控制台前端、早期体验站原型与旧版服务端）只作为设计参考与
历史教训，不是本规范，也不要从中复制代码。

## 执行红线

遇到以下情况必须停止并记录阻塞（在 PR 描述里写明），
不得自行改变架构：

- 需要 runtime import `@openagentpack/sdk` 的 `internal/*` 路径（SDK 只导出公开面；
  浏览器侧只允许 `import type` 或 `@openagentpack/sdk/session-events` 子路径）；
- 需要在 `packages/sdk` 的数据入口或 `src/protocol` 子入口引入 React、DOM 或 Node-only API；
  React 只允许出现在 `packages/sdk/src/hooks/`、`src/providers/kit/react/` 与
  `chat/sessions/files/agents/usage/auth` 六个功能模块的 `hooks/` 子目录（ADR-0026）；
- 需要私自定义第二套事件模型，而不是复用 SDK 的 `SessionEvent` 契约；
- 需要把 `BAILIAN_API_KEY`、vault credential 或任何 provider 凭据下发到浏览器、写入
  仓库、写进日志或错误消息；
- 需要绕过 `plan → 显式确认` 闸门执行 `apply` / `destroy` / `publish` / 上下架，或代替
  用户补 `--yes` / `confirmed: true`；
- 需要引入内网包（`@ali/*`、`@alife/*`）、内网域名或内网网关私有协议与固定密钥注入；
  需要在 `apps/console` 之外引入 antd（antd 仅限管理端，见 ADR-0015）；
- 前端需要假设与 server 同源（必须走 `/api/config` 注入的 `apiBaseUrl`）；
- 需要把事件正文落库（Provider 是事件与消息的唯一事实权威；SQLite 中的临时资源声明与 SDK state 见 ADR-0017）；
- 需要为第二个 provider 抽象行为，却还没有它的真实数据面合同。

## UI 实现规范

涉及 `packages/chat-ui`、`apps/web`、`apps/console` 的视觉与交互时：

1. **优先复用 `@openagentpack/kit-chat-ui` 既有组件**。缺少 Primitive 时，按
   `@radix-ui/react-*` + Tailwind v4 + CVA 自研，并在 PR 里记录「官方/既有组件为何不够」。
   `apps/console` 例外（ADR-0015）：新代码 antd v6 优先；但对话链路组件（消费
   SessionEvent/消息分片/会话状态）一律 kit-chat-ui，例外需在 PR 记录理由；页面已存在
   且好用的 chat-ui 用法不强制替换，迁移以页面为单位渐进进行。
2. **所有视觉样式使用 Tailwind 工具类 + `theme.css` 冻结 token**。消息分片会随累计快照替换或删除，
   必须使用 SDK 提供的稳定分片 id；`noArrayIndexKey` 关闭仅兼容静态示例，不能用于动态快照列表。禁止手写 `.css` 文件
   或内联 `<style>` 添加样式；业务代码不得引入新的颜色、间距、圆角、阴影等设计常量。
   console 中 antd 组件的内部样式豁免本条：token 统一归口到 console 唯一的 antd 主题配置
   文件（对齐管理端中性色板，与 `theme.css` 互不引用），页面级布局样式仍走 Tailwind 工具类。
3. **破坏性/不可逆操作**（apply、destroy、publish、下架、删除会话）必须使用 AlertDialog
   语义组件，不得使用普通 Dialog，且必须先展示 plan diff。
4. **新组件进入 chat-ui 的门槛**：必须有至少一个真实调用方（`apps/web`、`apps/console`、
   `apps/storybook` 或 templates）。只为准需求预建组件库是过度设计。
5. **组件不得依赖 server**，也不得在组件内部直接 `fetch`；数据一律经 SDK 各功能模块公开的 `/hooks`。
6. **组件状态变化必须有过渡动效**（弹层、展开/收起、入场、悬停等，目标是丝滑不生硬）：统一
   消费 `theme.css` 冻结的 `--kit-duration-*` / `--kit-ease-out` / `--kit-animate-*` token 与
   `<details>` 高度过渡基类 `.kit-collapse`，并在 `prefers-reduced-motion` 下整体降级为无动画。
   时长/缓动/keyframes 同样冻结在 `theme.css`，业务代码不得内联新常量或手写 keyframes。
7. 修改 chat-ui 后必须运行：`pnpm typecheck`、`pnpm lint`、`pnpm --filter @openagentpack/kit-chat-ui test`，
   并检查调用方 app 的相关测试。

## 文档与工作记录

- 新增或大幅修改的项目文档使用中文；标识符、命令、路径、Schema 字段和必要的上游原文
  保留原语言。对外发布时补英文版。
- 现行规则只写入上面的权威文档；不要新建平行的「说明文档」承载规范。
- 长期上游证据（provider 行为、SDK 源码结论、外部调研）放 `docs/research/`；
  验收证据放 PR 描述或 CI artifact，不提交逐次记录；难以撤销的决策写成
  `docs/adr/NNNN-*.md`。
- 临时探针、补丁、截图和个人计划放被 gitignore 的 `.scratch/`，不作为现行规范的依赖。
- 改了行为就改文档：新增后端操作要同步 `docs/interfaces.md` 的 op 对照表；改协议要同步
  `docs/protocol.md`；改分层要同步 `docs/architecture.md` 与 `.dependency-cruiser.cjs`。
  `pnpm check:docs` 会校验文档命令真实存在、每个包都有 `AGENTS.md`，以及
  `docs/interfaces.md` 的 ✅ 行与 `apps/server/openapi.json` 路径一致。

## 风险驱动验证与代码规模

新增或修改测试前，明确它保护的用户流程、业务不变量、模块/Provider 合同、恢复路径或
历史缺陷；通过公开接口或可观察结果验证。选择最少的代表性成功、拒绝、边界和失败场景；
删除已失效、依赖实现步骤或与其他层重复的测试。类型保证、简单透传和框架默认行为无需
独立测试。

测试归属与保真：

- Provider HTTP/SSE 合同由 gateway 层测试保护（替换网络响应的 fixture），不要让上层
  hooks 测试重复断言同一份映射。
- **静默断流与显式 `done` 是不同场景**：不能用发送 `done` 的 mock 证明自然断流或首帧前
  订阅完成。
- 去重与重连测试必须覆盖「历史回放 + 实时流」交叉到达（`event_id` 重复）与
  `after` 游标续传。
- 负向断言先证明目标路径可达：权限测试必须显示被限制的资源确实存在；异步 UI 测试必须等
  初始化与事件处理完成。
- 闸门测试必须证明「无 confirmation token 时被拒」与「有 token 时通过」两条路径。

修改前后检查目标文件及同目录测试规模。生产源码超过 800 行、测试或脚本超过 1000 行时，
按变化原因评估职责拆分（不按行数机械切文件）。自动生成文件、lockfile 和构建产物不计入。

## 真实 Cloud 验证

- 可使用本地 `.env`（从 `.env.example` 创建），不得输出、修改或提交凭据；日志与错误
  消息里的 key 必须脱敏。
- 测试资源必须使用唯一前缀（如 `kit-live-<yyyymmddHHMM>-`）和测试 metadata；测试完成后
  删除临时 Session 与 Agent。
- Provider 因引用关系拒绝删除 Environment 时，按 Provider 正式协议归档，并在 PR 描述或
  CI artifact 中说明原因。
- 没有凭据时用 `KIT_GATEWAY=mock` 跑端到端；live 测试默认跳过，由 CI 变量显式启用。

## 常用命令与门禁

```bash
pnpm install
pnpm setup              # git config core.hooksPath .githooks
pnpm dev                # server :8787 + web :5173 + console :5174 + storybook :3000
pnpm typecheck          # turbo tsc --noEmit + skills
pnpm lint               # biome check（warning 也挡，等同 lint:strict）
pnpm test               # 脚本测试 + vitest + skills
pnpm build              # turbo 构建各包与应用（tsup / vite / next）
pnpm check:architecture # dependency-cruiser 分层与依赖方向
pnpm check:docs         # 文档命令 + interfaces 对照表 + 包级 AGENTS.md
pnpm check:no-inner-deps # 内网包与内网域名扫描
pnpm gen:openapi        # 生成 apps/server/openapi.json 与 SDK API 类型
pnpm gate               # 完整本地门禁（= typecheck+lint+test+build+三项 check）
pnpm verify:push        # pre-push hook 跑的子集
```

`.githooks/`（`core.hooksPath`）提供 `commit-msg`（中文 Conventional Commits）、
`pre-commit`（暂存区 lint）、`pre-push`（`verify:push`）。**hook 可被 `--no-verify`
绕过，是便利不是强制。** 仓库不再提供 CI 流水线配置；完整验收使用 `pnpm gate`。

提交信息用简体中文，遵循 Conventional Commits：`<type>(scope): <description>`，每行不超过
100 字符；scope 用包名短称（`sdk`、`chat-ui`、`eval`、`server`、`web`、`console`、
`storybook`、`docs`、`skills`、`repo`）。

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
