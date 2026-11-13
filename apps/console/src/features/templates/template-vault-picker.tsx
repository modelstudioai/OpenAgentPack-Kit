import { Button, Drawer } from "antd";
import { useState } from "react";
import styles from "./template-forms.module.less";
import { MAX_TEMPLATE_VAULTS, mergeImportedVaults, type TemplateVaultDraft } from "./template-vault-draft.ts";
import { TemplateVaultSelection } from "./template-vault-selection.tsx";

export function TemplateVaultPicker({
	value,
	onChange,
}: {
	value: TemplateVaultDraft[];
	onChange: (value: TemplateVaultDraft[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [selection, setSelection] = useState<TemplateVaultDraft[]>([]);
	const pending = value.filter((row) => row.creation).length;
	return (
		<>
			<Button
				onClick={() => {
					setSelection(
						value.filter((row) => !row.creation).map(({ vault_id, name, local }) => ({ vault_id, name, local })),
					);
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
							disabled={selection.length + pending > MAX_TEMPLATE_VAULTS}
							onClick={() => {
								onChange(mergeImportedVaults(value, selection));
								setOpen(false);
							}}
						>
							确认选择
						</Button>
					</div>
				}
			>
				<TemplateVaultSelection
					value={selection}
					onChange={setSelection}
					search={search}
					onSearchChange={setSearch}
					maxVaults={MAX_TEMPLATE_VAULTS - pending}
				/>
			</Drawer>
		</>
	);
}
