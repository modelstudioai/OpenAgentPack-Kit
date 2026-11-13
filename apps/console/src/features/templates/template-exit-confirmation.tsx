import { ConfirmDialog } from "@openagentpack/kit-chat-ui";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";

interface ExitGuard {
	requestExit: (exit: () => void) => void;
	setHasUnpublished: (value: boolean) => void;
}
const Context = createContext<ExitGuard | null>(null);

/** 菜单与编辑返回共用确认；确认后才卸载页面并触发既有批次清理。 */
export function TemplateExitConfirmationProvider({ children }: { children: ReactNode }) {
	const hasUnpublished = useRef(false);
	const [pendingExit, setPendingExit] = useState<(() => void) | null>(null);
	const guard = useMemo<ExitGuard>(
		() => ({
			requestExit: (exit) => {
				if (hasUnpublished.current) setPendingExit(() => exit);
				else exit();
			},
			setHasUnpublished: (value) => {
				hasUnpublished.current = value;
			},
		}),
		[],
	);
	return (
		<Context.Provider value={guard}>
			{children}
			{pendingExit ? (
				<ConfirmDialog
					title="确认退出"
					body="退出后未发布的内容将被清空，是否确认退出？"
					confirmLabel="确认退出"
					onCancel={() => setPendingExit(null)}
					onConfirm={() => {
						setPendingExit(null);
						pendingExit();
					}}
				/>
			) : null}
		</Context.Provider>
	);
}

export function useTemplateExitConfirmation() {
	const guard = useContext(Context);
	if (!guard) throw new Error("缺少模版退出确认上下文");
	return guard;
}

export function useTemplateUnpublishedExit(hasUnpublished: boolean) {
	const { setHasUnpublished } = useTemplateExitConfirmation();
	useEffect(() => {
		setHasUnpublished(hasUnpublished);
		// 刷新/关闭标签页只能使用浏览器提供的确认文案；取消时不会触发 pagehide 清理。
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		if (hasUnpublished) window.addEventListener("beforeunload", beforeUnload);
		return () => {
			setHasUnpublished(false);
			window.removeEventListener("beforeunload", beforeUnload);
		};
	}, [hasUnpublished, setHasUnpublished]);
}
