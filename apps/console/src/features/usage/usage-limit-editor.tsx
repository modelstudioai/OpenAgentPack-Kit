import type { UsageLimitConfig } from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Input, Modal, Segmented } from "antd";
import { useId, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";

import styles from "./usage.module.less";

/** 限额周期：月与日两套独立配置，编辑器按周期切换编辑对应字段。 */
export type LimitPeriod = "month" | "day";

const periodFields = (period: LimitPeriod) =>
	period === "month"
		? ({ tokens: "monthly_tokens", seconds: "monthly_active_seconds" } as const)
		: ({ tokens: "daily_tokens", seconds: "daily_active_seconds" } as const);

export function formatLimit(value: number | null, unit: string) {
	return value === null ? "不限量" : `${value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })} ${unit}`;
}

export function limitsDescription(limits: UsageLimitConfig) {
	return [
		`每月 Token（输入 + 输出）：${formatLimit(limits.monthly_tokens, "Token")}`,
		`每月运行时长：${formatLimit(limits.monthly_active_seconds, "秒")}`,
		`每日 Token（输入 + 输出）：${formatLimit(limits.daily_tokens, "Token")}`,
		`每日运行时长：${formatLimit(limits.daily_active_seconds, "秒")}`,
	].join("\n");
}

export const usageLimitNotice =
	"按 UTC 统计：月度每轮归开始月，日度增量归采集确认日，均不回填启用前的历史。Token 为输入 + 输出，不额外累加缓存 Token；运行时长只统计执行时间。月度与日度独立生效，任一周期、任一指标达到限额即拦截后续发送；正在执行的一轮可能超限，不会强制停止。日度上限未设置时跟随月度上限约束，两者都未设置才不限量；日度上限不能高于月度上限。";

type PendingChange = { kind: "save"; limits: UsageLimitConfig } | { kind: "reset"; limits: UsageLimitConfig };

function confirmBody(
	kind: PendingChange["kind"],
	title: string,
	initial: UsageLimitConfig,
	limits: UsageLimitConfig,
	mutationError?: string | null,
) {
	return `修改前：\n${limitsDescription(initial)}\n\n修改后：\n${limitsDescription(limits)}\n\n${
		kind === "reset"
			? "删除该成员的个人设置，之后跟随默认限额。"
			: title === "默认限额"
				? "影响所有跟随默认限额的成员；个人设置不变。"
				: "为该成员保存个人限额，月度与日度设置整体覆盖默认值。"
	}

${usageLimitNotice}${
	mutationError
		? `

保存失败：${mutationError}`
		: ""
}`;
}

/** 校验当前周期输入并生成完整限额草稿；校验失败返回错误文案。 */
function buildDraft(
	initial: UsageLimitConfig,
	period: LimitPeriod,
	tokens: string,
	hours: string,
): { limits: UsageLimitConfig } | { error: string } {
	const tokenText = tokens.trim();
	const hourText = hours.trim();
	const tokenValue = tokenText ? Number(tokenText) : null;
	const fields = periodFields(period);
	const initialSeconds = initial[fields.seconds];
	// hourText 未改动时保持原秒数，避免小时换算丢精度。
	const unchangedSeconds = hours === (initialSeconds === null ? "" : String(initialSeconds / 3600));
	const seconds = hourText ? (unchangedSeconds ? initialSeconds : Number(hourText) * 3600) : null;
	if (tokenValue !== null && (!/^\d+$/.test(tokenText) || !Number.isSafeInteger(tokenValue)))
		return { error: "Token 限额须为非负安全整数，留空表示不限量。" };
	if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0))
		return { error: "运行时长须为非负小时数，留空表示不限量。" };
	return { limits: { ...initial, [fields.tokens]: tokenValue, [fields.seconds]: seconds } };
}

/** 周期切换：月/日按钮对，展示与编辑共用。 */
export function LimitPeriodTabs({
	period,
	onChange,
}: {
	period: LimitPeriod;
	onChange: (period: LimitPeriod) => void;
}) {
	return (
		<Segmented
			aria-label="限额周期"
			value={period}
			onChange={(value) => onChange(value as LimitPeriod)}
			options={[
				{ label: "按月", value: "month" },
				{ label: "按日", value: "day" },
			]}
		/>
	);
}

/** 编辑草稿与真正写入之间保留一次显式确认；失败保留草稿和待确认差异。 */
export function UsageLimitEditor({
	title,
	initial,
	defaults,
	canReset = false,
	onSave,
	onReset,
	onClose,
}: {
	title: string;
	initial: UsageLimitConfig;
	defaults?: UsageLimitConfig;
	canReset?: boolean;
	onSave: (limits: UsageLimitConfig) => Promise<unknown>;
	onReset?: () => Promise<unknown>;
	onClose: () => void;
}) {
	const id = useId();
	const [period, setPeriod] = useState<LimitPeriod>("month");
	/** 指定周期的原始配置值（hourText 未改动时保持原秒数，避免小时换算丢精度）。 */
	const initialFor = (target: LimitPeriod) => {
		const targetFields = periodFields(target);
		return { tokens: initial[targetFields.tokens], seconds: initial[targetFields.seconds] };
	};
	const [tokens, setTokens] = useState(() => {
		const base = initialFor("month");
		return base.tokens === null ? "" : String(base.tokens);
	});
	const [hours, setHours] = useState(() => {
		const base = initialFor("month");
		return base.seconds === null ? "" : String(base.seconds / 3600);
	});
	const [validationError, setValidationError] = useState<string | null>(null);
	const [change, setChange] = useState<PendingChange | null>(null);
	const mutation = useAdminMutation(async (pending: PendingChange) => {
		if (pending.kind === "reset") await onReset?.();
		else await onSave(pending.limits);
		setChange(null);
		onClose();
	});
	/** 切换周期时以原始配置重置两个输入框（另一周期的编辑不丢失，保存整体提交）。 */
	const switchPeriod = (next: LimitPeriod) => {
		const base = initialFor(next);
		setPeriod(next);
		setTokens(base.tokens === null ? "" : String(base.tokens));
		setHours(base.seconds === null ? "" : String(base.seconds / 3600));
		setValidationError(null);
	};
	const prepare = () => {
		const result = buildDraft(initial, period, tokens, hours);
		if ("error" in result) {
			setValidationError(result.error);
			return;
		}
		setValidationError(null);
		setChange({ kind: "save", limits: result.limits });
	};
	return (
		<div className={styles.editorRoot}>
			<form
				aria-label={title}
				className={styles.formStack}
				onSubmit={(event) => {
					event.preventDefault();
					if (!mutation.pending) prepare();
				}}
			>
				<div className={styles.periodRow}>
					<span className={styles.rowLabel}>周期</span>
					<LimitPeriodTabs period={period} onChange={switchPeriod} />
				</div>
				<div className={styles.fieldsGrid}>
					<label htmlFor={`${id}-tokens`} className={styles.fieldLabel}>
						{period === "month" ? "每月" : "每日"} Token 上限（输入 + 输出）
						<Input
							id={`${id}-tokens`}
							inputMode="numeric"
							placeholder="不限量"
							value={tokens}
							disabled={mutation.pending}
							onChange={(event) => setTokens(event.target.value)}
							className={styles.fieldInput}
						/>
					</label>
					<label htmlFor={`${id}-hours`} className={styles.fieldLabel}>
						{period === "month" ? "每月" : "每日"}运行时长上限（小时）
						<Input
							id={`${id}-hours`}
							inputMode="decimal"
							placeholder="不限量"
							value={hours}
							disabled={mutation.pending}
							onChange={(event) => setHours(event.target.value)}
							className={styles.fieldInput}
						/>
					</label>
				</div>
				<p className={styles.hintText}>
					当前周期两项分别留空表示不限量，0 表示不允许新增消耗；另一周期保持原值。小时数保存时换算为秒。
				</p>
				{validationError && <Alert type="error" showIcon message={validationError} />}
				{mutation.error && !change && <Alert type="error" showIcon message={mutation.error} />}
				<div className={styles.formActions}>
					<Button type="primary" htmlType="submit" loading={mutation.pending}>
						保存限额
					</Button>
					{canReset && onReset && (
						<Button
							disabled={mutation.pending || !defaults}
							onClick={() => defaults && setChange({ kind: "reset", limits: defaults })}
						>
							恢复默认
						</Button>
					)}
					<Button disabled={mutation.pending} onClick={onClose}>
						取消编辑
					</Button>
				</div>
			</form>
			{change && (
				<Modal
					title={change.kind === "reset" ? "确认恢复默认限额" : `确认${title}`}
					open
					okText={change.kind === "reset" ? "确认恢复" : "确认保存"}
					confirmLoading={mutation.pending}
					onOk={() => void mutation.run(change).catch(() => undefined)}
					onCancel={() => setChange(null)}
				>
					<p className={styles.confirmBodyText}>
						{confirmBody(change.kind, title, initial, change.limits, mutation.error)}
					</p>
				</Modal>
			)}
		</div>
	);
}
