# Skill 评测资产：社区规范调研（2026-10-23）

结论：**有事实标准（de facto），无正式标准组织**。社区收敛出「skill 目录内 `evals/` 资产 +
旁置 workspace 运行产物」两层约定；Anthropic 发起，NVIDIA 与第三方 runner 采纳。

## 1. 数据集约定：`evals/evals.json`（事实标准）

来源：Anthropic skill-creator / agentskills.io「Evaluating skill output quality」。
被 NVIDIA SkillEvaluator、agent-skills-eval、Claude Code 文档消费。

```json
{
  "skill_name": "csv-analyzer",
  "evals": [
    {
      "id": 1,
      "prompt": "真实用户口吻的任务描述",
      "expected_output": "人类可读的成功描述",
      "files": ["evals/files/sales_2025.csv"],
      "assertions": ["可验证陈述1", "可验证陈述2"]
    }
  ]
}
```

方法论要点：
- 先 2–3 个 case 起步，首轮跑完**看过输出再补 assertions**；
- assertions 要客观可查（「输出是合法 JSON」「柱状图有轴标签」），质性（文风/视觉）留人审；
- prompt 要变体（口语/精确/边界/畸形输入）。

## 2. 运行产物约定：workspace + iteration

```
<skill>-workspace/iteration-N/eval-<slug>/{with_skill,without_skill,old_skill}/
    outputs/          # 运行产物文件
    timing.json       # { total_tokens, duration_ms }
    grading.json      # { assertion_results: [{ text, passed, evidence }] }
<skill>-workspace/iteration-N/benchmark.json
    # run_summary.{with_skill,without_skill}.{pass_rate,time_seconds,tokens}.{mean,stddev} + delta
```

- 每 case **干净上下文**（新 session/子代理），不带开发期残留；
- with-skill vs without-skill（或旧版本快照）双跑取 **delta**＝skill 的增量价值；
- grading 的 evidence 必须**引用输出原文**，不能只给结论；
- 机械断言用脚本判，LLM 只判语义断言。

## 3. 扩展树：NVIDIA SkillEvaluator

在 `evals/` 内追加（evals.json 唯一必需，其余可选增量）：
`config.yml`（attempts/阈值/runtime/agent 模型/grading mode）、`EVAL.md`（指导 AI 生成数据集）、
`files/`（fixture，stage 进容器 `/workspace/input/`）、`environment/`（Dockerfile/MCP）。
执行层跑 Harbor 开源 agent 评测框架（自带 task bundle 可替代 evals.json）。

## 4. 横向基准（另一条线，v1 不碰）

- SkillsBench（benchflow）：87 个 task 包，skill 作为一等公民，测 with/without delta；
- SkillBench：300+ 公共 skill 的质量打分索引；SkillGenBench：skill 生成管线基准。

## 5. 与百炼 Managed Agents 场景的差距（自研点）

1. 约定假设**本地 agent runtime + 文件系统产物**；百炼是远端 session：
   outputs = 会话事件流 + artifact（files API 拉回），触发判定依赖 session events 形状
   （见 `skill-eval-probe.md` 探针结论）；
2. 约定无**触发准确率**一等指标（delta 测价值不测 description 触发精度）→ 补正/负触发集；
3. `timing.json.total_tokens` 在百炼事件里拿不到（无 usage 字段）→ 记 turn 数 + wall time 并标注口径；
4. 无「报告 → SKILL.md 优化建议 diff」闭环规范 → 我们的差异化（suggest 阶段）。

## 6. 我们的兼容策略

- 主数据集文件保持社区 schema（`evals/evals.json`），可被社区 runner 消费；
- 扩展字段放旁置 `evals/kit.json`（case kind/rubric 权重/挂载路径/judge 配置），不污染社区文件；
- 运行产物目录同构（iteration/with_skill/… + benchmark.json），另加 `manifest.json`
  钉 (skill_id, version, agent_id, model, case 集哈希)。
