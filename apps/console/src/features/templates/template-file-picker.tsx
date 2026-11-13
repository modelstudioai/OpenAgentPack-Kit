import { Button, Drawer } from "antd";
import { useState } from "react";
import { MAX_TEMPLATE_FILES, mergeImportedFiles, type TemplateFileDraft } from "./template-file-draft.ts";
import { TemplateFileSelection } from "./template-file-selection.tsx";
import styles from "./template-forms.module.less";

export function TemplateFilePicker({
	value,
	onChange,
}: {
	value: TemplateFileDraft[];
	onChange: (files: TemplateFileDraft[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [selection, setSelection] = useState<TemplateFileDraft[]>([]);
	const newCount = value.filter((file) => file.pending && !file.pending.original).length;
	return (
		<>
			<Button
				onClick={() => {
					setSelection(value.filter((file) => !file.pending || file.pending.original));
					setOpen(true);
				}}
			>
				导入现有配置
			</Button>
			<Drawer
				open={open}
				onClose={() => setOpen(false)}
				destroyOnHidden
				width={768}
				title={<div className={styles.drawerTitle}>选择配置</div>}
				footer={
					<div className={styles.drawerFooter}>
						<Button onClick={() => setOpen(false)}>取消</Button>
						<Button
							type="primary"
							disabled={selection.length + newCount > MAX_TEMPLATE_FILES}
							onClick={() => {
								onChange(mergeImportedFiles(value, selection));
								setOpen(false);
							}}
						>
							确认选择
						</Button>
					</div>
				}
			>
				<TemplateFileSelection
					value={selection}
					onChange={setSelection}
					search={search}
					onSearchChange={setSearch}
					maxFiles={MAX_TEMPLATE_FILES - newCount}
				/>
			</Drawer>
		</>
	);
}
