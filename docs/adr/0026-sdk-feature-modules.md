# ADR-0026：SDK 按功能组织源码与导入入口

## 背景

SDK 合包后，聊天、会话目录、上传和额度的实现分散在技术分层目录、`experience/` 与
`adapters/react/` 聚合文件中。维护单一功能需要跨目录查找。用户要求按功能组织，直接迁移
现有 import，不保留旧公开入口；SDK 当前仍是未发布的 workspace 包。

## 决策

1. 源码按聊天 `chat`、会话目录 `sessions`、文件 `files`、智能体目录 `agents`、用量
   `usage`、认证 `auth`、纯消息转换 `messages` 组织。功能 hooks 放在各模块的 `hooks/`。
   `stream` 与 `request` 为并列目录，Request 调用 Stream，复用现有读取实现；
   后端 `providers`、共享 `protocol` 继续独立，`state.ts` 复用查询与单飞。
2. React 仅允许位于六个功能模块的 `hooks/`、通用 `hooks/` 与 `providers/kit/react/`。
   六个功能 hooks 按能力命名；通用 `hooks/` 复用订阅、生命周期、查询工具和屏幕判断，
   不汇总功能 hooks。`KitProvider` 组件、Context 与 Kit Client 解析归 `providers/kit/react/`，
   不保留顶层 `react/`。`useLifecycle`、`useSnapshot`、`usePublicQuery`、
   `useOptionalKitContext`、`useResolvedClient` 保持内部使用。
   每项逻辑保留一份实现，测试随模块移动，跨模块合同测试放 `tests/`。
3. 公开入口与功能对应，完整清单以 `packages/sdk/package.json` 为准：
   - 数据：`/chat`、`/sessions`、`/files`、`/usage`、`/auth`、`/messages`、`/config`、`/state`；
   - 请求与后端：`/request`、`/stream`、`/providers`、`/providers/kit`、
     `/providers/session-events`、`/providers/bailian`、`/protocol`；
   - Hooks：`/chat/hooks`、`/sessions/hooks`、`/files/hooks`、`/agents/hooks`、
     `/usage/hooks`、`/auth/hooks`；通用 `/hooks` 只导出 `useIsMobile`；
   - Kit Context：`/providers/kit/react` 只导出 `KitProvider`、`useKitClient`、`useKitContext`。
   移除 SDK 根入口、`/adapters/react`、`/react`、`/request/stream`、`/bailian`；调用方、模板和文档同步迁移，
   不增加兼容重导出。函数、类型与后端协议行为沿用现有实现。
4. 文件位置不决定依赖方向。通用数据不依赖任何 React 模块；共享协议与状态不反向依赖
   功能流程；Stream、Request、Provider、Chat 继续单向依赖。Chat 核心不反向依赖 Composer。
   Provider 可以使用纯消息转换和 `sessions/load-directory.ts` 独立读取函数，不能引用
   会话工作流；目录读取只依赖协议和取消工具，不依赖 Client。
   `sdk-hooks-boundary` 将通用 `hooks/` 的仓库内依赖限制为自身、`state.ts`、`protocol/` 与
   `internal/`，禁止反向引入 KitClient、Context 或业务模块。
   `sdk-kit-react-boundary` 将 Kit React 接入的仓库内依赖限制为 Kit 自身，不得引入其他
   Provider 或功能流程；数据 Provider 的既有依赖边界不放宽。
5. `messages/` 只保存类型与纯展示转换：Provider 定义策略，Chat 调用策略并持有状态。
   仅显式使用 `/providers/bailian` 加载上游 SDK 的浏览器安全事件转换入口；其他功能入口
   不引入该转换依赖。业务组件与应用仍只能消费声明的公开入口。
6. Kit 默认路径、协议头和兼容接入保留在 `providers/kit`；迁移认证模块不代表其默认
   Kit 接入已泛化。Console 管理业务继续归应用，上游 SDK、业务接口和确认流程保持现有合同。

本决策替代 ADR-0023 的根入口、React 聚合路径与能力子路径，替代 ADR-0009 中
`providers/messages/` 的物理位置；单一 SDK 包、可选 React 与消息状态所有权等决策继续有效。

## 后果与验收

- package exports、构建入口、调用方 import、模板 alias 与 Skill API 模块表必须一致。
- 依赖检查按新的功能与叶子模块约束，不能把整个功能目录豁免为 React 或高层流程。
- 复用已有合同、取消、重连与生命周期回归；浏览器打包验证通用入口无 React/Node-only
  依赖、百炼入口不导入上游 SDK 主入口或 internal。
- 文档源码与导入方式同步，示例仍以 Skills 中的可编译代码为唯一源；实际结果记录在
  PR 描述或 CI artifact 中，不以目录迁移或编译成功代替行为验证。
