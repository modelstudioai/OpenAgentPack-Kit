# 测试与验收

本文说明仓库的测试分层、常用命令和真实 Cloud 验证规则。具体功能的验收用例随测试代码维护；
逐次验证证据放在 PR 描述或 CI artifact 中，不提交到仓库。

## 分层与职责

| 层 | 命令 | 覆盖 |
| --- | --- | --- |
| SDK 数据层 | `pnpm --filter @openagentpack/kit-sdk test` | SSE 帧编解码、快照归并、`event_id` 去重、重连与 `after` 续传、工具审批、确认令牌 |
| chat-ui | `pnpm --filter @openagentpack/kit-chat-ui test` | 消息渲染、执行过程、附件与快捷指令、审批交互、空态与禁用态 |
| server | `pnpm --filter @openagentpack/kit-server test` | 路由与权限、身份归属、确认闸门、事件不落库、OpenAPI 一致性 |
| gateway 合同 | 同上（`tests/fixtures/`） | Provider HTTP/SSE 映射；Mock 与 SdkGateway 跑同一套契约 |
| web / console E2E | `pnpm e2e` | 对话、重连、归档/删除、附件、管理端 plan → 确认 → 执行 |

> Provider HTTP/SSE 合同由 gateway 层 fixture 保护；上层 hooks 测试不重复断言同一份映射。

## 本地门禁

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check:architecture
pnpm check:docs
pnpm check:no-inner-deps
pnpm gate          # 以上全部
pnpm verify:push   # pre-push hook 子集
```

当前仓库不提供 CI 流水线配置；验收在本地执行 `pnpm gate` 与 `pnpm e2e`，结果记录在 PR 描述中。
本地 hook 可被 `--no-verify` 绕过；后续接入 CI 时需单独配置并核实实际运行结果。

Mock 端到端：

```bash
KIT_GATEWAY=mock pnpm dev
```

Playwright：

```bash
pnpm e2e
```

## 测试归属与保真

- 新增测试先写清保护的用户流程、业务不变量、模块/Provider 合同或历史缺陷。
- 通过公开接口或可观察结果验证；删除依赖实现步骤、与其他层重复的测试。
- 负向断言先证明目标路径可达：权限测试显示资源确实存在；异步 UI 测试等待初始化与事件处理完成。
- 闸门测试必须覆盖「无 confirmation token 被拒」与「有 token 通过」两条路径。
- 去重与重连覆盖「历史回放 + 实时流」交叉到达（`event_id` 重复）与 `after` 游标续传。
- 静默断流与显式 `done` 是不同场景，不能用发送 `done` 的 mock 证明自然断流。

## 真实 Cloud（live）

- 使用仓库 `.env`，不输出、不修改、不提交凭据；日志与错误消息中的 key 必须脱敏。
- 只在显式设置 `KIT_LIVE=1` 时运行；CI 默认跳过，由受保护变量启用。
- 资源使用唯一前缀 `kit-live-<yyyymmddHHMM>-`，并写 metadata `{ "kit": "live-validation" }`。
- 结束后删除临时 Session 与 Agent；Environment 因引用关系拒绝删除时按 Provider 协议归档。
- 验证证据写 PR 描述或 CI artifact，包含命令、结果和脱敏后的关键字段；不提交真实资源 ID。

```bash
KIT_LIVE=1 pnpm --filter @openagentpack/kit-server exec tsx tests/live/smoke.ts
```

## 文档与生成物

- `pnpm check:docs` 校验文档中的 `pnpm <script>` 存在、每个包有 `AGENTS.md`、
  `docs/interfaces.md` 的 ✅ 行与 `apps/server/openapi.json` 路径一致。
- `pnpm gen:openapi` 生成 OpenAPI 与 API 类型；`pnpm gen:skills` 生成 Skill 参考与示例。
- 构建产物、缓存与 `.scratch/` 不入库。

## 风险驱动验证

新增或修改测试前，明确它保护的用户流程、业务不变量、模块/Provider 合同、恢复路径或历史缺陷；
选择最少的代表性成功、拒绝、边界和失败场景。类型保证、简单透传和框架默认行为无需独立测试。
