import { z } from "zod";

/**
 * 社区兼容数据集（agentskills.io / NVIDIA SkillEvaluator 的 `evals/evals.json`）。
 * 我们只增不改：扩展字段一律进旁置 `evals/kit.json`，保证社区 runner 可直接消费。
 */
export const CommunityEvalSchema = z.object({
	id: z.union([z.number(), z.string()]),
	prompt: z.string().min(1),
	expected_output: z.string().min(1),
	files: z.array(z.string()).default([]),
	assertions: z.array(z.string()).default([]),
});
export type CommunityEval = z.infer<typeof CommunityEvalSchema>;

export const EvalsJsonSchema = z.object({
	skill_name: z.string().min(1),
	evals: z.array(CommunityEvalSchema),
});
export type EvalsJson = z.infer<typeof EvalsJsonSchema>;

/** 脚本断言词表（纯函数判定，输入 transcript/artifacts/turns）：
 * - `skill_activated`：存在 activate_skill 且 name 匹配；
 * - `skill_not_activated`：负例，不存在任何 activate_skill；
 * - `no_clarify_before_activate`：首次 activate_skill 之前没有 assistant 提问消息；
 * - `turns_within_budget`：turn 数 ≤ case 的 max_turns；
 * - `artifact_contains:<substr>`：任一回收产物文本包含 substr。 */
export const SCRIPT_ASSERTIONS = [
	"skill_activated",
	"skill_not_activated",
	"no_clarify_before_activate",
	"turns_within_budget",
] as const;
export const SCRIPT_ASSERTION_PREFIX = "artifact_contains:";

export const RubricItemSchema = z.object({
	id: z.string(),
	text: z.string().min(1),
	weight: z.number().positive().default(1),
	// gen 起草可能给枚举外值（模型不守约）：catch 回落 judge，语义项宁松勿崩
	kind: z.enum(["script", "judge"]).catch("judge").default("judge"),
});
export type RubricItem = z.infer<typeof RubricItemSchema>;

export const KitCaseExtSchema = z.object({
	kind: z.enum(["trigger_pos", "trigger_neg", "task"]).default("task"),
	rubric: z.array(RubricItemSchema).default([]),
	mounts: z.array(z.object({ file: z.string(), mount_path: z.string() })).default([]),
	/** 多轮脚本：session 每次 idle 后依序发送（工作流 skill 的确认门必需）；空数组=单轮。 */
	followups: z.array(z.string()).default([]),
	/** 单 case 覆盖 config.run_timeout_ms（重活 case 单独加时）。 */
	timeout_ms: z.number().int().positive().optional(),
	/** turn 收敛后是否进沙箱真回收产物（默认 true；纯对话 skill 可关省一轮）。 */
	collect_artifacts: z.boolean().default(true),
	max_turns: z.number().int().positive().default(12),
	/** init/gen 起草、尚未人工策展的 case；run 默认跳过 draft case（--include-draft 放开）。 */
	draft: z.boolean().default(false),
});
export type KitCaseExt = z.infer<typeof KitCaseExtSchema>;

export const KitJsonSchema = z.object({
	cases: z.record(z.string(), KitCaseExtSchema),
});
export type KitJson = z.infer<typeof KitJsonSchema>;

export const EvalConfigSchema = z.object({
	model: z.string().default("qwen3.8-max"),
	judge_model: z.string().default("qwen3.8-max"),
	concurrency: z.number().int().min(1).max(8).default(2),
	/** 每 case 重复次数（>1 时断言按多数决、score 取均值，benchmark stddev 才有意义）；成本 ×k。 */
	repeat_k: z.number().int().min(1).max(3).default(1),
	/** 单轮（每条 followup 一段）等待上限；工作流 skill 的原型生成段实测要分钟级，默认 600s。 */
	run_timeout_ms: z.number().int().positive().default(600_000),
	/** checking → active 的等待上限（实测分钟级，见 docs/research/skill-eval-probe.md）。 */
	review_timeout_ms: z.number().int().positive().default(600_000),
	/** without-skill 双跑基线：成本 ×2，默认关。 */
	baseline_without_skill: z.boolean().default(false),
	agent_instructions: z.string().default("你是一个评测用助手。按挂载的技能与用户请求完成任务。"),
	/** 沙箱环境 id：skill 要落盘文件时必须给；缺省时 run 会自动建一个 cloud environment 并缓存到 env.json。 */
	environment_id: z.string().optional(),
	/** 挂载 builtin_toolkit（bash/read/write，always_allow）：skill 要落盘/执行脚本时必须开（默认开）。 */
	sandbox_tools: z.boolean().default(true),
	/** 基础设施故障指纹（沙箱/环境抖动，非 skill 缺陷）：命中的 case 自动重试一次，仍命中则不计入 pass_rate 分母。 */
	infra_error_patterns: z
		.array(z.string())
		.default(["SANDBOX_CONNECT_FAILED", "SANDBOX_NOT_READY", "ENVIRONMENT_UNAVAILABLE"]),
});
export type EvalConfig = z.infer<typeof EvalConfigSchema>;

export const AssertionResultSchema = z.object({
	text: z.string(),
	passed: z.boolean(),
	evidence: z.string(),
	kind: z.enum(["script", "judge"]),
});
export type AssertionResult = z.infer<typeof AssertionResultSchema>;

export const GradingJsonSchema = z.object({
	assertion_results: z.array(AssertionResultSchema),
	/** 加权通过率 0..1（脚本与 judge 合算，权重来自 kit.json rubric，缺省 1）。 */
	score: z.number().min(0).max(1),
});
export type GradingJson = z.infer<typeof GradingJsonSchema>;

/** 百炼事件无 usage 字段：tokens 显式 null，不许编造（包级 AGENTS.md 不变量 6）。 */
export const TimingJsonSchema = z.object({
	turns: z.number().int().nonnegative(),
	duration_ms: z.number().nonnegative(),
	tokens: z.null().default(null),
});
export type TimingJson = z.infer<typeof TimingJsonSchema>;

export const RunManifestSchema = z.object({
	run_id: z.string(),
	/** running=进程还在跑或中途死了；complete=正常收尾。report/diff 只认 complete。 */
	status: z.enum(["running", "complete"]).default("running"),
	created_at: z.string(),
	skill: z.object({
		source_hash: z.string(),
		skill_id: z.string(),
		version: z.string(),
		name: z.string(),
	}),
	agent_id: z.string(),
	model: z.string(),
	judge_model: z.string(),
	cases_hash: z.string(),
	case_ids: z.array(z.string()),
	config: EvalConfigSchema,
});
export type RunManifest = z.infer<typeof RunManifestSchema>;

export const BenchmarkSummaryBlockSchema = z.object({
	pass_rate: z.object({ mean: z.number(), stddev: z.number() }),
	turns: z.object({ mean: z.number(), stddev: z.number() }),
	time_seconds: z.object({ mean: z.number(), stddev: z.number() }),
	/** 因 infra_error 被排除出分母的 case 数（环境抖动，非 skill 缺陷）。 */
	infra_excluded: z.number().int().nonnegative().default(0),
});
export const BenchmarkJsonSchema = z.object({
	run_summary: z.object({
		with_skill: BenchmarkSummaryBlockSchema,
		without_skill: BenchmarkSummaryBlockSchema.nullable(),
		delta: z.object({ pass_rate: z.number(), turns: z.number(), time_seconds: z.number() }).nullable(),
	}),
});
export type BenchmarkJson = z.infer<typeof BenchmarkJsonSchema>;

/** workspace 根索引：skill 内容哈希 → 已上传资源（避免每 run 重等分钟级审查）。 */
export const SkillIndexSchema = z.record(
	z.string(),
	z.object({
		skill_id: z.string(),
		version: z.string(),
		name: z.string(),
		uploaded_at: z.string(),
	}),
);
export type SkillIndex = z.infer<typeof SkillIndexSchema>;
