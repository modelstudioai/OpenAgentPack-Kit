import { z } from "zod";
import { RemoteSkillReferenceSchema } from "./remote-skills.ts";

const credentialText =
	/\bsk-[A-Za-z0-9_-]{8,}\b|\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*|[a-z][a-z0-9+.-]*:\/\/[^\s/]+@|(?:authorization|api[_-]?key|access[_-]?key|password|secret|token|signature)\s*[=:]\s*(?!\$\{)[^\s&]+/i;
const safeText = (schema: z.ZodString) =>
	schema.refine((value) => !credentialText.test(value), "智能体配置不能包含明文凭据");

/** 与 SDK MultiagentDecl 同形；外部 Agent 只引用身份，不接管其生命周期。 */
export const ProjectAgentMultiagentSchema = z
	.object({
		type: z.literal("coordinator"),
		agents: z
			.array(
				z.union([
					z.object({ type: z.literal("self") }).strict(),
					safeText(
						z
							.string()
							.min(1)
							.max(128)
							.regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/),
					),
					z
						.object({
							agent_id: safeText(
								z
									.string()
									.trim()
									.min(1)
									.max(128)
									.regex(/^[A-Za-z0-9_-]+$/),
							),
						})
						.strict(),
				]),
			)
			.min(1, "开启 Multi-Agent 模式后，请至少选择一个子 Agent")
			.max(20, "最多选择 20 个子 Agent")
			.refine(
				(entries) =>
					new Set(
						entries.map((entry) =>
							typeof entry === "string" ? `local:${entry}` : "agent_id" in entry ? `remote:${entry.agent_id}` : "self",
						),
					).size === entries.length,
				"不能重复选择同一个子 Agent",
			),
	})
	.strict();

const localSkillId = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/, "项目 Skill 标识无效");
export const ProjectAgentMcpNameSchema = safeText(z.string().trim().min(1).max(200)).refine(
	(value) => !/[\p{Cc}]/u.test(value) && !value.includes("${"),
	"MCP 服务名称无效",
);
const skills = z
	.array(z.union([localSkillId, RemoteSkillReferenceSchema]))
	.max(10, "最多选择 10 个 Skill")
	.superRefine((entries, ctx) => {
		const seen = new Set<string>();
		for (const [index, entry] of entries.entries()) {
			const key = typeof entry === "string" ? `project:${entry}` : `remote:${entry.skill_id}`;
			if (seen.has(key)) ctx.addIssue({ code: "custom", path: [index], message: "不能重复选择同一个 Skill" });
			seen.add(key);
		}
	});
const mcpServers = z
	.array(ProjectAgentMcpNameSchema)
	.max(50, "最多选择 50 个 MCP 服务")
	.refine((entries) => new Set(entries).size === entries.length, "不能重复选择同一个 MCP 服务");

const toolName = safeText(z.string().trim().min(1).max(200));
const permission = z.enum(["allow", "ask"]);
const tools = z
	.object({
		builtin: z.array(toolName).max(100),
		default_permission: permission.optional(),
		permissions: z.record(toolName, permission).optional(),
		mcp: z
			.array(
				z
					.object({
						type: z.literal("mcp_toolkit"),
						mcp_server_name: ProjectAgentMcpNameSchema,
						default_config: z.object({ enabled: z.boolean() }).strict().optional(),
						configs: z
							.array(z.object({ name: toolName, enabled: z.boolean() }).strict())
							.max(200)
							.optional(),
					})
					.strict(),
			)
			.max(50)
			.optional(),
	})
	.strict();

/** 基础 Agent 声明；指令始终是正文，远端 Agent 仅可作为子 Agent 引用，不接受发布选项。 */
export const ProjectAgentCreateInputSchema = z
	.object({
		base_revision: z.string().min(1, "缺少项目版本，请重新加载").max(256),
		name: safeText(z.string().trim().min(1, "请输入智能体名称").max(255, "智能体名称最多 255 个字符")),
		description: safeText(z.string().trim().max(1024, "智能体描述最多 1024 个字符")).optional(),
		model: safeText(z.string().trim().min(1, "请输入模型名称").max(200, "模型名称最多 200 个字符")),
		instructions: safeText(z.string().max(65536, "指令最多 65536 个字符")).optional(),
		skills: skills.optional(),
		mcp_servers: mcpServers.optional(),
		tools: tools.optional(),
		multiagent: ProjectAgentMultiagentSchema.optional(),
		/** 页面填写或从已有 Agent 导入的官方 MCP 声明；不接受 URL、请求头或凭据。 */
		mcp_configurations: z
			.array(z.object({ name: ProjectAgentMcpNameSchema, type: z.literal("official") }).strict())
			.max(50)
			.optional(),
	})
	.strict();
export type ProjectAgentCreateInput = z.infer<typeof ProjectAgentCreateInputSchema>;

export const ProjectAgentCreateResultSchema = z.object({
	new_revision: z.string(),
	agent: z.object({ id: z.string(), name: z.string(), source_path: z.string() }),
});
export type ProjectAgentCreateResult = z.infer<typeof ProjectAgentCreateResultSchema>;

/** 本地候选快照；仅包含共享 Skill 和可复用的官方 MCP 服务名称。 */
export const ProjectAgentOptionsSchema = z.object({
	base_revision: z.string(),
	skills: z.array(z.object({ id: localSkillId, name: z.string(), description: z.string().optional() })),
	mcp_servers: z.array(z.object({ name: ProjectAgentMcpNameSchema })),
});
export type ProjectAgentOptions = z.infer<typeof ProjectAgentOptionsSchema>;
