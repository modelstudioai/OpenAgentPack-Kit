import { TemplateInputSchema } from "@openagentpack/kit-sdk/protocol";
import { Form, Input } from "antd";
import { type RefObject, useId } from "react";
import { formRowClass, formRowLabelClass } from "../../lib/form-row.ts";
import styles from "./template-forms.module.less";

export function validateTemplateName(value: string): string | null {
	const result = TemplateInputSchema.shape.name.safeParse(value);
	return result.success
		? null
		: (result.error.issues[0]?.message || "请输入智能体名称").replace("模版名称", "智能体名称");
}

/** 配置页和保存弹窗共用名称草稿，唯一性由保存接口权威校验。 */
export function TemplateNameField({
	value,
	onChange,
	disabled = false,
	inputRef,
	horizontal = false,
}: {
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	/** 编辑器只持有原生 input 引用做 focus，antd InputRef 在组件内桥接。 */
	inputRef?: RefObject<HTMLInputElement | null>;
	horizontal?: boolean;
}) {
	const error = value.trim() ? validateTemplateName(value) : null;
	const inputId = useId();
	if (horizontal) {
		return (
			<div className={formRowClass}>
				<label htmlFor={inputId} className={formRowLabelClass}>
					智能体名称{" "}
					<span aria-hidden="true" className={styles.errorColor}>
						*
					</span>
				</label>
				<div className={styles.shrinkRoot}>
					<Input
						id={inputId}
						ref={(el) => {
							if (inputRef) inputRef.current = el?.input ?? null;
						}}
						required
						maxLength={64}
						showCount
						value={value}
						onChange={(event) => onChange(event.target.value)}
						disabled={disabled}
						status={error ? "error" : undefined}
					/>
				</div>
			</div>
		);
	}
	return (
		<Form component={false} layout="vertical" requiredMark={false}>
			<Form.Item
				label={
					<>
						智能体名称{" "}
						<span aria-hidden="true" className={styles.errorColor}>
							*
						</span>
					</>
				}
				validateStatus={error ? "error" : undefined}
				help={error}
			>
				<Input
					ref={(el) => {
						if (inputRef) inputRef.current = el?.input ?? null;
					}}
					maxLength={64}
					showCount
					value={value}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
					status={error ? "error" : undefined}
					aria-label="智能体名称"
				/>
			</Form.Item>
		</Form>
	);
}
