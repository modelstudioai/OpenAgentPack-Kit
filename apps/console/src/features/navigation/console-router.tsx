import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useTemplateExitConfirmation } from "../templates/template-exit-confirmation.tsx";
import { type ConsoleRoute, consoleRouteHref, parseConsoleRoute, sameTemplateForm } from "./console-route.ts";

const INDEX = "kitConsoleIndex";
interface Router {
	route: ConsoleRoute;
	navigate: (route: ConsoleRoute) => void;
	/** 已完成保存/发布或页内确认后的定位同步，不重复执行离页确认。 */
	complete: (route: ConsoleRoute, replace?: boolean) => void;
	locked: boolean;
	setLocked: (locked: boolean) => void;
}
const Context = createContext<Router | null>(null);

export function ConsoleRouter({ children }: { children: ReactNode }) {
	const { requestExit } = useTemplateExitConfirmation();
	const [route, setRoute] = useState(() => parseConsoleRoute(window.location));
	const [locked, setLockedState] = useState(false);
	const lockedRef = useRef(false);
	const current = useRef({ route, index: Number(window.history.state?.[INDEX]) || 0 });
	const moving = useRef(false);
	const setLocked = useCallback((value: boolean) => {
		lockedRef.current = value;
		setLockedState(value);
	}, []);
	const commit = useCallback((next: ConsoleRoute, replace = false) => {
		if (moving.current) return;
		const href = consoleRouteHref(next);
		if (href === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
		const index = current.current.index + (replace ? 0 : 1);
		window.history[replace ? "replaceState" : "pushState"]({ ...window.history.state, [INDEX]: index }, "", href);
		const normalized = parseConsoleRoute(window.location);
		current.current = { route: normalized, index };
		setRoute(normalized);
	}, []);
	const navigate = useCallback(
		(next: ConsoleRoute) => {
			if (lockedRef.current || moving.current || consoleRouteHref(next) === consoleRouteHref(current.current.route))
				return;
			if (sameTemplateForm(current.current.route, next)) commit(next);
			else
				requestExit(() => {
					if (!lockedRef.current) commit(next);
				});
		},
		[commit, requestExit],
	);

	useEffect(() => {
		window.history.replaceState(
			{ ...window.history.state, [INDEX]: current.current.index },
			"",
			consoleRouteHref(current.current.route),
		);
		// popstate 已移动地址，但在确认之前不卸载页面。先回到当前条目，确认后再遍历原历史。
		let restoring: { route: ConsoleRoute; index: number } | undefined;
		let approved: number | undefined;
		const finishRestore = (target: { route: ConsoleRoute; index: number }) => {
			restoring = undefined;
			moving.current = false;
			const proceed = () => {
				if (lockedRef.current || moving.current) return;
				approved = target.index;
				moving.current = true;
				window.history.go(target.index - current.current.index);
			};
			if (lockedRef.current) return;
			if (sameTemplateForm(current.current.route, target.route)) proceed();
			else requestExit(proceed);
		};
		const restoreEntry = (index: number) => {
			if (index !== current.current.index) window.history.go(current.current.index - index);
			else if (restoring) finishRestore(restoring);
		};
		const onPop = (event: PopStateEvent) => {
			const index = event.state?.[INDEX];
			if (typeof index !== "number") return;
			if (restoring) {
				restoreEntry(index);
				return;
			}
			if (approved === index) {
				approved = undefined;
				moving.current = false;
				const next = parseConsoleRoute(window.location);
				current.current = { route: next, index };
				setRoute(next);
				return;
			}
			if (index === current.current.index) return;
			restoring = { route: parseConsoleRoute(window.location), index };
			moving.current = true;
			window.history.go(current.current.index - index);
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, [requestExit]);
	return (
		<Context.Provider value={{ route, navigate, complete: commit, locked, setLocked }}>{children}</Context.Provider>
	);
}

export function useConsoleRoute() {
	const router = useContext(Context);
	if (!router) throw new Error("缺少管理端路由上下文");
	return router;
}
