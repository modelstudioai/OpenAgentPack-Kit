# 上架目录的密钥库选择与 Session 绑定合同

核对日期：2026-10-28。SDK：`@openagentpack/sdk@0.8.0-beta-7a98e0f-59c5b175-20261022`。
只核对密钥库元数据与请求合同，不读取库内凭据或创建远端 Session。

## 官方合同

[Get Vault](https://docs.agent.bailian.aliyun.com/en/api/managed-agents/vault/get) 的
`GET /vaults/{vault_id}` 返回 `id`、`display_name`、业务 metadata、时间戳和 `archived_at`；
未归档时 `archived_at=null`。该接口是库元数据接口，凭据另有独立接口，本功能不调用。

[Create Session](https://docs.agent.bailian.aliyun.com/en/api/managed-agents/session/create) 明确
`vault_ids` 是顶层字符串数组，与 `environment_id` 和 `resources` 并列。Provider 根据库
绑定为会话提供凭据能力；不同库的凭据名称重名或前缀冲突可使创建请求失败。Kit 不读取
凭据做冲突预检，也不将这些拒绝当作成功。

```json
{
  "agent": "agent_example",
  "environment_id": "env_example",
  "vault_ids": ["vlt_example"],
  "resources": [
    { "type": "memory_store", "memory_store_id": "memstore_example", "access": "read_only" }
  ]
}
```

## 已安装 SDK

- 主入口公开 `listRemoteVaults(ctx, options)`、`getRemoteVault(ctx, id)`、`CloudVault`、
  `VaultPage` 与 `VaultListOptions`；后者支持 `limit/page/include_archived`。无需内部 runtime import。
- Bailian `listVaultResources` 使用 `/vaults`，传递上述参数；`getRemoteVault` 使用
  `/vaults/{id}`。`toCloudVault` 保留 `display_name`、`archived_at` 和原始 `attributes`。
  Kit 不返回 metadata/attributes，只投影 `{vault_id,name}`，空名称回退 ID。
- 列表每页 100 项，沿 `next_page` 遍历并按 ID 去重；缺失或重复游标报错。即使请求了
  `include_archived=false`，仍排除非空 `archived_at`（兼容原始 status 为 archived）。
  保存前逐项重新查询元数据，404 或归档项不可绑定。
- 已安装 SDK 的 Bailian `mapSession3` 在 `bindings.vault_ids` 非空时写入顶层
  `body.vault_ids`，独立于文件与记忆的 `body.resources`。Kit 在已有 `POST /sessions`
  窄口子中保留此形状，不新增其他 REST 路径，既有文件修正保持不变。
- SDK 的 Vault 详情路径直接拼接 ID；Kit 先限制 ID 为字母、数字、下划线和连字符，
  防止目录输入变成其他元数据或凭据路径。

## 参考产品与 Kit 边界

只读参考百炼 Managed Agent 控制台新建会话页的密钥库选择字段：
`VAULT_MAX_COUNT=10`，使用可搜索多选；提交页将
`values.vault_ids` 作为顶层 `vaultIds` 发送。Kit 保留选择既有库的交互与 10 项限制。
参考产品中的生成 API Key、创建 Vault、查询 Credential 和补齐变量功能不属于本次需求，
未复制或接入，也未引入内网依赖。

2026-10-29 再次只读核对参考源码：会话创建页的 `ENABLE_VAULT_SELECT=true`，入口已按
该开关渲染；`VaultSelectField` 明确设置 `mode="multiple"` 与 `maxCount=10`，支持搜索、
清空，未选时省略提交字段。工作流 Managed Agent 配置同样为多选、最多 10 项，默认空数组。
此结论针对当前源码，不代表线上部署状态。新建模版运行时步骤复用 Kit 的 `CatalogVaultField`，
保留 10 项选择边界，仅在页面草稿与摘要中保存名称和 ID，不接入参考产品的凭据查询或生成。

目录只保存 ID 数组，省略保留、空数组清空 Kit 追加配置。新体验 Session 只采用服务端
已上架目录的绑定；浏览器不能指定其他库。公开目录与广场仅投影公开协议，不返回绑定 ID。
该配置仅影响后续会话；空数组不推断 Agent 默认资源的语义，Provider 凭据始终不进入 SQLite。

## 验证边界

SDK HTTP fixture 检查实际公开 SDK 的完整分页、归档过滤、仅元数据请求、错误脱敏和
Session 顶层字段；Mock 集成验证保存、迁移、数量边界、清空及成员请求隔离。
真实列表只读浏览器验收不代表实际 Session 凭据注入或远端执行验收；本轮未创建远端
Vault/Session，未读取 Credential 或密钥内容。

后续真实验证已确认新 Session 顶层 `vault_ids` 与环境、文件及记忆资源共同回显。
测试 Session 已删除；此证据证明库绑定成立，不证明外部凭据调用或凭据值注入过程。
