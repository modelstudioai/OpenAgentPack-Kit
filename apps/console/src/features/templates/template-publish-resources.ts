import type { ProjectPlan, ResourceDraftDeclaration } from "@openagentpack/kit-sdk/protocol";

const RESOURCE_LABELS: Record<string, string> = {
	agent: "智能体",
	environment: "环境",
	file: "文件",
	skill: "Skill",
	memory_store: "记忆库",
	vault: "密钥库",
	deployment: "部署",
};
const ACTION_LABELS = { create: "创建", update: "更新", delete: "删除", noop: "检查" } as const;

/** 危险标记优先于 noop；不能把不一致的计划当作无需发布。 */
export function pendingPublishResources(plan: ProjectPlan) {
	return plan.diff.filter((entry) => entry.action !== "noop" || entry.destructive);
}

export function publishResourceNames(declarations: ResourceDraftDeclaration[]): Record<string, string> {
	const names: Record<string, string> = {};
	for (const item of declarations) {
		const displayName = item.declaration.display_name;
		const name = item.name || (typeof displayName === "string" ? displayName : item.id);
		names[`${item.type}:${item.id}`] = name;
	}
	return names;
}

export function pendingPublishDescription(plan: ProjectPlan, names: Record<string, string>, includeNoop = false) {
	const changes = includeNoop ? plan.diff : pendingPublishResources(plan);
	const rows = changes.map((entry) => {
		const address = /^([^:/]+)[:/](.+)$/.exec(entry.resource);
		const type = address?.[1] ?? "";
		const id = address?.[2] ?? entry.resource;
		const name = names[`${type}:${id}`] || id;
		const action = `${ACTION_LABELS[entry.action]}${entry.destructive ? "（包含破坏性变更）" : ""}`;
		return `• ${RESOURCE_LABELS[type] || "资源"}：${name}\n  ${action} · ${entry.resource}${entry.summary ? `\n  ${entry.summary}` : ""}`;
	});
	return `待发布资源（${changes.length} 项）：\n\n${rows.join("\n\n")}`;
}
