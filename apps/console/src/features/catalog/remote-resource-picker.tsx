import { Button, Form, Select, Spin } from "antd";
import type { DefaultOptionType } from "antd/es/select";
import type { ComponentRef, ReactNode, Ref } from "react";
import { useImperativeHandle, useRef, useState } from "react";
import styles from "./catalog.module.less";

interface ResourceOption {
	id: string;
	name: string;
	disabled?: boolean;
	detail?: string;
}

interface RemoteResourceQuery {
	data: ResourceOption[];
	loading: boolean;
	error: string | null;
	refresh: () => Promise<unknown>;
}

type RemoteResourcePickerProps = {
	remote: RemoteResourceQuery;
	label: string;
	resource: string;
	placeholder: string;
	required?: boolean;
	error?: string;
	disabled?: boolean;
	/** 只需要 focus 句柄：表单校验失败时把焦点移到该选择器。 */
	triggerRef?: Ref<{ focus: () => void }>;
	showId?: boolean;
	emptyText?: string;
} & (
	| {
			multiple?: false;
			value: string;
			onChange: (value: string) => void;
			defaultOption?: ResourceOption;
	  }
	| {
			multiple: true;
			value: string[];
			onChange: (value: string[]) => void;
			maxSelections?: number;
			defaultOption?: never;
	  }
);

function resourceNoun(resource: string) {
	return resource === "Agent" ? ` ${resource}` : resource;
}

function notFoundContent(remote: RemoteResourceQuery, search: string, resource: string, emptyText?: string) {
	if (remote.loading)
		return (
			<div role="status" className={styles.pickerLoading}>
				<Spin size="small" />
				正在加载{resource}…
			</div>
		);
	if (remote.error)
		return (
			<div role="alert" className={styles.pickerErrorBlock}>
				<p className={styles.pickerErrorText}>{remote.error}</p>
				<Button
					size="small"
					onClick={() => {
						void remote.refresh();
					}}
				>
					重试
				</Button>
			</div>
		);
	const noun = resourceNoun(resource);
	return (
		<p role="status" className={styles.pickerEmpty}>
			{search.trim() ? `未找到匹配的${noun}` : (emptyText ?? `暂无远端${noun}`)}
		</p>
	);
}

function optionDetail(source: ResourceOption | undefined, showId: boolean): ReactNode {
	if (!source) return null;
	return (
		<div className={styles.optionDetail}>
			<div className={styles.optionName}>{source.name}</div>
			{showId && source.id ? <div className={styles.optionId}>{source.id}</div> : null}
			{source.detail ? <div className={styles.optionDetailText}>{source.detail}</div> : null}
		</div>
	);
}

function matchesQuery(source: ResourceOption | undefined, input: string) {
	return source ? `${source.name}\n${source.id}`.toLowerCase().includes(input.trim().toLowerCase()) : false;
}

function sourceOf(option: DefaultOptionType | undefined, byId: Map<string, ResourceOption>) {
	return typeof option?.value === "string" ? byId.get(option.value) : undefined;
}

/** 远端资源共用的表单下拉：展示全部候选，键盘与搜索交互保持一致。 */
export function RemoteResourcePicker(props: RemoteResourcePickerProps) {
	const { remote, label, resource, placeholder, required, error, disabled, triggerRef, showId = true } = props;
	const selectRef = useRef<ComponentRef<typeof Select>>(null);
	useImperativeHandle(triggerRef, () => ({ focus: () => selectRef.current?.focus() }), []);
	const [search, setSearch] = useState("");

	const atLimit = props.multiple && props.maxSelections !== undefined && props.value.length >= props.maxSelections;
	const selectedIds = new Set(props.multiple ? props.value : [props.value]);
	const hasSelection = props.multiple ? props.value.length > 0 : props.value !== "";
	const all = [
		...(props.defaultOption ? [props.defaultOption] : []),
		...(!remote.loading && !remote.error ? remote.data : []),
	];
	const optionById = new Map(all.map((option) => [option.id, option]));
	const options: DefaultOptionType[] = all.map((option) => ({
		value: option.id,
		label: option.name,
		disabled: props.multiple ? !selectedIds.has(option.id) && (option.disabled || atLimit) : option.disabled,
	}));
	const changeOpen = (next: boolean) => {
		if (disabled) return;
		if (next) {
			setSearch("");
			void remote.refresh();
		}
	};

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
				validateStatus={error ? "error" : undefined}
				help={error}
			>
				<Select
					ref={selectRef}
					aria-label={label}
					aria-invalid={Boolean(error)}
					status={error ? "error" : undefined}
					className={styles.fullControl}
					placeholder={placeholder}
					value={props.multiple || hasSelection ? props.value : undefined}
					mode={props.multiple ? "multiple" : undefined}
					options={options}
					disabled={disabled}
					showSearch
					optionRender={(option) => optionDetail(sourceOf(option, optionById), showId)}
					filterOption={(input, option) => matchesQuery(sourceOf(option, optionById), input)}
					onSearch={setSearch}
					onOpenChange={changeOpen}
					onChange={(value) => {
						if (props.multiple) props.onChange(value as string[]);
						else props.onChange(value as string);
					}}
					notFoundContent={notFoundContent(remote, search, resource, props.emptyText)}
				/>
			</Form.Item>
		</Form>
	);
}
