import { ErrorState, FileCard } from "@openagentpack/kit-chat-ui";
import { Button } from "antd";
import type { Ref } from "react";
import {
	MAX_TEMPLATE_FILES,
	pendingTemplateFile,
	type TemplateFileDraft,
	validateTemplateFiles,
	withFileMountPaths,
} from "./template-file-draft.ts";
import { TemplateFileDropzone } from "./template-file-dropzone.tsx";
import { TemplateFilePicker } from "./template-file-picker.tsx";
import styles from "./template-forms.module.less";
import { type FileFormHandle, useTemplateFileForm } from "./use-template-file-form.ts";

function FileFields({
	file,
	onChange,
	onRemove,
	disabled,
}: {
	file: TemplateFileDraft;
	onChange: (file: TemplateFileDraft) => void;
	onRemove: () => void;
	disabled: boolean;
}) {
	return (
		<li className={styles.fileItem}>
			<FileCard
				name={file.filename || file.file_id}
				type={file.pending?.file.type}
				className={styles.fileCard}
				description={file.pending ? "待保存" : file.local ? "待发布" : "云端文件"}
			/>
			<div className={styles.fileActions}>
				{file.pending?.original ? (
					<Button disabled={disabled} onClick={() => onChange(file.pending!.original!)}>
						恢复原文件
					</Button>
				) : null}
				<Button disabled={disabled} onClick={onRemove}>
					移除
				</Button>
			</div>
		</li>
	);
}

export function TemplateFileConfiguration({
	value,
	onChange,
	formRef,
	onPendingChange,
}: {
	value: TemplateFileDraft[];
	onChange: (files: TemplateFileDraft[]) => void;
	formRef: Ref<FileFormHandle>;
	onPendingChange?: (pending: boolean) => void;
}) {
	const model = useTemplateFileForm(value, formRef, onPendingChange);
	const editable = model.identity.data?.role === "admin" && !model.busy;
	const error = validateTemplateFiles(value);
	return (
		<section aria-label="文件" className={styles.configRoot}>
			<header className={styles.configHeader}>
				<h3 className={styles.sectionTitle}>文件</h3>
				<p className={styles.configHint}>可选，最多配置 {MAX_TEMPLATE_FILES} 个文件。</p>
			</header>
			<div className={styles.configBody}>
				<div className={styles.rowStart}>
					<TemplateFilePicker value={value} onChange={onChange} />
					<Button disabled={model.busy || !value.length} onClick={() => onChange([])}>
						清空
					</Button>
				</div>
				{model.identity.error ? (
					<ErrorState message={model.identity.error} onRetry={() => void model.identity.refresh()} />
				) : null}
				<TemplateFileDropzone
					disabled={!editable || value.length >= MAX_TEMPLATE_FILES}
					onSelect={(file) => {
						if (file && value.length < MAX_TEMPLATE_FILES)
							onChange(withFileMountPaths([...value, pendingTemplateFile(file)]));
					}}
				/>
				<ul aria-label="文件配置" className={styles.fileList}>
					{value.map((file) => (
						<FileFields
							key={file.file_id}
							file={file}
							disabled={!editable}
							onChange={(next) => onChange(value.map((item) => (item.file_id === file.file_id ? next : item)))}
							onRemove={() => onChange(value.filter((item) => item.file_id !== file.file_id))}
						/>
					))}
				</ul>
				{error || model.error ? <ErrorState message={error || model.error || "文件保存失败"} /> : null}
			</div>
		</section>
	);
}
