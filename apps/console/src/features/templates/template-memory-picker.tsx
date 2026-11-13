import { ErrorState } from "@openagentpack/kit-chat-ui";
import { Button, Drawer } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { getAdminClient } from "../../lib/api.ts";
import styles from "./template-forms.module.less";
import {
	loadImportedMemories,
	MAX_TEMPLATE_MEMORIES,
	mergeImportedMemories,
	type TemplateMemoryDraft,
} from "./template-memory-draft.ts";
import { TemplateMemorySelection } from "./template-memory-selection.tsx";

export function TemplateMemoryPicker({
	value,
	onChange,
	onPendingChange,
}: {
	value: TemplateMemoryDraft[];
	onChange: (value: TemplateMemoryDraft[]) => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const client = useMemo(getAdminClient, []);
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [selection, setSelection] = useState<TemplateMemoryDraft[]>([]);
	const pending = value.filter((row) => row.creation).length;
	const active = useRef<AbortController | null>(null);
	useEffect(() => () => active.current?.abort(), []);
	const importing = useAdminMutation(
		async () => {
			const controller = new AbortController();
			active.current = controller;
			try {
				const rows = await loadImportedMemories(value, selection, (row) =>
					row.local
						? client.draftResources.memoryStoreConfiguration(row.local.projectName, row.local.id, controller.signal)
						: client.remoteMemoryStoreConfiguration(row.memory_store_id, controller.signal),
				);
				controller.signal.throwIfAborted();
				onChange(rows);
				setOpen(false);
			} finally {
				controller.abort();
				if (active.current === controller) active.current = null;
			}
		},
		open ? "open" : "closed",
	);
	useEffect(() => {
		onPendingChange(importing.pending);
		return () => onPendingChange(false);
	}, [importing.pending, onPendingChange]);
	const close = () => {
		if (importing.pending) return;
		setOpen(false);
	};
	return (
		<>
			<Button
				onClick={() => {
					setSelection(
						value.filter((row) => !row.creation).map(({ configuration: _configuration, ...reference }) => reference),
					);
					setOpen(true);
				}}
			>
				导入现有配置
			</Button>
			<Drawer
				open={open}
				onClose={close}
				destroyOnHidden
				width={768}
				title={<div className={styles.drawerTitle}>选择配置</div>}
				footer={
					<div className={styles.drawerFooterStack}>
						{importing.error ? <ErrorState message={importing.error} /> : null}
						<div className={styles.drawerFooter}>
							<Button disabled={importing.pending} onClick={close}>
								取消
							</Button>
							<Button
								disabled={importing.pending || selection.length + pending > MAX_TEMPLATE_MEMORIES}
								onClick={() => {
									onChange(
										mergeImportedMemories(value, selection).map((row) =>
											row.creation || row.configuration ? row : { ...row, referenceOnly: true },
										),
									);
									setOpen(false);
								}}
							>
								仅复用原库
							</Button>
							<Button
								type="primary"
								disabled={importing.pending || selection.length + pending > MAX_TEMPLATE_MEMORIES}
								onClick={() => void importing.run().catch(() => {})}
							>
								{importing.pending ? "正在导入条目…" : "确认选择"}
							</Button>
						</div>
					</div>
				}
			>
				<fieldset disabled={importing.pending} className={styles.pickerFieldset}>
					<TemplateMemorySelection
						value={selection}
						onChange={setSelection}
						search={search}
						onSearchChange={setSearch}
						maxMemories={MAX_TEMPLATE_MEMORIES - pending}
					/>
				</fieldset>
			</Drawer>
		</>
	);
}
