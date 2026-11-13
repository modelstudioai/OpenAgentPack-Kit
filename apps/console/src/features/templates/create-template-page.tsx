import type { PresetPackPreview } from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Empty, Result, Spin } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi } from "../../lib/api.ts";
import { useConsoleRoute } from "../navigation/console-router.tsx";
import { InnerLayout } from "../navigation/inner-layout.tsx";
import type { TemplateDisplayDraft } from "./template-draft.ts";
import { TemplateEditorPage, type TemplateEditorProps } from "./template-editor-page.tsx";
import { TemplatePresetPicker } from "./template-preset-picker.tsx";

type Props = Pick<TemplateEditorProps, "onSaved" | "onCancel" | "onPendingChange">;

export function CreateTemplatePage(props: Props) {
	const { route, navigate, complete } = useConsoleRoute();
	const [started, setStarted] = useState(false);
	const [importing, setImporting] = useState(false);
	const reportImportPending = useCallback(
		(pending: boolean) => {
			setImporting(pending);
			props.onPendingChange?.(pending);
		},
		[props.onPendingChange],
	);
	const [applied, setApplied] = useState<
		{ preset: PresetPackPreview; display?: TemplateDisplayDraft; revision: number } | undefined
	>();
	const importPreset = (preset: PresetPackPreview, display?: TemplateDisplayDraft) => {
		setApplied((current) => ({ preset, display, revision: (current?.revision ?? 0) + 1 }));
		complete({ page: "template-create" });
	};
	useEffect(() => {
		if (!started && !applied && !route.preset && route.step) complete({ ...route, step: undefined }, true);
	}, [started, applied, route, complete]);
	const selected = route.preset ? undefined : applied;
	const query = useAdminQuery(
		`templates:preset:${route.preset ?? "none"}`,
		(signal) => (route.preset ? adminApi.presetPacks.get(route.preset, signal) : Promise.resolve(undefined)),
		{ enabled: Boolean(route.preset) },
	);
	if (route.preset && !selected && query.error)
		return (
			<Result
				status="error"
				title="预设包加载失败"
				subTitle={query.error}
				extra={[
					<Button key="retry" onClick={() => void query.refresh()}>
						重试
					</Button>,
					<Button
						key="blank"
						onClick={() => {
							setStarted(true);
							navigate({ page: "template-create" });
						}}
					>
						创建空白智能体
					</Button>,
				]}
			/>
		);
	if (route.preset && !selected && (!query.data || query.loading)) return <Spin aria-label="正在加载预设包" />;
	const preset = selected?.preset ?? (route.preset ? query.data : undefined);
	if (!started && !preset)
		return (
			<section aria-labelledby="create-template-title" className="space-y-6 animate-(--kit-animate-in)">
				<InnerLayout titleId="create-template-title" title="创建智能体" onBack={props.onCancel} />
				<div className="flex min-h-80 items-center justify-center py-12">
					<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一种方式，开始创建智能体">
						<div className="flex flex-wrap justify-center gap-3">
							<TemplatePresetPicker
								buttonLabel="导入现有配置"
								disabled={importing}
								hasConfiguration={false}
								onPendingChange={reportImportPending}
								onImport={importPreset}
							/>
							<Button type="primary" disabled={importing} onClick={() => setStarted(true)}>
								从零开始创建
							</Button>
						</div>
					</Empty>
				</div>
			</section>
		);
	return (
		<div className="space-y-4 animate-(--kit-animate-in)">
			{preset ? <Alert type="success" showIcon title={`已导入预设包：${preset.remote_agent_name}`} /> : null}
			<TemplateEditorPage
				{...props}
				key={`${route.preset ?? "blank"}:${selected?.revision ?? 0}`}
				initialPresetPack={preset}
				initialDisplay={selected?.display}
				onImportPreset={preset ? importPreset : undefined}
			/>
		</div>
	);
}
