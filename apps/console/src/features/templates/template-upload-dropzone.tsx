import { useRef, useState } from "react";

import styles from "./template-resources.module.less";

/** 文件和 Skill 共用的本地选择区；具体校验及保存由调用方处理。 */
export function TemplateUploadDropzone({
	label,
	title,
	hint,
	accept,
	disabled,
	onSelect,
}: {
	label: string;
	title: string;
	hint: string;
	accept?: string;
	disabled: boolean;
	onSelect: (files: File[]) => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	const dragDepth = useRef(0);
	const [dragging, setDragging] = useState(false);
	const dropzoneClass = `${styles.dropzone} ${dragging && !disabled ? styles.dropzoneDragging : styles.dropzoneIdle}`;
	return (
		<>
			<input
				ref={input}
				type="file"
				aria-label={label}
				accept={accept}
				tabIndex={-1}
				hidden
				disabled={disabled}
				onChange={(event) => {
					if (!disabled) onSelect(Array.from(event.currentTarget.files ?? []));
					event.currentTarget.value = "";
				}}
			/>
			<button
				type="button"
				aria-label={label}
				disabled={disabled}
				className={dropzoneClass}
				onClick={() => input.current?.click()}
				onDragEnter={(event) => {
					event.preventDefault();
					dragDepth.current += 1;
					setDragging(true);
				}}
				onDragOver={(event) => {
					event.preventDefault();
					event.dataTransfer.dropEffect = disabled ? "none" : "copy";
				}}
				onDragLeave={(event) => {
					event.preventDefault();
					dragDepth.current = Math.max(0, dragDepth.current - 1);
					if (!dragDepth.current) setDragging(false);
				}}
				onDrop={(event) => {
					event.preventDefault();
					dragDepth.current = 0;
					setDragging(false);
					if (!disabled) onSelect(Array.from(event.dataTransfer.files));
				}}
			>
				<svg
					aria-hidden="true"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					className={styles.dropzoneIcon}
				>
					<path
						d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				<span className={styles.dropzoneTitle}>{title}</span>
				<span className={styles.dropzoneHint}>{hint}</span>
			</button>
		</>
	);
}
