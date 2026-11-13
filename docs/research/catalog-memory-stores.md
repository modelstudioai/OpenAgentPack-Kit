# 上架目录的记忆库与 Session 挂载合同

核对日期：2026-10-27。SDK：`@openagentpack/sdk@0.8.0-beta-7a98e0f-59c5b175-20261022`。
本记录区分官方合同、已安装 SDK 与参考产品；不将 Mock 测试称为真实挂载验证。

## 官方合同

[Managed Agent Memory Store](https://docs.agent.bailian.aliyun.com/en/managed-agents/context/memory-store)
规定记忆库是跨 Session 共享的持久资源，创建 Session 时挂载，之后不能修改挂载；最多
8 个库，每项说明上限 4096 字符。只读用于检索，读写还可将新内容写回原库，省略权限默认
`read_write`。挂载路径由 Provider 生成，不应套用文件的可编辑路径。

[Create Session](https://docs.agent.bailian.aliyun.com/en/api/managed-agents/session/create) 与
上述说明中的请求示例均使用：

```json
{
  "resources": [
    {
      "type": "memory_store",
      "memory_store_id": "memstore_example",
      "access": "read_only",
      "instructions": "需要项目约定时查询此库。"
    }
  ]
}
```

记忆资源 `type` 与现有文件兼容修正的 `file_resource` 不同，不能互换。当前实现保留仓库
已有文件 wire 及挂载路径；不借此更改文件历史合同。

## 已安装 SDK 的公开面与请求映射

- 主入口公开 `listMemoryStores(providers, provider, options)`、
  `getMemoryStore(providers, provider, id)` 和 `MemoryStoreInfo`、`MemoryPage`；通过
  `ProjectRuntimeContext.providers` 与 provider `bailian` 调用，不 runtime 导入内部模块。
- Bailian adapter 交给 `ProviderMemoryApi`，列表请求 `/memory_stores`，参数
  `limit`、`page`、`include_archived`。`preserveRawResponse: true` 保留远端分页与归档字段。
  Kit 每页 100 项，继续读取 `next_page`（兼容公开 `next_cursor`），按 ID 去重；
  `has_more` 却无游标或游标重复时报错，不能静默返回截断列表。
- `status=archived` 或非空 `archived_at` 均视为不可选择，详情保存校验采用相同规则。
  浏览器仅收到 ID 和名称，不收到 description、metadata、内容或原始响应。
- SDK 主入口的 `SessionMemoryStoreResource` 精确支持上述 wire。
  已安装包 `dist/chunk-T5S7HIHF.js` 的 Bailian `mapSession3` 把文件与记忆合并在同一个
  `resources` 数组，显式记忆资源保留 `memory_store_id/access/instructions`。
  Kit 沿用现有 `POST /sessions` 窄口子（原因见 `bailian-session-file-mount.md` 与
  `sdk-session-runtime.md`），仅在同一数组加入 SDK 公共类型约束的记忆项。

## 参考产品与 Kit 选择

只读参考百炼 Managed Agent 控制台新建会话页的资源字段与提交页：
每行选择一个库，配置权限和说明；最多 8 项，
`EMPTY_MEMORY_DRAFT.access=read_write`，说明 `maxLength=4090`。Kit 保留这些交互边界，
因此说明长度比 Provider 上限略紧；没有复制内部请求实现或引入其依赖。

2026-10-29 再次只读核对参考产品当前 `sessions-create/resource-fields/index.tsx`：
`MEMORY_MAX_COUNT=8`，通过“添加记忆”追加卡片，每张卡的 `Select` 绑定单个
`memory_store_id`，并非一个下拉框的多选模式；每卡权限、说明及上述默认值保持一致。
提交页将多张卡转换为 `resources[]` 中多个 `type: "memory_store"` 项。
新建模版运行时步骤复用 Kit 既有 `CatalogMemoryFields`，沿用逐项配置方式；当前只保留
草稿与摘要，尚未发送 Session 挂载请求。空草稿校验沿用 Kit 既有规则，不复制参考提交页的
静默空行过滤行为。

目录只保存 `memory_stores` 引用、权限与使用说明。省略字段保留，空数组清空 Kit 的追加
配置，不推断 Provider 默认资源行为。体验新会话只读服务端配置，客户端不能指定其他库或
提升权限；记忆内容由 Provider 持有。公开目录/广场投影到公开协议，不透出挂载配置和说明。
目录保存校验只读取记忆库详情元数据，不读取任何记忆条目或版本。

## 验证边界

SDK HTTP fixture 检查真实公开 SDK 发出的列表/详情请求、完整分页、归档排除、错误脱敏，
并检查新会话请求里环境、文件与两类权限记忆同时存在。Mock 集成检查保存与重启持久化、
省略/清空、权限边界及公开投影。本次没有创建远端记忆库或 Session，也没有读取记忆内容；
真实列表只读浏览器结果不能代替 Cloud 挂载验收。

后续真实验证已确认新 Session 的记忆库 ID、`read_only` 权限、说明及 Provider 分配的
挂载路径全部回显，且与环境、文件、密钥库共存。
测试 Session 已删除；本次未读取或写入记忆内容。

## 成员侧名称/描述投影（2026-11-13）

体验页资源面板需要「记忆库」展示：成员 Agent 详情新增 `AgentMemoryStore` 投影，仅含库名称
与描述，不含库 ID、访问权限、管理员说明或条目正文。服务端逐库调用 SDK 公开
`getMemoryStore` 只读元数据（不做条目分页扫描），描述经 `redactMemoryConfigurationText`
脱敏；缺失或已归档的库跳过，Provider 查询失败由路由整体降级省略。列表与广场仍不透出任何
记忆配置，条目正文仍只出现在管理端配置读取链路。注意 Agent 详情是目录配置快照：会话
创建后管理员调整配置不会改写既有会话的实际挂载。
