import { type ProjectVaultCredentialInput, ProjectVaultCredentialInputSchema } from "@openagentpack/kit-sdk/protocol";
import { Button, Checkbox, Input, Modal, Select } from "antd";
import { useId, useState } from "react";
import styles from "./template-forms.module.less";

export interface VaultCredentialDraft {
	id: string;
	input: ProjectVaultCredentialInput;
}

function isUnchangedImported(
	initial: VaultCredentialDraft | undefined,
	input: Pick<ProjectVaultCredentialInput, "name" | "secret_name" | "secret_value" | "allowed_hosts">,
) {
	if (!initial || initial.input.secret_value || input.secret_value) return false;
	return (
		input.name.trim() === initial.input.name &&
		input.secret_name.trim() === initial.input.secret_name &&
		JSON.stringify([...input.allowed_hosts].sort()) === JSON.stringify([...initial.input.allowed_hosts].sort())
	);
}

/** managed agent 的环境变量密钥表单；这里只修改页面密钥库草稿，不发请求。 */
export function TemplateVaultCredentialDialog({
	initial,
	siblings,
	opener,
	onSave,
	onClose,
}: {
	initial?: VaultCredentialDraft;
	siblings: VaultCredentialDraft[];
	opener: HTMLButtonElement;
	onSave: (value: VaultCredentialDraft) => void;
	onClose: () => void;
}) {
	const prefix = useId();
	const source = initial?.input ?? {
		name: "",
		secret_name: "",
		secret_value: "",
		allowed_hosts: [],
		acknowledged: false,
	};
	const [name, setName] = useState(source.name);
	const [secretName, setSecretName] = useState(source.secret_name);
	const [secretValue, setSecretValue] = useState(source.secret_value);
	const [hosts, setHosts] = useState(source.allowed_hosts.join("\n"));
	const [acknowledged, setAcknowledged] = useState(source.acknowledged);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const allowedHosts = [
		...new Set(
			hosts
				.split(/[,，\n]/)
				.map((host) => host.trim().toLowerCase())
				.filter(Boolean),
		),
	];
	const allHosts = allowedHosts.includes("*");
	const unchangedImported = isUnchangedImported(initial, {
		name,
		secret_name: secretName,
		secret_value: secretValue,
		allowed_hosts: allowedHosts,
	});
	const restoreFocus = () => {
		setTimeout(() => {
			if (opener.isConnected) opener.focus({ preventScroll: true });
		});
	};
	function save() {
		if (unchangedImported) {
			close();
			return;
		}
		const result = ProjectVaultCredentialInputSchema.safeParse({
			name,
			secret_name: secretName,
			secret_value: secretValue,
			allowed_hosts: allowedHosts,
			acknowledged,
		});
		const issues: Record<string, string> = {};
		if (!result.success) for (const issue of result.error.issues) issues[String(issue.path[0])] ??= issue.message;
		const others = siblings.filter((item) => item.id !== initial?.id);
		if (others.some((item) => item.input.name === name.trim())) issues.name = "密钥名称不能重复";
		if (others.some((item) => item.input.secret_name === secretName.trim())) issues.secret_name = "变量名不能重复";
		setErrors(issues);
		if (!result.success || Object.keys(issues).length) return;
		onSave({ id: initial?.id ?? crypto.randomUUID(), input: result.data });
		close();
	}
	const close = () => {
		onClose();
		restoreFocus();
	};
	const error = (field: string) =>
		errors[field] ? (
			<p id={`${prefix}-${field}-error`} role="alert" className={styles.errorSmall}>
				{errors[field]}
			</p>
		) : null;
	return (
		<Modal
			open
			centered
			width={512}
			title={initial ? "编辑密钥" : "添加密钥"}
			onCancel={close}
			styles={{ body: { maxHeight: "calc(100dvh - 220px)", overflowY: "auto" } }}
			footer={
				<div className={styles.formActions}>
					<Button onClick={close}>取消</Button>
					<Button type="primary" disabled={!acknowledged && !unchangedImported} onClick={save}>
						{initial ? "保存" : "添加"}
					</Button>
				</div>
			}
		>
			<div className={styles.dialogBody}>
				<p className={styles.metaText}>配置密钥后，随密钥库一起发布。</p>
				<div className={styles.stack2}>
					<label htmlFor={`${prefix}-name`}>
						名称{" "}
						<span aria-hidden="true" className={styles.errorColor}>
							*
						</span>
					</label>
					<Input
						id={`${prefix}-name`}
						required
						maxLength={50}
						value={name}
						onChange={(event) => setName(event.target.value)}
						aria-invalid={Boolean(errors.name)}
						aria-describedby={errors.name ? `${prefix}-name-error` : undefined}
					/>
					{error("name")}
				</div>
				<div className={styles.stack2}>
					<label htmlFor={`${prefix}-type`}>类型</label>
					<Select
						id={`${prefix}-type`}
						aria-label="密钥类型"
						disabled
						value="environment_variable"
						options={[{ value: "environment_variable", label: "环境变量" }]}
						className={styles.fullControl}
					/>
				</div>
				<div className={styles.stack2}>
					<label htmlFor={`${prefix}-variable`}>
						变量名{" "}
						<span aria-hidden="true" className={styles.errorColor}>
							*
						</span>
					</label>
					<Input
						id={`${prefix}-variable`}
						required
						maxLength={200}
						placeholder="MY_API_KEY"
						value={secretName}
						onChange={(event) => setSecretName(event.target.value)}
						aria-invalid={Boolean(errors.secret_name)}
						aria-describedby={errors.secret_name ? `${prefix}-secret_name-error` : undefined}
					/>
					{error("secret_name")}
				</div>
				<div className={styles.stack2}>
					<label htmlFor={`${prefix}-value`}>
						变量值{" "}
						<span aria-hidden="true" className={styles.errorColor}>
							*
						</span>
					</label>
					<Input.Password
						id={`${prefix}-value`}
						required
						autoComplete="new-password"
						spellCheck={false}
						maxLength={500}
						placeholder="请输入变量值"
						value={secretValue}
						onChange={(event) => setSecretValue(event.target.value)}
						aria-invalid={Boolean(errors.secret_value)}
						aria-describedby={errors.secret_value ? `${prefix}-secret_value-error` : undefined}
					/>
					{error("secret_value")}
				</div>
				<div className={styles.stack2}>
					<label htmlFor={`${prefix}-placement`}>替换位置</label>
					<Select
						id={`${prefix}-placement`}
						aria-label="替换位置"
						disabled
						value="header"
						options={[{ value: "header", label: "HTTP 请求头" }]}
						className={styles.fullControl}
					/>
				</div>
				<div className={styles.previewBox}>
					<p>
						智能体发出：
						<code className={styles.breakAll}>{`Authorization: Bearer \${${secretName || "MY_API_KEY"}}`}</code>
					</p>
					<p>
						网关改写为：<code>Authorization: Bearer ••••••••</code>
					</p>
				</div>
				<div className={styles.stack2}>
					<label htmlFor={`${prefix}-hosts`}>
						密钥替换生效域名{" "}
						<span aria-hidden="true" className={styles.errorColor}>
							*
						</span>
					</label>
					<Input.TextArea
						id={`${prefix}-hosts`}
						required
						rows={2}
						maxLength={3000}
						placeholder="api.example.com, *.example.com"
						value={hosts}
						onChange={(event) => {
							setHosts(event.target.value);
							setAcknowledged(false);
						}}
						aria-invalid={Boolean(errors.allowed_hosts)}
						aria-describedby={`${prefix}-hosts-hint${errors.allowed_hosts ? ` ${prefix}-allowed_hosts-error` : ""}`}
					/>
					<p id={`${prefix}-hosts-hint`} className={styles.metaText}>
						用逗号或换行分隔，支持 *. 通配子域，最多 10 个。单独填写 * 对所有域名生效。
					</p>
					{error("allowed_hosts")}
				</div>
				<div className={styles.acknowledgeBox}>
					<p>
						{allHosts
							? "所有被访问域名都可能收到该密钥，请确认此范围符合预期。"
							: "该密钥在当前工作空间内共享，有权限的用户可在会话中使用它访问对应服务。"}
					</p>
					<Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}>
						{allHosts
							? "我已知悉所有域名均可替换该密钥，并确认使用此范围。"
							: "我已知悉该密钥为共享密钥，并对其保管与使用负责。"}
					</Checkbox>
					{error("acknowledged")}
				</div>
			</div>
		</Modal>
	);
}
