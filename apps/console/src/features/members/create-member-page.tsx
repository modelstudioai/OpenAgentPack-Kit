import { ArrowLeftOutlined } from "@ant-design/icons";
import { CreateMemberRequestSchema, type CreateMemberResponse } from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Input, Radio, Typography } from "antd";
import { useState } from "react";
import styles from "./members.module.less";
import { useCreateMember } from "./use-members.ts";

interface MemberDraft {
	username: string;
	display_name: string;
	email: string;
	password_mode: "auto" | "custom";
	password: string;
}

const EMPTY_DRAFT: MemberDraft = {
	username: "",
	display_name: "",
	email: "",
	password_mode: "auto",
	password: "",
};

function CreatedMember({ result, onBack }: { result: CreateMemberResponse["data"]; onBack: () => void }) {
	return (
		<section aria-labelledby="member-created-heading" className={styles.stack}>
			<h2 id="member-created-heading" className={styles.pageTitle}>
				用户创建成功
			</h2>
			<dl className={styles.createdGrid}>
				<div>
					<dt className={styles.mutedText}>用户名</dt>
					<dd className={styles.monoValue}>{result.member.username}</dd>
				</div>
				<div>
					<dt className={styles.mutedText}>显示名</dt>
					<dd className={styles.termValue}>{result.member.display_name}</dd>
				</div>
			</dl>
			{result.initial_password && (
				<div className={styles.passwordPanel}>
					<h3 className={styles.panelTitle}>初始密码</h3>
					<p className={styles.mutedText}>初始密码仅显示这一次，请妥善保存。返回列表或离开此页后无法再次查看。</p>
					<Typography.Text
						copyable={{ text: result.initial_password }}
						data-testid="initial-password"
						className={styles.passwordText}
					>
						{result.initial_password}
					</Typography.Text>
				</div>
			)}
			<p className={styles.mutedText}>成员已加入本地目录，可使用用户名和密码登录体验页。</p>
			<Button type="primary" onClick={onBack}>
				返回成员列表
			</Button>
		</section>
	);
}

function FieldError({ field, errors }: { field: keyof MemberDraft; errors: Record<string, string> }) {
	return errors[field] ? (
		<p id={`member-${field}-error`} className={styles.fieldError}>
			{errors[field]}
		</p>
	) : null;
}

export function CreateMemberPage({
	onBack,
	onPendingChange,
}: {
	onBack: () => void;
	onPendingChange: (pending: boolean) => void;
}) {
	const [draft, setDraft] = useState<MemberDraft>(EMPTY_DRAFT);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const creation = useCreateMember(onPendingChange);
	const update = (field: keyof MemberDraft, value: string) => {
		setDraft((current) => ({ ...current, [field]: value }));
		setErrors((current) => ({ ...current, [field]: "" }));
	};
	const submit = async () => {
		const parsed = CreateMemberRequestSchema.safeParse({
			username: draft.username,
			display_name: draft.display_name,
			...(draft.email.trim() ? { email: draft.email.trim() } : {}),
			auth_type: "local",
			password_mode: draft.password_mode,
			...(draft.password_mode === "custom" ? { password: draft.password } : {}),
		});
		if (!parsed.success) {
			const next: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const field = String(issue.path[0]);
				next[field] ??= issue.message;
			}
			setErrors(next);
			return;
		}
		setErrors({});
		if (await creation.create(parsed.data)) setDraft(EMPTY_DRAFT);
	};
	if (creation.result) return <CreatedMember result={creation.result} onBack={onBack} />;
	return (
		<form
			noValidate
			autoComplete="off"
			aria-labelledby="create-member-heading"
			className={styles.stack}
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<header className={styles.pageHeaderCenter}>
				<div className={styles.headerLeft}>
					<Button aria-label="返回成员列表" disabled={creation.pending} onClick={onBack}>
						<ArrowLeftOutlined />
						返回
					</Button>
					<h2 id="create-member-heading" className={styles.pageTitle}>
						创建用户
					</h2>
				</div>
				<Button type="primary" htmlType="submit" loading={creation.pending}>
					立即创建
				</Button>
			</header>
			{creation.error && <Alert type="error" showIcon closable message={creation.error} />}
			<fieldset disabled={creation.pending} className={styles.formSections}>
				<legend className={styles.srOnly}>用户信息</legend>
				<div className={styles.fieldGrid}>
					<div className={styles.fieldRow}>
						<label htmlFor="member-username">
							用户名{" "}
							<span aria-hidden="true" className={styles.requiredMark}>
								*
							</span>
						</label>
						<Input
							id="member-username"
							name="username"
							required
							maxLength={32}
							value={draft.username}
							onChange={(event) => update("username", event.target.value)}
							aria-invalid={!!errors.username}
							aria-describedby="member-username-hint member-username-error"
						/>
						<p id="member-username-hint" className={styles.fieldHint}>
							3–32 个字符，以字母或数字开头，支持字母、数字、下划线、点和连字符；统一保存为小写。
						</p>
						<FieldError field="username" errors={errors} />
					</div>
					<div className={styles.fieldRow}>
						<label htmlFor="member-display_name">
							显示名{" "}
							<span aria-hidden="true" className={styles.requiredMark}>
								*
							</span>
						</label>
						<Input
							id="member-display_name"
							name="display_name"
							required
							maxLength={32}
							value={draft.display_name}
							onChange={(event) => update("display_name", event.target.value)}
							aria-invalid={!!errors.display_name}
							aria-describedby="member-display_name-hint member-display_name-error"
						/>
						<p id="member-display_name-hint" className={styles.fieldHint}>
							用于展示成员身份，最多 32 个字符。
						</p>
						<FieldError field="display_name" errors={errors} />
					</div>
				</div>
				<div className={styles.fieldRow}>
					<label htmlFor="member-email">
						邮箱 <span className={styles.mutedText}>（可选）</span>
					</label>
					<Input
						id="member-email"
						name="email"
						type="email"
						maxLength={254}
						value={draft.email}
						onChange={(event) => update("email", event.target.value)}
						aria-invalid={!!errors.email}
						aria-describedby="member-email-error"
					/>
					<FieldError field="email" errors={errors} />
				</div>
				<div>
					<p className={styles.sectionLabel}>认证方式</p>
					<p className={styles.staticField}>本地账号</p>
				</div>
				<fieldset className={styles.passwordSection}>
					<legend className={styles.legendTitle}>密码设置</legend>
					<Radio.Group
						disabled={creation.pending}
						value={draft.password_mode}
						onChange={(event) => {
							if (event.target.value === "auto") {
								update("password_mode", "auto");
								update("password", "");
								return;
							}
							update("password_mode", "custom");
						}}
					>
						<Radio value="auto">自动生成密码</Radio>
						<Radio value="custom">自定义密码</Radio>
					</Radio.Group>
					{draft.password_mode === "auto" ? (
						<p className={styles.autoPasswordHint}>系统将生成初始密码，并在创建成功后显示一次。</p>
					) : (
						<div className={styles.fieldRow}>
							<label htmlFor="member-password">
								初始密码{" "}
								<span aria-hidden="true" className={styles.requiredMark}>
									*
								</span>
							</label>
							<Input.Password
								id="member-password"
								name="password"
								autoComplete="new-password"
								required
								maxLength={32}
								value={draft.password}
								onChange={(event) => update("password", event.target.value)}
								aria-invalid={!!errors.password}
								aria-describedby="member-password-hint member-password-error"
							/>
							<p id="member-password-hint" className={styles.fieldHint}>
								8–32 个非空格 ASCII 字符，须同时包含大写字母、小写字母、数字和特殊字符，不能包含用户名（不区分大小写）。
							</p>
							<FieldError field="password" errors={errors} />
						</div>
					)}
				</fieldset>
			</fieldset>
		</form>
	);
}
