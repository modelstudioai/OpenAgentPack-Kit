# ADR

难以撤销的决策记录在此。格式：背景 → 决策 → 理由 → 后果 → 备选方案。
新 ADR 递增编号，废弃的 ADR 保留原文并在开头标注「已被 ADR-NNNN 取代」。

| 编号 | 决策 |
| --- | --- |
| [0001](./0001-self-designed-protocol.md) | 自研协议与 hooks，事件契约复用 SDK `SessionEvent` |
| [0002](./0002-internal-first-zero-inner-deps.md) | 零内网依赖、开源前不发布 npm 包 |
| [0003](./0003-node-sqlite-catalog-store.md) | catalog 用 SQLite（`node:sqlite`）+ store 接口抽象 |
| [0004](./0004-webview-shell-strategy.md) | 桌面与移动壳复用 Web 产物（历史；原生壳已退役） |
| [0005](./0005-copy-in-elements-registry.md) | elements 采用 copy-in registry 形态 |
| [0006](./0006-session-snapshot-stream.md) | 会话快照流、独立变更游标与工具审批使用协议 v2 |
| [0007](./0007-custom-bailian-chat-provider.md) | ChatProvider 接入自建百炼后端，原始 SSE 转换复用 SDK |
| [0008](./0008-stream-request-provider-chat.md) | Stream、Request、Provider、Chat 四层运行时与原始后端操作配置 |
| [0009](./0009-provider-message-transform.md) | Provider 定义消息转换策略，Chat 持有事件快照和会话状态 |
| [0010](./0010-local-member-directory.md) | 本地成员目录、加盐密码派生与创建时单次展示 |
| [0011](./0011-local-member-login.md) | 默认成员登录、可撤销令牌与跨成员数据隔离 |
| [0012](./0012-local-user-groups.md) | 本地用户组、双向成员关系与删除确认；分组暂不授予 Agent 权限 |
| [0013](./0013-template-config-versions.md) | 独立模版配置版本、编辑乐观锁与关联 Catalog 原子同步 |
| [0014](./0014-one-shot-resource-drafts.md) | 一次性资源批次、成功回执持久化与整批源码/state 清理 |
| [0015](./0015-antd-console-only.md) | antd 仅限管理端使用；对话链路一律 kit-chat-ui |
| [0016](./0016-skill-inline-token.md) | 技能以内联 token 承载、结构化载荷随行、服务端合成模型可读指令 |
| [0017](./0017-yaml-resource-drafts.md) | 模版资源批次采用数据库中的 YAML 声明与 SDK state 检查点 |
| [0018](./0018-retire-directory-projects.md) | 目录链路退役与显式凭据 |
| [0019](./0019-remove-host-bridge-package.md) | 宿主交互能力留在应用本地适配 |
| [0020](./0020-fold-protocol-into-sdk.md) | 共享协议并入 SDK 独立子入口 |
| [0021](./0021-rename-elements-to-chat-ui.md) | UI 包更名为 chat-ui |
| [0022](./0022-repository-scripts-not-cli-package.md) | 仓库命令归入 scripts，不再维护独立 CLI 包 |
| [0023](./0023-single-sdk-package.md) | 单一 SDK 包承载数据处理与 React 适配 |
| [0024](./0024-desktop-app-and-remove-mobile-ci-templates.md) | 原生壳与 CI 示例模板退役（含 desktop 目录迁移历史） |
| [0025](./0025-console-owns-admin-client.md) | 管理端持有控制面客户端，SDK 仅公开通用调用状态 |
| [0026](./0026-sdk-feature-modules.md) | SDK 按功能划分公开入口与 hooks |
| [0027](./0027-skills-source-and-generated-output.md) | Skill 改为源目录 + 生成物，不再作为 workspace 包 |
