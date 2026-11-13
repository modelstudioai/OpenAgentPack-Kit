import { PLAZA_CATEGORY_LABELS, type PlazaCategory } from "@openagentpack/kit-sdk/protocol";
import { Form, Select } from "antd";
import { formRowClass, formRowLabelClass } from "../../lib/form-row.ts";
import styles from "./catalog.module.less";

const CATEGORY_OPTIONS = (Object.keys(PLAZA_CATEGORY_LABELS) as PlazaCategory[]).map((id) => ({
	value: id,
	label: PLAZA_CATEGORY_LABELS[id],
}));

/** 上架条目与模版共用广场分类，不属于 Provider 运行时配置。 */
export function PlazaCategoryField({
	value,
	onChange,
	label = "广场分类",
	required = false,
	horizontal = false,
}: {
	value: PlazaCategory;
	onChange: (value: PlazaCategory) => void;
	label?: string;
	required?: boolean;
	horizontal?: boolean;
}) {
	if (horizontal) {
		return (
			<div className={formRowClass}>
				<span className={formRowLabelClass}>
					{label}
					{required ? (
						<span aria-hidden="true" className={styles.requiredStar}>
							*
						</span>
					) : null}
				</span>
				<Select
					aria-label={label}
					className={styles.fullControl}
					value={value}
					options={CATEGORY_OPTIONS}
					onChange={(next) => onChange(next)}
				/>
			</div>
		);
	}
	return (
		<Form component={false} layout="vertical" requiredMark={false}>
			<Form.Item
				label={
					<>
						{label}
						{required ? (
							<span aria-hidden="true" className={styles.requiredStar}>
								*
							</span>
						) : null}
					</>
				}
			>
				<Select
					aria-label={label}
					className={styles.fullControl}
					value={value}
					options={CATEGORY_OPTIONS}
					onChange={(next) => onChange(next)}
				/>
			</Form.Item>
		</Form>
	);
}
