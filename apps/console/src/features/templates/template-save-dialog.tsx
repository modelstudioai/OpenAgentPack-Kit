import { KitError, type TemplateCreateInput, type TemplateView } from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Modal } from "antd";
import { useEffect, useId, useMemo, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { getAdminClient } from "../../lib/api.ts";
import { TemplateNameField, validateTemplateName } from "./template-name-field.tsx";
import styles from "./template-pages.module.less";

function useTemplateSave(input: Omit<TemplateCreateInput, "name">, name: string, editingTemplate?: TemplateView) {
	const client = useMemo(getAdminClient, []);
	const [conflict, setConflict] = useState(false);
	const save = useAdminMutation(async () => {
		setConflict(false);
		try {
			const value = { ...input, name: name.trim() };
			return editingTemplate
				? await client.templates.update(editingTemplate.template_id, {
						...value,
						base_version: editingTemplate.version,
					})
				: await client.templates.create(value);
		} catch (error) {
			setConflict(Boolean(editingTemplate) && error instanceof KitError && error.status === 409);
			throw error;
		}
	});
	const error =
		save.error && conflict
			? `${save.error}。草稿已保留。如模版已被更新，请返回模版列表后重新进入编辑，核对最新配置后再保存。`
			: save.error;
	return { ...save, error };
}

/** 保存本地模版配置；编辑态需二次确认，确认弹窗不阻塞草稿。 */
export function TemplateSaveDialog({
	opener,
	name,
	onNameChange,
	input,
	editingTemplate,
	onClose,
	onSaved,
	onPendingChange,
}: {
	opener: HTMLElement;
	name: string;
	onNameChange: (name: string) => void;
	input: Omit<TemplateCreateInput, "name">;
	editingTemplate?: TemplateView;
	onClose: () => void;
	onSaved: (template: TemplateView) => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const formId = useId();
	const [confirming, setConfirming] = useState(false);
	const save = useTemplateSave(input, name, editingTemplate);
	const nameError = validateTemplateName(name);
	const copy = editingTemplate
		? {
				title: "保存修改",
				saveLabel: "保存修改",
				description: "保存修改后的智能体、运行时资源和展示配置；已上架的条目将自动使用最新配置。",
			}
		: {
				title: "保存智能体",
				saveLabel: "保存",
				description: "保存所选智能体、运行时资源和展示配置，之后可在智能体管理中查看。",
			};
	function submit() {
		if (save.pending || nameError) return;
		void save
			.run()
			.then(onSaved)
			.catch(() => setConfirming(false));
	}
	useEffect(() => {
		onPendingChange(save.pending);
		return () => onPendingChange(false);
	}, [save.pending, onPendingChange]);
	const restoreFocus = () => {
		setTimeout(() => {
			if (opener.isConnected) opener.focus({ preventScroll: true });
		});
	};
	const close = () => {
		if (save.pending || confirming) return;
		onClose();
		restoreFocus();
	};
	return (
		<>
			<Modal
				open
				centered
				width={512}
				title={copy.title}
				closable={!save.pending && !confirming}
				keyboard={!save.pending && !confirming}
				maskClosable={!save.pending && !confirming}
				onCancel={close}
				footer={
					<div className={styles.formActions}>
						<Button disabled={save.pending} onClick={close}>
							取消
						</Button>
						<Button type="primary" htmlType="submit" form={formId} loading={save.pending} disabled={Boolean(nameError)}>
							{copy.saveLabel}
						</Button>
					</div>
				}
			>
				<p className={styles.formNote}>{copy.description}</p>
				<form
					id={formId}
					className={styles.saveForm}
					aria-busy={save.pending}
					onSubmit={(event) => {
						event.preventDefault();
						if (save.pending || confirming || nameError) return;
						if (editingTemplate) setConfirming(true);
						else submit();
					}}
				>
					<TemplateNameField value={name} onChange={onNameChange} disabled={save.pending} />
					{save.error ? <Alert type="error" showIcon message={save.error} /> : null}
				</form>
			</Modal>
			<Modal
				open={confirming}
				centered
				width={320}
				title="确认保存修改"
				maskClosable={false}
				onCancel={() => setConfirming(false)}
				footer={
					<div className={styles.formActions}>
						<Button onClick={() => setConfirming(false)}>取消</Button>
						<Button type="primary" loading={save.pending} onClick={submit}>
							{save.pending ? "保存中…" : "确认"}
						</Button>
					</div>
				}
			>
				<p>修改后会自动生效，是否确认？</p>
			</Modal>
		</>
	);
}
