import { MAX_MEMORY_ENTRIES, MemoryEntrySchema } from "@openagentpack/kit-sdk/protocol";
import { Button, Input, Modal } from "antd";
import { useId, useState } from "react";
import styles from "./template-forms.module.less";
import type { TemplateMemoryEntry } from "./template-memory-draft.ts";
import { TemplateMemoryEntryList } from "./template-memory-entry-list.tsx";

function MemoryEntryDialog({
	initial,
	siblings,
	onSave,
	onClose,
}: {
	initial?: TemplateMemoryEntry;
	siblings: TemplateMemoryEntry[];
	onSave: (entry: TemplateMemoryEntry) => void;
	onClose: () => void;
}) {
	const [key, setKey] = useState(initial?.key ?? "");
	const [content, setContent] = useState(initial?.content ?? "");
	const [error, setError] = useState<string | null>(null);
	const prefix = useId();
	function save() {
		const parsed = MemoryEntrySchema.safeParse({ key, content });
		if (!parsed.success) {
			setError(parsed.error.issues[0]?.message ?? "请检查条目配置");
			return;
		}
		if (siblings.some((entry) => entry.id !== initial?.id && entry.key === parsed.data.key)) {
			setError("条目路径不能重复");
			return;
		}
		onSave({ ...parsed.data, id: initial?.id ?? crypto.randomUUID() });
		onClose();
	}
	return (
		<Modal
			open
			centered
			width={672}
			title={initial ? "编辑记忆条目" : "新增记忆条目"}
			onCancel={onClose}
			styles={{ body: { maxHeight: "calc(100dvh - 260px)", overflowY: "auto" } }}
			footer={
				<div className={styles.drawerFooter}>
					<Button onClick={onClose}>取消</Button>
					<Button type="primary" onClick={save}>
						{initial ? "保存" : "添加"}
					</Button>
				</div>
			}
		>
			<div className={styles.dialogBody}>
				<p className={styles.metaText}>条目保存在当前表单，下一步随新记忆库一起发布。</p>
				<div className={styles.stack2}>
					<label htmlFor={`${prefix}-key`}>
						条目路径{" "}
						<span aria-hidden="true" className={styles.errorColor}>
							*
						</span>
					</label>
					<Input
						id={`${prefix}-key`}
						value={key}
						onChange={(event) => setKey(event.target.value)}
						maxLength={1024}
						placeholder="例如：project/guide.md"
					/>
				</div>
				<div className={styles.stack2}>
					<label htmlFor={`${prefix}-content`}>正文</label>
					<Input.TextArea
						id={`${prefix}-content`}
						rows={10}
						value={content}
						onChange={(event) => setContent(event.target.value)}
						className={styles.monoControl}
					/>
				</div>
				{error ? (
					<p role="alert" className={styles.errorText}>
						{error}
					</p>
				) : null}
			</div>
		</Modal>
	);
}

export function TemplateMemoryEntries({
	value,
	onChange,
	disabled,
	onEditingChange,
}: {
	value: TemplateMemoryEntry[];
	onChange: (entries: TemplateMemoryEntry[]) => void;
	disabled: boolean;
	onEditingChange: (editing: boolean) => void;
}) {
	const [editor, setEditor] = useState<{ initial?: TemplateMemoryEntry; opener: HTMLButtonElement } | null>(null);
	function edit(opener: HTMLElement, initial?: TemplateMemoryEntry) {
		// antd Button 只把 currentTarget 声明为 HTMLElement，实际渲染是 <button>。
		setEditor({ initial, opener: opener as HTMLButtonElement });
		onEditingChange(true);
	}
	return (
		<section aria-label="记忆条目" className={styles.blockStack}>
			<div className={styles.rowBetween}>
				<h4 className={styles.sectionLabel}>记忆条目（{value.length}）</h4>
				<Button
					size="small"
					disabled={disabled || value.length >= MAX_MEMORY_ENTRIES}
					onClick={(event) => edit(event.currentTarget)}
				>
					新增条目
				</Button>
			</div>
			<TemplateMemoryEntryList
				value={value}
				actions={(entry) => (
					<>
						<Button
							type="link"
							size="small"
							className={styles.linkButton}
							disabled={disabled}
							aria-label={`编辑条目 ${entry.key}`}
							onClick={(event) => edit(event.currentTarget, entry)}
						>
							编辑
						</Button>
						<Button
							type="link"
							size="small"
							className={styles.linkButton}
							disabled={disabled}
							aria-label={`删除条目 ${entry.key}`}
							onClick={() => onChange(value.filter((item) => item.id !== entry.id))}
						>
							删除
						</Button>
					</>
				)}
			/>
			{editor ? (
				<MemoryEntryDialog
					initial={editor.initial}
					siblings={value}
					onSave={(entry) =>
						onChange(editor.initial ? value.map((item) => (item.id === entry.id ? entry : item)) : [...value, entry])
					}
					onClose={() => {
						const opener = editor.opener;
						setEditor(null);
						onEditingChange(false);
						requestAnimationFrame(() => {
							if (opener.isConnected) opener.focus({ preventScroll: true });
						});
					}}
				/>
			) : null}
		</section>
	);
}
