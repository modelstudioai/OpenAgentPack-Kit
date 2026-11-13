/**
 * 工具调用摘要：已知工具给「动词 + 操作对象徽标」（如 读取文件 / desktop.css），
 * 未知工具回退「工具名 + 参数预览徽标」。徽标缺失字段时自动省略。
 */

export interface ToolSummary {
	verb: string;
	badge?: string;
}

interface SummaryInput {
	name: string;
	input?: unknown;
}

function field(input: unknown, key: string): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const value = (input as Record<string, unknown>)[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function truncate(text: string, max = 40): string {
	const compact = text.replace(/\s+/g, " ").trim();
	return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function basename(path: string): string {
	const segments = path.split(/[/\\]/).filter(Boolean);
	return segments.at(-1) ?? path;
}

function firstStringField(input: unknown): string | undefined {
	if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
	for (const value of Object.values(input as Record<string, unknown>)) {
		if (typeof value === "string" && value.length > 0) return truncate(value);
	}
	return undefined;
}

function fallbackBadge(input: unknown): string | undefined {
	if (typeof input === "string") return truncate(input);
	return firstStringField(input);
}

const TEMPLATES: Record<string, (input: SummaryInput) => ToolSummary | undefined> = {
	read_file: ({ input }) => {
		const target = field(input, "filename") ?? field(input, "path");
		return target ? { verb: "读取文件", badge: basename(target) } : undefined;
	},
	write_file: ({ input }) => {
		const target = field(input, "path") ?? field(input, "filename");
		return target ? { verb: "写入文件", badge: basename(target) } : undefined;
	},
	web_search: ({ input }) => {
		const query = field(input, "query") ?? field(input, "q") ?? field(input, "keyword");
		return query ? { verb: "搜索", badge: truncate(query, 24) } : undefined;
	},
	bash: bashSummary,
	shell: bashSummary,
	execute_command: bashSummary,
};

function bashSummary({ input }: SummaryInput): ToolSummary | undefined {
	const command = field(input, "command") ?? field(input, "cmd");
	return command ? { verb: "执行命令", badge: truncate(command) } : undefined;
}

export function toolSummary({ name, input }: SummaryInput): ToolSummary {
	const summary = TEMPLATES[name]?.({ name, input });
	if (summary) return summary;
	return { verb: name, badge: fallbackBadge(input) };
}
