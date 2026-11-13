import { createQuery } from "@openagentpack/kit-sdk/state";
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

/** key 必须包括查询目标；load 可内联，变更不会导致持久订阅反复启动。 */
export function useAdminQuery<T>(
	key: string,
	load: (signal: AbortSignal) => Promise<T>,
	options: { enabled?: boolean } = {},
) {
	const loader = useRef(load);
	useLayoutEffect(() => {
		loader.current = load;
	});
	// key 切换创建独立状态，禁止前一个项目的查询结果进入新项目。
	const controller = useMemo(() => {
		void key;
		return createQuery((signal) => loader.current(signal));
	}, [key]);
	const enabled = options.enabled !== false;
	useEffect(() => {
		if (enabled) void controller.refresh();
		return controller.dispose;
	}, [controller, enabled]);
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return { ...snapshot, refresh: controller.refresh };
}
