import type { PresetPackAgentResources, PresetPackPreview } from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Drawer, Modal, Spin } from "antd";
import { useEffect, useState } from "react";
import { PresetPackResourceSelection, usePresetPackResources } from "../preset-packs/preset-pack-session-resources.tsx";
import type { TemplateAgentSelection } from "./template-local-resources.tsx";

function DetectionStatus({
	query,
	checking,
	onClose,
}: {
	query: ReturnType<typeof usePresetPackResources>;
	checking: boolean;
	onClose: () => void;
}) {
	return (
		<section aria-label="关联运行时资源检测" className="space-y-4">
			{checking ? (
				<div role="status" className="flex items-center gap-2">
					<Spin size="small" />
					正在检测关联的运行时资源…
				</div>
			) : (
				<Alert
					type={query.error ? "error" : "warning"}
					showIcon
					title={query.error ? "运行时资源检测失败" : "运行时资源未完整读取"}
					description={query.error ?? "暂未检测到已成功读取的资源，可重试以补齐结果。"}
					action={<Button onClick={() => void query.refresh()}>重试</Button>}
				/>
			)}
			<Button onClick={onClose}>取消检测</Button>
		</section>
	);
}

/** 仅由基础配置的显式远端选择挂载；取消或离开即释放查询，不对已有表单做自动回填。 */
export function TemplateAgentRuntimeResources({
	agent,
	initialResources,
	onApply,
	onClose,
}: {
	agent: TemplateAgentSelection;
	initialResources?: PresetPackAgentResources;
	onApply: (preset: PresetPackPreview) => void;
	onClose: () => void;
}) {
	const query = usePresetPackResources(agent.agent_id, { initialData: initialResources });
	const [phase, setPhase] = useState<"prompt" | "opening" | "select" | "closing">("prompt");
	const [preparing, setPreparing] = useState(false);
	const [actionContainer, setActionContainer] = useState<HTMLDivElement | null>(null);
	const [feedbackContainer, setFeedbackContainer] = useState<HTMLDivElement | null>(null);
	const hasResources = Boolean(query.data?.sessions.some((session) => session.resources.length));
	const checking = query.loading || (!query.data && !query.error);
	useEffect(() => {
		if (!checking && !query.error && query.data?.complete && !hasResources) onClose();
	}, [checking, query.error, query.data, hasResources, onClose]);
	const closeSelection = () => {
		if (!preparing) setPhase("closing");
	};
	return (
		<>
			{checking || query.error || (!hasResources && query.data && !query.data.complete) ? (
				<DetectionStatus query={query} checking={checking} onClose={onClose} />
			) : null}
			<Modal
				title="关联运行时资源"
				open={!checking && !query.error && hasResources && phase === "prompt"}
				okText="确定"
				cancelText="取消"
				onOk={() => setPhase("opening")}
				onCancel={closeSelection}
				afterOpenChange={(visible) => {
					if (visible) return;
					if (phase === "opening") setPhase("select");
					else if (phase === "closing") onClose();
				}}
			>
				<p>检测到当前配置有关联的运行时资源，是否直接使用？</p>
			</Modal>
			<Drawer
				title="选择运行时资源"
				size="large"
				open={phase === "select"}
				onClose={closeSelection}
				closable={!preparing}
				maskClosable={!preparing}
				keyboard={!preparing}
				destroyOnHidden
				afterOpenChange={(visible) => {
					if (!visible && phase === "closing") onClose();
				}}
				footer={
					<div className="space-y-4">
						<div ref={setFeedbackContainer} className="empty:hidden" />
						<div className="flex justify-end gap-2">
							<Button disabled={preparing} onClick={closeSelection}>
								取消
							</Button>
							<div ref={setActionContainer} />
						</div>
					</div>
				}
			>
				<p className="mb-4 text-sm">点击资源行查看配置后确认选择，保留当前基础配置；选择环境将替换当前环境。</p>
				<PresetPackResourceSelection
					agent={{ ...agent, version: agent.agent_version ?? agent.version }}
					query={query}
					requireSelection
					actionLabel="使用所选资源"
					actionContainer={actionContainer}
					feedbackContainer={feedbackContainer}
					onPendingChange={setPreparing}
					onImport={(preset) => {
						onApply(preset);
						setPhase("closing");
					}}
				/>
			</Drawer>
		</>
	);
}
