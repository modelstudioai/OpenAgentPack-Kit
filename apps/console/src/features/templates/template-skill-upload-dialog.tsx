import type { ProjectSkillUploadCommit } from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Modal } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { getAdminClient } from "../../lib/api.ts";
import styles from "./template-forms.module.less";
import { useTemplateResourceDraft } from "./template-resource-draft.tsx";
import { TemplateUploadDropzone } from "./template-upload-dropzone.tsx";
import { useProjectUploads } from "./use-project-uploads.ts";

const formatByte = (byte: number) =>
	byte < 1024
		? `${byte} B`
		: byte < 1024 * 1024
			? `${(byte / 1024).toFixed(1)} KB`
			: `${(byte / 1024 / 1024).toFixed(1)} MB`;

type Props = {
	projectName: string;
	revision?: string;
	enabled: boolean;
	disabled: boolean;
	onPendingChange: (pending: boolean) => void;
	onSaved: (skills: ProjectSkillUploadCommit["skills"]) => Promise<void>;
	onPrepare?: () => Promise<unknown>;
};

export function TemplateSkillUploadAction(props: Props) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const focusAfterClose = useRef(false);
	const disabled = props.disabled || !props.enabled || (!props.onPrepare && (!props.projectName || !props.revision));
	useEffect(() => {
		if (open || props.disabled || !focusAfterClose.current) return;
		const origin = trigger.current;
		if (!origin) return;
		const restore = () => {
			const target = disabled
				? origin.closest("form")?.querySelector<HTMLElement>("input:enabled, textarea:enabled, button:enabled")
				: origin;
			if (!target || target.matches(":disabled")) return;
			target.focus({ preventScroll: true });
			if (origin.ownerDocument.activeElement === target) {
				focusAfterClose.current = false;
				observer.disconnect();
			}
		};
		// 父级 fieldset 的解锁晚于弹窗卸载；监听实际可用状态，避免焦点在仍禁用时丢失。
		const observer = new MutationObserver(restore);
		observer.observe(origin.ownerDocument, { attributes: true, subtree: true, attributeFilter: ["disabled"] });
		restore();
		return () => observer.disconnect();
	}, [open, disabled, props.disabled]);
	const close = () => {
		focusAfterClose.current = true;
		setOpen(false);
	};
	return (
		<>
			<Button
				ref={trigger}
				disabled={disabled}
				onClick={() => {
					if (props.onPrepare)
						void props
							.onPrepare()
							.then(() => setOpen(true))
							.catch(() => {});
					else setOpen(true);
				}}
			>
				上传 Skill
			</Button>
			{open && props.revision ? <SkillUploadDialog {...props} revision={props.revision} onClose={close} /> : null}
		</>
	);
}

/** 保存本批共享 Skill，并将已保存的声明交给父表单添加引用。 */
function SkillUploadDialog({
	projectName,
	revision,
	enabled,
	onClose,
	onSaved,
	onPendingChange,
}: Props & { revision: string; onClose: () => void }) {
	const { markContent } = useTemplateResourceDraft();
	const client = useMemo(getAdminClient, []);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [selectionError, setSelectionError] = useState<string>();
	const [selectionKey, setSelectionKey] = useState(0);
	const fileSelection = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (selectionKey) fileSelection.current?.querySelector<HTMLElement>("button")?.focus();
	}, [selectionKey]);
	const [baseRevision] = useState(revision);
	const ready = enabled && baseRevision === revision;
	const skills = useProjectUploads({
		kind: "skill",
		workbench: { client, name: projectName },
		baseRevision,
		enabled: ready,
	});
	const save = useAdminMutation(async () => {
		if (!ready || !selectedFile) throw new Error("请先选择 Skill 文件。");
		const staged = skills.uploads.length ? skills.uploads : await skills.upload([selectedFile]);
		if (!staged.length) throw new Error("上传已取消，请重新选择 Skill 文件。");
		const ids = staged.map((skill) => skill.upload_id);
		const preview = await skills.preview(ids);
		if (!preview.can_commit) throw new Error(preview.diagnostics.join("；") || "Skill 校验未通过，请检查后重试。");
		// 本队列固定 kind: skill，共用上传 hook 的返回类型还包含文件结果。
		const result = (await skills.commit(ids)) as ProjectSkillUploadCommit;
		markContent(projectName);
		skills.committed(ids);
		await onSaved(result.skills);
		onClose();
	}, String(selectionKey));
	const pending = skills.pending || save.pending;
	useEffect(() => {
		onPendingChange(pending);
		return () => onPendingChange(false);
	}, [pending, onPendingChange]);
	const close = () => {
		if (save.pending) return;
		skills.abandon();
		onClose();
	};
	return (
		<Modal
			open
			centered
			focusTriggerAfterClose={false}
			width={512}
			title="上传 Skill"
			closable={!save.pending}
			keyboard={!save.pending}
			maskClosable={!save.pending}
			onCancel={close}
			footer={
				<div className={styles.formActions}>
					<Button disabled={save.pending} onClick={close}>
						取消
					</Button>
					<Button
						type="primary"
						disabled={!ready || pending || !selectedFile}
						loading={save.pending}
						onClick={() => void save.run().catch(() => undefined)}
					>
						确认
					</Button>
				</div>
			}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: 拖拽防护，文件落到弹窗空白处时不让浏览器直接打开 */}
			<div
				role="presentation"
				className={styles.pageStack}
				onDragOver={(event) => event.preventDefault()}
				onDrop={(event) => event.preventDefault()}
			>
				<p className={styles.formNote}>保存后自动添加到当前智能体，随智能体一起发布。</p>
				<div ref={fileSelection} className={styles.blockStack}>
					<p className={styles.formLabel}>上传</p>
					{selectedFile ? (
						<ul aria-label="待保存 Skill">
							<li className={styles.entryRow}>
								<div className={styles.fileChip}>
									<span className={`${styles.flexFill} ${styles.truncate} ${styles.body13}`}>{selectedFile.name}</span>
									<span className={`${styles.shrinkZero} ${styles.metaText}`}>{formatByte(selectedFile.size)}</span>
								</div>
								<Button
									aria-label={`移除 ${selectedFile.name}`}
									title="移除文件"
									className={styles.shrinkZero}
									disabled={pending}
									onClick={() => {
										for (const skill of skills.uploads) skills.remove(skill.upload_id);
										setSelectedFile(null);
										setSelectionError(undefined);
										setSelectionKey((key) => key + 1);
									}}
								>
									×
								</Button>
							</li>
						</ul>
					) : (
						<TemplateUploadDropzone
							label="选择 Skill 文件"
							title="点击或拖拽上传 Skill"
							hint="支持单个 ZIP 技能包或 SKILL.md。ZIP 包需包含 SKILL.md，文件头须包含 name。"
							accept=".zip,.md"
							disabled={!ready || pending}
							onSelect={(files) => {
								if (!files.length) return;
								if (files.length > 1) {
									setSelectionError("每次只能选择一个 Skill 文件。");
									return;
								}
								const file = files[0]!;
								if (file.name.toLowerCase() !== "skill.md" && !file.name.toLowerCase().endsWith(".zip")) {
									setSelectionError("请上传 ZIP 技能包或 SKILL.md。");
									return;
								}
								setSelectionError(undefined);
								setSelectedFile(file);
								setSelectionKey((key) => key + 1);
							}}
						/>
					)}
				</div>
				{selectionError ? (
					<p role="alert" className={styles.errorText}>
						{selectionError}
					</p>
				) : null}
				{baseRevision !== revision ? (
					<p role="alert" className={styles.errorText}>
						项目已变化，请关闭后重新上传。
					</p>
				) : null}
				{skills.pending ? (
					<p role="status" className={styles.body13}>
						正在上传 Skill…
					</p>
				) : null}
				{save.error ? <Alert type="error" showIcon message={save.error} /> : null}
			</div>
		</Modal>
	);
}
