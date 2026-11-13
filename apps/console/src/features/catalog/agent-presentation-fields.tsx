import { DeleteOutlined } from "@ant-design/icons";
import { type AgentSummary, CatalogAgentInputSchema } from "@openagentpack/kit-sdk/protocol";
import { Button, Form, Input, Modal, Tooltip } from "antd";
import { useState } from "react";
import styles from "./catalog.module.less";

export interface AgentPresentationDraft {
	description: string;
	opening_remarks: string;
	/** 每行一条示例问题。 */
	suggested_prompts: string;
}

export type AgentPresentation = Pick<AgentSummary, "description" | "opening_remarks" | "suggested_prompts">;

export const EMPTY_AGENT_PRESENTATION: AgentPresentationDraft = {
	description: "",
	opening_remarks: "",
	suggested_prompts: "",
};

const presentationSchema = CatalogAgentInputSchema.pick({
	description: true,
	opening_remarks: true,
	suggested_prompts: true,
});

export function toAgentPresentation(draft: AgentPresentationDraft): AgentPresentation {
	return {
		...(draft.description.trim() ? { description: draft.description.trim() } : {}),
		...(draft.opening_remarks.trim() ? { opening_remarks: draft.opening_remarks.trim() } : {}),
		suggested_prompts: draft.suggested_prompts
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean),
	};
}

export function validateAgentPresentation(draft: AgentPresentationDraft): string | null {
	const result = presentationSchema.safeParse(toAgentPresentation(draft));
	if (result.success) return null;
	const path = result.error.issues[0]?.path;
	if (path?.[0] === "description") return "描述最多 400 个字符";
	if (path?.[0] === "opening_remarks") return "开场白最多 2000 个字符";
	return path?.length === 1 ? "示例问题最多 8 条" : "每条示例问题最多 200 个字符";
}

const MAX_PROMPTS = 8;

interface PromptRow {
	id: string;
	text: string;
}

function toPromptRows(prompts: string[]): PromptRow[] {
	return prompts.map((text) => ({ id: crypto.randomUUID(), text }));
}

function newPromptRow(): PromptRow {
	return { id: crypto.randomUUID(), text: "" };
}

/** 上架条目与模版共用展示字段，不修改远端 Agent 的提示词或会话运行配置。 */
export function AgentPresentationFields({
	value,
	onChange,
}: {
	value: AgentPresentationDraft;
	onChange: (next: AgentPresentationDraft) => void;
}) {
	const [editorOpen, setEditorOpen] = useState(false);
	const [rows, setRows] = useState<PromptRow[]>([]);
	const error = validateAgentPresentation(value);
	const set = (patch: Partial<AgentPresentationDraft>) => onChange({ ...value, ...patch });
	const prompts = value.suggested_prompts
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const openEditor = () => {
		const existing = toPromptRows(prompts);
		setRows(existing.length ? existing : [newPromptRow()]);
		setEditorOpen(true);
	};
	const confirmEditor = () => {
		set({
			suggested_prompts: rows
				.map((row) => row.text.trim())
				.filter(Boolean)
				.join("\n"),
		});
		setEditorOpen(false);
	};
	return (
		<Form component={false} layout="vertical" requiredMark={false}>
			<Form.Item label="描述">
				<Input
					value={value.description}
					maxLength={400}
					onChange={(event) => set({ description: event.target.value })}
					aria-label="描述"
				/>
			</Form.Item>
			<Form.Item label="开场白">
				<Input.TextArea
					rows={2}
					value={value.opening_remarks}
					maxLength={2000}
					onChange={(event) => set({ opening_remarks: event.target.value })}
					aria-label="开场白"
				/>
			</Form.Item>
			<div className="relative">
				<Form.Item
					label={
						<div>
							示例问题
							<Button
								type="link"
								size="small"
								aria-label="添加示例问题"
								onClick={openEditor}
								className="absolute top-0 right-0"
							>
								<span aria-hidden="true">+</span> 添加
							</Button>
						</div>
					}
					validateStatus={error ? "error" : undefined}
					help={error}
				>
					<div className="flex flex-col gap-1">
						{prompts.length ? (
							prompts.map((prompt, index) => (
								<Tooltip key={`${index}:${prompt}`} title={prompt}>
									<span className="block truncate">{prompt}</span>
								</Tooltip>
							))
						) : (
							<span className={styles.hintText}>--</span>
						)}
					</div>
				</Form.Item>
			</div>
			<Modal
				title="示例问题"
				open={editorOpen}
				onCancel={() => setEditorOpen(false)}
				onOk={confirmEditor}
				okText="确定"
				cancelText="取消"
				width={560}
				destroyOnHidden
			>
				<p className={styles.hintText}>最多 {MAX_PROMPTS} 条，每条最多 200 个字符。</p>
				<div className="mt-2 flex flex-col gap-2">
					{rows.map((row, index) => (
						<div key={row.id} className="flex items-center gap-2">
							<Input
								aria-label={`示例问题 ${index + 1}`}
								placeholder="输入示例问题"
								maxLength={200}
								value={row.text}
								onChange={(event) =>
									setRows((current) =>
										current.map((item) => (item.id === row.id ? { ...item, text: event.target.value } : item)),
									)
								}
							/>
							<Button
								type="text"
								size="small"
								aria-label={`移除示例问题 ${index + 1}`}
								title={`移除示例问题 ${index + 1}`}
								icon={<DeleteOutlined />}
								onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
							/>
						</div>
					))}
					<div className="flex justify-end">
						<Button
							type="link"
							size="small"
							aria-label="添加示例问题"
							disabled={rows.length >= MAX_PROMPTS}
							onClick={() => setRows((current) => [...current, newPromptRow()])}
						>
							<span aria-hidden="true">+</span> 添加
						</Button>
					</div>
				</div>
			</Modal>
		</Form>
	);
}
