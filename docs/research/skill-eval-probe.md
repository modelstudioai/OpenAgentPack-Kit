# 百炼 Managed Agents × Skill 评测：M0 live 探针记录（2026-10-23）

评测 workspace（ID 已隐去）；探针脚本与原始事件 dump 为本地一次性文件，不入库。
靶 skill：PRD to Prototype（skills.sh 包，
front matter name 不规范，探针用规范化副本 `prd-to-prototype`）。

## 1. 凭据与端点

- agentstudio 端点只挂在 `{workspace_id}.cn-beijing.maas.aliyuncs.com`；公共基址
  `dashscope.aliyuncs.com` 无该路径（404）。key 与 workspace 不匹配时全部端点
  `403 Endpoint.AccessDenied`（不是 401）——ingest 报错文案要区分这两种。
- judge/生成模型通道：`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
  同 key 可用（qwen3.8-max / qwen-max 均 200）。

## 2. Skill 上传与审查

- 链路：`uploadFile` → `createSkillFromFileId(file_id)`；SDK 对 `409 SKILL_FILE_NOT_FOUND`
  内置 4 次退避重试（文件就绪竞态），ingest 仍应在外层再包重试与可读文案。
- **命名/撞名错误发生在创建接口**：`409 {code:"11300025", message:"已存在官方相同SkillName"}`
  （原名 `PRD to Prototype` 与官方 skill 撞名；格式校验未单独观察到，ingest 一律先按
  百炼规范规范化 name：小写字母/数字/连字符 ≤64）。
- 审查 `checking → active` 实测 **约 4–6 分钟**（05:14:59Z 创建，05:20Z 前 active）；
  创建即分配 `latest_version: "1.0"`（checking 期也有版本号，可钉）。
- 轮询接口：`getRemoteSkill(id).status`；终态 `active | rejected`。pipeline 必须异步等待
  并展示进度（默认超时 10 分钟，可配）。

## 3. 挂载与触发观测（核心地基）

- 挂载：REST `POST /agents` 的 `skills:[{type:"customer", skill_id, version}]`；
  版本钉死生效（agent 回显 skill_id+version）。
- **触发判定信号**（正例 13 events / 负例 7 events 对照）：
  - 触发 = 存在事件 `type=tool_use`（raw_type `tool_call`）且
    `tool_name === "activate_skill"`、`tool_input` 解析后 `name === <skill name>`；
  - 紧随的 `tool_result`（raw_type `tool_call_output`）content 为
    `{"name":<skill>, "content":<SKILL.md 全文>}`——可二次校验加载内容版本；
  - 负例两者皆无（也无任何 tool_use）。
  - SDK 映射后的 SessionEvent 已带 `tool_name` / `tool_input` 字段，**无需读 raw**。
- 生命周期噪音：raw_type `model_request_start/end` 映射为 `unknown`，判定时忽略。
- turn 结束：`getSession(id).status === "idle"` 轮询可用（正例 full run 约 2 分钟内 idle）。

## 4. 清理语义

- session：`deleteSession` 可用；
- agent：**DELETE /agents/{id} 返回 405**，必须走 `archiveCloudAgent`（归档而非硬删）；
  eval pipeline 的清理阶段同理，run manifest 里记 archived 而非 deleted；
- skill：硬删除不可恢复（文档明言）——eval 默认**不删** skill，按 version 复用。

## 5. 对 pipeline 设计的直接结论

1. 触发指标可精确计算（activate_skill 事件），正/负触发集成立；
2. 审查分钟级 → run 前置「ingest 阶段」独立展示进度，且同一 (skill 内容哈希) 复用已上传
   version，避免每 run 重等审查（workspace 内建 content-hash → skill_id/version 索引）；
3. judge/生成走 compatible-mode chat，与 agentstudio 凭据同 key；
4. 产物回收：会话 artifact 经 files 列表 + download 拉回 workspace outputs/（v1 先收
   transcript + 文件清单，artifact 内容拉取放 M1 后半）；
5. 社区 `evals/evals.json` 的 assertions 在我们这里分两类执行：脚本断言
   （skill_activated / no_clarify_before_action / artifact 包含）+ judge 断言（带证据引文）。

## 6. 补探针（2026-10-23 下午）：沙箱能力与 agent 字段名

- **agent 创建的系统提示字段是 `system`，不是 `instructions`**（传 instructions 被静默忽略）；
- **沙箱工具不在 environment 上，而在 agent 的 `tools` 字段**：
  `[{type:"builtin_toolkit", default_config:{enabled,permission_policy}, configs:[{name:bash|read|write,...}]}]`；
  只挂 environment 不挂 toolkit 时，agent 自述「只有技能加载工具、无法写文件」；
- 评测 agent 默认配置：`system` + builtin_toolkit(bash/read/write, always_allow) + environment_id
  （cloud environment 由 run 自动创建并缓存到 workspace `env.json`，不随 run 清理）；
- 无人值守评测必须 `always_allow`：`always_ask` 会暂停等人工确认，run 会挂到超时。

## 7. 补探针（2026-10-23 晚）：评测 harness 自身的三个假失败根因 + 环境墙

1. **SDK 映射事件的 message content 是 string**（不是 content[] 数组）：朴素按数组取文本会丢
   全部正文，judge 在空 transcript 上判分 → 全假失败。toTranscript 已双形状兼容；
2. **judge 视图朴素整段截断（12k）**：大 write 载荷会把其后的确认表单/写入回执切出视野 →
   假失败。改为「消息全文保留 + tool payload 截头 600 字 + 总预算 30k」（judgeView，有单测复现该 artifact）；
3. **段超时 300s 对多阶段工作流 skill 不够**：原型生成段实测 5–11 分钟；默认改 600s 且支持
   单 case `timeout_ms`；工作流 skill 的确认门需要多轮 → case 支持 `followups` 脚本。

同口径（多轮 + 600s + fix-judge）对照：v1.0 与 v1.1 的 case1 均 0.71——v1.1 的流程语义项
（写入回执→确认表单→确认后原型）已被 judge 引证通过，证明 suggest→新版本→diff 闭环有效；
两版本共同败在**沙箱环境墙**：`mkdir /workspace/prototype` 报 `SANDBOX_CONNECT_FAILED`
（cloud sandbox 网络/实例不稳定）。这是环境故障不是 skill 缺陷。

**待办（下一增量）**：把 `SANDBOX_CONNECT_FAILED` 一类基础设施错误识别为 `infra_error`：
该 case 标记 infra 失败、自动重试一次、不计入 pass_rate 分母（或单独列 infra_flake 指标），
避免环境抖动污染 skill 评分。

## 8. 补探针（2026-10-24）：official skill、gen live、版本响应形状

- **official skill 挂载未验证（blocked by workspace）**：该 workspace 的
  `listRemoteSkills` 返回 0 条 official（全是 custom/模板 agent）；`type:"official"` 的挂载
  body 形状按官方文档（agent-create）实现，但触发形状未经 live 验证。换含官方 skill 的
  workspace 后补跑本地一次性探针即可。
- **`eval gen` live 验证通过**：对 weekly-report-polisher 起草 2 条 draft（1 条 task 变体、
  1 条 trigger_neg「合同条款」——准确利用了 description 的不适用场景），脚本断言名全部落在
  词表内（越界名字被丢弃策略生效）。
- **POST /skills/{id}/versions 响应不保证带 `version` 字段**：ingest 已加兜底——POST 成功后
  回查 `listRemoteSkillVersions(limit 1)`（newest first）取版本号；仍取不到才报错。

## 9. 补探针（2026-11-01）：事件分页与 gen 起草的 schema 防御

- `listSessionEvents` 单页 100 条：长 run（11–14 turn）尾部事件被截 → recovery 恒 empty、
  尾部断言漏判。修复：评分/回收统一走 `listAllEvents`（next_page 游标，上限 10 页），
  并以回收轮 user 消息为界切分评分事件（splitAtRecovery，有单测）；修复后 live 验证 recovery=ok。
- `eval gen` 起草的 rubric `kind` 出现过枚举外值（`semantic`）：KitJsonSchema 的 kind 加
  `.catch("judge")` 兜底（起草质量问题是数据问题，不该炸 run）；存量 workspace 已 sanitize。
