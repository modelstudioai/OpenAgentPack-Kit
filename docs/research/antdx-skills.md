# Ant Design X Skill 组织参考

核对日期：2026-10-20。证据为上游仓库 `main` 的公开文件，引用会随上游更新；本文只记录
本轮采用的组织方式，不把上游 API 或安装流程视为 Kit 的现行规范。

## 上游证据

| 文件 | 观察 |
| --- | --- |
| [x-components/SKILL.md](https://github.com/ant-design/x/blob/main/packages/x-skill/skills/x-components/SKILL.md) | 组件选择、组合模式与 API 参考分开组织；入口按用途引导阅读详细参考，并包含静态子组件 |
| [use-x-chat/SKILL.md](https://github.com/ant-design/x/blob/main/packages/x-skill/skills/use-x-chat/SKILL.md) | 假设已有 Provider，重点介绍 Hook 状态、请求、错误与多会话使用；把接口适配交给另一个 Skill |
| [x-chat-provider/SKILL.md](https://github.com/ant-design/x/blob/main/packages/x-skill/skills/x-chat-provider/SKILL.md) | 先判断是否可用内置 Provider 或透传，再指导自定义请求与消息转换；与 Hook 使用教程分开 |

三份文件均使用带 `name`、`description` 的 Markdown 入口，通过参考文件渐进展开细节。
这里借鉴职责拆分和阅读路径，不复制上游正文或代码。

## Kit 对应方式

- `kit-components` 根据 Kit 实际公开导出覆盖组件、静态子组件与兼容别名；不因为 Ant Design X
  存在某个组件就声明 Kit 也有。样式继续遵循 Radix、Tailwind 与冻结 token，不引入 antd。
- `use-kit-chat` 介绍 Kit 的持久 Session 订阅、发送、停止与工具审批。Ant Design X 的
  消息编辑、重新生成、请求队列等接口不属于当前 Kit API，不能按相似名称套用。
- `kit-chat-provider` 遵守 Kit 的五方法合同；原始百炼 SSE 由 Kit 接入层调用 SDK 公开转换器。
  上游 X 的 Provider 转换方法不能代替 Kit 的历史、真实 ready、审批与取消合同。

本轮采用英文 Skill 与独立目录交付，API 结构从 Kit TypeScript 公开面生成，示例先类型检查
再同步到文档站。安装器、个人目录自动覆盖和 npm 发布不在范围内。当前维护规则见
`docs/repository-layout.md`，验收要求见 `docs/validation.md`。
