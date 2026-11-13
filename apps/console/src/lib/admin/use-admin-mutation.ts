import { createMutation } from "@openagentpack/kit-sdk/state";
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

export function useAdminMutation<Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>, key = "") {
	const actionRef = useRef(action);
	useLayoutEffect(() => {
		actionRef.current = action;
	});
	const controller = useMemo(() => {
		void key;
		return createMutation((...args: Args) => actionRef.current(...args));
	}, [key]);
	useEffect(() => controller.dispose, [controller]);
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return { ...snapshot, run: controller.run };
}
