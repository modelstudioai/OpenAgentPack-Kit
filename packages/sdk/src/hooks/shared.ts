import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { createQuery } from "../state.ts";

/** Delayed disposal allows React StrictMode's effect replay without reviving a disposed identity. */
export function useLifecycle(controller: { dispose(): void }, start?: () => void) {
	const lifetime = useMemo(() => ({ epoch: 0, controller }), [controller]);
	useEffect(() => {
		const turn = ++lifetime.epoch;
		start?.();
		return () => {
			queueMicrotask(() => {
				if (lifetime.epoch === turn) lifetime.controller.dispose();
			});
		};
	}, [start, lifetime]);
}
export function useSnapshot<T>(controller: { getSnapshot(): T; subscribe(listener: () => void): () => void }) {
	return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
export function usePublicQuery<T>(load: (signal: AbortSignal) => Promise<T>, enabled = true) {
	const controller = useMemo(() => createQuery(load), [load]);
	const start = useCallback(() => {
		if (enabled) void controller.refresh();
	}, [controller, enabled]);
	useLifecycle(controller, start);
	return { ...useSnapshot(controller), reload: controller.refresh };
}
