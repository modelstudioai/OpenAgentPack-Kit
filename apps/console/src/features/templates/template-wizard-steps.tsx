import { Steps } from "antd";
import { useEffect, useRef } from "react";

const STEPS = [
	{ id: "config", label: "选择配置" },
	{ id: "preview", label: "预览调试" },
] as const;
export type TemplateStep = (typeof STEPS)[number]["id"];

export function TemplateWizardSteps({
	step,
	busy,
	canPreview,
	editing,
	onSelect,
}: {
	step: TemplateStep;
	busy: boolean;
	canPreview: boolean;
	editing: boolean;
	onSelect: (step: TemplateStep) => void;
}) {
	const nav = useRef<HTMLElement>(null);
	const previous = useRef(step);
	useEffect(() => {
		if (previous.current === step) return;
		nav.current?.scrollIntoView({ block: "start" });
		previous.current = step;
	}, [step]);
	return (
		<nav ref={nav} aria-label={editing ? "编辑模版步骤" : "新建模版步骤"} className="mx-auto mb-6 w-full max-w-xl">
			<Steps
				size="middle"
				current={STEPS.findIndex(({ id }) => id === step)}
				items={STEPS.map(({ id, label }) => ({
					title: label,
					disabled: busy || (id === "preview" && !canPreview),
				}))}
				onChange={(index) => {
					const next = STEPS[index];
					if (next) onSelect(next.id);
				}}
			/>
		</nav>
	);
}
