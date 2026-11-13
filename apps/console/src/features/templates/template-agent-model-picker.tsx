import type { Ref } from "react";
import { RemoteResourcePicker } from "../catalog/remote-resource-picker.tsx";
import { MANAGED_AGENT_MODELS } from "./managed-agent-models.ts";

const refresh = async () => undefined;

/** 当前模型目录固定在本地；只展示名称，选中后保存实际模型 ID。 */
export function TemplateAgentModelPicker({
	value,
	onChange,
	error,
	disabled,
	triggerRef,
	options = MANAGED_AGENT_MODELS,
}: {
	value: string;
	onChange: (id: string) => void;
	error?: string;
	disabled?: boolean;
	triggerRef?: Ref<{ focus: () => void }>;
	options?: readonly { id: string; name: string }[];
}) {
	return (
		<RemoteResourcePicker
			label="模型"
			resource="模型"
			placeholder="请选择模型"
			required
			error={error}
			disabled={disabled}
			triggerRef={triggerRef}
			showId={false}
			emptyText="暂无可选模型"
			value={value}
			onChange={onChange}
			remote={{ data: [...options], loading: false, error: null, refresh }}
		/>
	);
}
