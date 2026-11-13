# Managed Agent 模型固定清单来源

依据 Managed Agent 模型接口的实际返回，在 Kit 中固定候选。
2026-11-01 20:50（北京时间），通过 CLI 源码提供的匿名公共目录调用读取
`listFoundationModels`。没有使用登录令牌或 Provider 凭据，没有创建资源。
这里只作一次性取证，产品代码不引入 CLI 依赖或控制台网关调用。

查询与百炼控制台的模型选择器保持一致：

```json
{
  "input": {
    "group": false,
    "pageNo": 1,
    "pageSize": 20,
    "ds_model_new_db": true,
    "supports": { "managedAgents": true }
  }
}
```

区域为北京、国内站。响应 `total=14`，本页 14 条，已包含全部结果；没有明确已下线或已到期的
推理下线标记，两项 `offlineInfo` 为空对象。原始取证仅保留模型 ID、名称与下线字段，
位于忽略目录 `.scratch/model-catalog/page-1.json`。

| 模型 ID | 显示名称 |
| --- | --- |
| `qwen3.8-max` | Qwen3.8-Max |
| `qwen3.8-flash` | Qwen3.8-Flash |
| `qwen3.7-plus` | Qwen3.7-Plus |
| `qwen3.7-max` | Qwen3.7-Max |
| `qwen3.6-plus` | Qwen3.6-Plus |
| `qwen3.6-flash` | Qwen3.6-Flash |
| `deepseek-v4.1-flash-1017` | DeepSeek-V4.1-Flash-1017 |
| `deepseek-v4.1-flash` | DeepSeek-V4.1-Flash |
| `deepseek-v4-pro` | DeepSeek-V4-Pro |
| `deepseek-v4-flash-0731` | DeepSeek-V4-Flash-0731 |
| `kimi-k3` | Kimi-K3 |
| `glm-5.3` | GLM-5.3 |
| `glm-5.2` | GLM-5.2 |
| `glm-5.1` | GLM-5.1 |

固定清单在 `apps/console/src/features/templates/managed-agent-models.ts`，普通模型保持接口顺序。
这是本次读取的公共候选快照，不代表账号已开通，也不会随远端目录自动更新。

智能模式补充为普通模型之前的四项，共 18 个选项。智能模式来自百炼控制台模型选择器的
`autoModelOptions`，不属于上述模型接口结果；显示名称和顺序与该数组一致。
控制台将选项的 `model` 原样保存，Kit 同样保存对应 ID。

| 保存 ID | 显示名称 |
| --- | --- |
| `auto` | AUTO |
| `balanced` | 均衡 |
| `economy` | 经济 |
| `performance` | 性能 |

当前安装 SDK 的公开 `listProviderModelsForContext` 对百炼返回
`supportsDynamicListing:false`，能力表的 `model.list` / `model.search` 也标记不支持。
Kit 本次仅调整模型选择 UI，不新增模型查询 API，不修改创建接口的 `model` 字符串合同。
