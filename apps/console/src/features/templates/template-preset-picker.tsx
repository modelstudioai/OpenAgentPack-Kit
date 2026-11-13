import { ConfirmDialog } from "@openagentpack/kit-chat-ui";
import type { PresetPackPreview } from "@openagentpack/kit-sdk/protocol";
import { Button, Drawer } from "antd";
import { useEffect, useState } from "react";
import { PresetPackSelection } from "../preset-packs/preset-pack-selection.tsx";

/** 创建页的远端智能体与资源选择；准备结果只交给当前表单，不保存预设包。 */
export function TemplatePresetPicker({
	buttonLabel = "导入预设包",
	disabled,
	hasConfiguration,
	onImport,
	onPendingChange,
}: {
	buttonLabel?: string;
	disabled: boolean;
	hasConfiguration: boolean;
	onImport: (preset: PresetPackPreview) => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const [open, setOpen] = useState(false);
	const [drawerVisible, setDrawerVisible] = useState(false);
	const [preparing, setPreparing] = useState(false);
	const [pending, setPending] = useState<PresetPackPreview | null>(null);
	useEffect(() => {
		onPendingChange(preparing || Boolean(pending));
		return () => onPendingChange(false);
	}, [preparing, pending, onPendingChange]);
	const close = () => {
		if (!preparing) setOpen(false);
	};
	const showPicker = () => {
		setDrawerVisible(true);
		setOpen(true);
	};
	return (
		<>
			<Button disabled={disabled} onClick={showPicker}>
				{buttonLabel}
			</Button>
			<Drawer
				open={open}
				size="large"
				title="导入预设包"
				onClose={close}
				afterOpenChange={(visible) => {
					if (!visible) setDrawerVisible(false);
				}}
				closable={!preparing}
				maskClosable={!preparing}
				keyboard={!preparing}
				footer={
					<div className="flex justify-end">
						<Button disabled={preparing} onClick={close}>
							取消
						</Button>
					</div>
				}
			>
				<PresetPackSelection
					onPendingChange={setPreparing}
					onImport={(preset) => {
						setOpen(false);
						if (hasConfiguration) setPending(preset);
						else onImport(preset);
					}}
				/>
			</Drawer>
			{pending && !drawerVisible ? (
				<ConfirmDialog
					title="确认替换配置"
					body={
						"将导入 " +
						pending.remote_agent_name +
						"（v" +
						pending.agent_version +
						"），替换当前基础配置和运行时资源，未发布资源将被清理。已填写的名称、分类和展示文案保持不变。"
					}
					confirmLabel="确认导入"
					onCancel={() => {
						setPending(null);
						showPicker();
					}}
					onConfirm={() => {
						const preset = pending;
						setPending(null);
						onImport(preset);
					}}
				/>
			) : null}
		</>
	);
}
