import { useState } from "react";
import styles from "./template-forms.module.less";
import { TemplateUploadDropzone } from "./template-upload-dropzone.tsx";

/** 选择只保留浏览器 File，新增资源由下一步统一保存。 */
export function TemplateFileDropzone({ disabled, onSelect }: { disabled: boolean; onSelect: (file: File) => void }) {
	const [error, setError] = useState("");
	const select = (selection: File[]) => {
		if (disabled || !selection.length) return;
		if (selection.length > 1) {
			setError("每次只能选择一个文件。");
			return;
		}
		setError("");
		const file = selection[0];
		if (file) onSelect(file);
	};
	return (
		<div className={styles.dropzoneStack}>
			<TemplateUploadDropzone
				label="选择本地文件"
				title="点击或拖拽文件到此区域"
				hint="支持单个文件"
				disabled={disabled}
				onSelect={select}
			/>
			{error ? (
				<p role="alert" className={styles.errorText}>
					{error}
				</p>
			) : null}
		</div>
	);
}
