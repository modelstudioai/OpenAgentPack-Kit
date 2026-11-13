# 文档

本目录是贡献者与维护者的工程文档；面向使用者的快速开始、概念、SDK、组件与 API 文档在
[`apps/storybook/content/docs`](../apps/storybook/content/docs)。

## 阅读顺序

1. [`architecture.md`](./architecture.md)：进程、分层、依赖方向与数据流。
2. [`repository-layout.md`](./repository-layout.md)：源码与测试放置规则。
3. [`interfaces.md`](./interfaces.md)：跨层接口与后端 op 对照表。
4. [`protocol.md`](./protocol.md)：SSE 帧、重连、去重、错误模型与确认令牌。
5. [`validation.md`](./validation.md)：测试分层、门禁与真实 Cloud 规则。
6. [`adr/`](./adr/)：已接受的架构决策与背景。
7. [`research/`](./research/)：Provider/SDK 公开合同与上游 API 证据。

## 维护约定

- 新增后端操作同步 `interfaces.md` 的 op 对照表；改协议同步 `protocol.md`；改分层同步
  `architecture.md` 与 `.dependency-cruiser.cjs`。
- 长期上游证据放 `research/`；难以撤销的决策写成 `adr/NNNN-*.md`。
- 验收证据放 PR 描述或 CI artifact，不提交逐次验收记录。
- `pnpm check:docs` 校验文档中的命令真实存在、每个包都有 `AGENTS.md`。
