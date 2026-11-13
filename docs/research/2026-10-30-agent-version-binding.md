# 智能体版本查询与会话绑定合同

核对日期：2026-10-30。安装版 SDK：`@openagentpack/sdk@0.8.0-beta-66f892f-59c5b175-20261028`。
本次证据来自已安装 SDK 公开声明、对应 Provider mapper 与官方文档；未创建真实 Cloud 资源。

## 官方版本与创建会话语义

[Agent API 总览](https://help.aliyun.com/en/model-studio/agent-api/) 说明远端 Agent 初始版本为 1，
更新后递增；`GET /agents/{id}` 默认读取当前版本，`?version=N` 读取历史版本。
历史版本由 `GET /agents/{id}/versions` 分页提供。没有证据表明 0 是可选历史版或 latest 别名。

[官方版本管理指南](https://help.aliyun.com/en/model-studio/managed-agents-prompt-versioning) 明确
`POST /sessions` 的 `agent` 字段可用字符串 ID，也可用 `{id,version}` 对象。字符串或省略对象
中的 `version` 表示创建时解析最新版本；指定数字表示精确选择历史版本，不存在时返回 404。
Session 生命周期内保留创建时的快照；顶层 `version` 不会绑定历史版本。

同一指南展示版本列表条目为 `{agent_id,version,created_at,config}`，`config` 是完整原始配置，
不能直接传给浏览器。Kit 只投影可选择的正整数 `version`，历史详情另按 ID 与版本查询。

```json
{
  "agent": { "id": "agent_example", "version": 1 },
  "environment_id": "env_example"
}
```

## 已安装 SDK 的公开边界

以下路径均相对 `apps/server/node_modules/@openagentpack/sdk/`；仅用于核对安装产物，
产品代码通过包主入口导入，不导入任何 `internal/*` 或 `dist/*` 路径。

- `dist/index.d.ts`：`listRemoteAgentVersions(ctx,id,options)` 公开返回 `AgentPage`；
  `getRemoteAgent(ctx,id,{version?:number,signal?})` 公开支持指定版本详情。
- `dist/session-thread-Divtwxk4.d.ts`：`AgentVersionListOptions` 为 `CursorListOptions`，
  参数为 `limit?:number/page?:string`；`AgentPage` 为
  `{data:CloudAgent[],has_more:boolean,next_page?:string}`。
- `dist/chunk-XKWSEQLN.js`：Bailian adapter 将详情版本转换为 `?version=N`，版本列表使用
  `/agents/{id}/versions?limit=100&page=…`；游标从 `next_page` 读取。`toCloudAgent` 只将
  数字 `version` 映射到公开字段，历史列表没有 `id` 时仍能读取版本号，不能按 ID 去重。
- `dist/index.d.ts` 的 `SessionCreateOptions` 没有 Agent 版本选项；Bailian `mapSession3`
  也只序列化字符串 `agent`，不能用类型断言向 SDK 创建接口补参数。现有 Kit Session 创建
  REST 窄入口增加对象形状，继续使用同一个 `POST /sessions`，不新增远端调用路径。

## Kit 校验与兼容边界

版本列表沿全部游标读取，按版本去重并降序，缺失或循环游标拒绝返回截断结果。非法版本
不转为最新。保存及调试前读取精确版本详情，核实返回 ID 与版本一致；404 或归档不可用，
Provider 故障和版本不匹配不得静默回退。SDK 原样拼接 ID，因此查询前拒绝路径与查询字符。

显式绑定使用新增 `agent_version` 正整数；省略表示创建时跟随最新版本。旧模版的
`remote_agent_version` 是展示快照，不能迁移成固定绑定。模版本地配置的 `version`、
远端 Agent 的 `agent_version` 与这项历史展示快照分别保留各自语义。

只读参考百炼 Managed Agent 控制台前端共享类型（agent.ts）与请求层：
历史列表消费数字版本，详情接受字符串化数字或 latest；
其内部请求层会丢弃版本分页游标，不能作为 Kit 完整版本列表的实现。参考产品的部署版本选择
与 Session 创建请求是不同合同；本次没有复制其请求代码或引入内部依赖。

## 2026-11-01：历史配置只读详情

本次继续核对同一安装版 SDK。`CloudAgentSchema` 公开 `model/system/tools/skills/mcp_servers`、
`description/created_at`；Bailian `toCloudAgent` 直接读取响应顶层同名字段，同时在 `attributes`
保留原始响应。因此 `GET /agents/{id}?version=N` 返回普通 Agent 形状时可直接投影；若历史形状
含 `config`，公开配置字段可能缺失，只从 `attributes.config` 回补明确允许的字段。

Kit 新增管理员只读详情接口，仍调用公开 `getRemoteAgent`，不增加直接 HTTP 路径。
版本列表仍只返回版本号；抽屉按需请求具体版本，详情核验 Agent ID 与版本，不使用列表的名称或
当前 Agent 配置代替历史快照。字段只投影名称、版本、描述、创建时间与模型/指令/工具/Skill/MCP。
配置树递归隐藏凭据、请求头、环境变量、命令参数，并移除 URL 认证、查询与片段；不传原始
`attributes`、`metadata` 或其他未知顶层配置。该只读脱敏规则比项目声明编辑严格，不保留凭据编辑例外。

证据与验收通过 SDK HTTP fixture 覆盖普通形状、历史 `config` 形状、精确版本与敏感字段过滤；
未调用真实 Cloud，不能据此声称验证了实际云端历史配置响应。

## 2026-11-01：Skill 引用的展示名称

同一安装版 SDK 的 `toCloudAgent` 原样保留响应 `skills`，不保证每个引用带有名称。
`dist/index.d.ts` 公开 `getRemoteSkillVersion(ctx,id,version)`，返回的 `SkillVersionInfo`
包含 `skill_id`、`version` 与可选 `name`；Bailian adapter 经
`GET /skills/{id}/versions/{encodeURIComponent(version)}` 读取，`toSkillVersionInfo` 从响应顶层
投影这些字段。`getRemoteSkill(ctx,id)` 则读取 `/skills/{id}` 元数据，返回当前名称而非历史快照。
这两项都可从 SDK 主入口使用，无需内部导入或直接 HTTP 调用。

只读参考 infra 的 `components/agent-config-view/index.tsx` 与
`components/use-query-skill-detail.ts`：其详情按 Skill code 与绑定版本批量反查名称，不直接依赖
Agent 引用携带的名称。Kit 不复用该内部 batch 接口；已有可读名称优先，缺名或名称等于 ID 时
在服务端通过公开 SDK 按精确版本补齐，仅无版本引用使用当前元数据。纯字符串声明是名称，
不作为远端 ID 请求。返回身份或版本不匹配、查询失败均保留原引用，不能拿最新版名称替代指定版本。

SDK 未编码 Skill ID，Kit 在查询前限制其路径字符；具体版本排除点路径与 `latest`。
同次请求按 ID/版本去重、最多并发四项，只复制名称并经过已有脱敏规则，不透传正文或原始属性。
SDK HTTP fixture 覆盖精确版本、数字版本、重复引用、名称别名、纯字符串、失败降级与敏感名称；
本次未调用真实 Cloud。
