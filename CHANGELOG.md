# Changelog

## 未发布（首个公开版本）

OpenAgentPack Kit 的首个公开版本，提供搭建百炼 Managed Agent 体验页与管理端的全栈套件。

### 包含

- **SDK**：`@openagentpack/kit-sdk` 按聊天、会话、文件、智能体、用量与认证提供功能入口；
  会话运行时按 Stream → Request → Provider → Chat 分层，React 接入位于各功能 `hooks/`。
- **UI**：`@openagentpack/kit-chat-ui` 提供基于 Radix + Tailwind v4 的 copy-in 对话组件与
  冻结设计 token。
- **Server**：`@openagentpack/kit-server` 提供数据面 `/api/kit/*` 与控制面 `/api/admin/*`，
  支持 mock 与百炼 Managed Agent gateway。
- **应用**：`apps/web` 体验页、`apps/console` 管理端、`apps/docs` 文档站、
  `apps/desktop` Electron 桌面壳。
- **工具**：`pnpm kit:create` / `pnpm kit:add` 脚手架、OpenAPI 生成、Skill 生成与评测、
  桌面打包。
- **质量**：typecheck、Biome lint、Vitest、Playwright E2E、dependency-cruiser、文档一致性
  与零内网依赖检查。

### 说明

- 包当前以 workspace 方式消费，尚未发布 npm。
- 桌面壳为冒烟级：支持 mac / win 打包，签名、公证与自动更新待后续。
