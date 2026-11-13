import { useEffect, useRef, useSyncExternalStore } from "react";
import type { MemberAuthController } from "../member-auth.ts";

/** 仅订阅与管理生命周期；认证、撤销和旧请求隔离统一由 SDK 数据处理层执行。 */
export function useMemberAuth(controller: MemberAuthController) {
	const mounts = useRef(0);
	const current = useRef(controller);
	useEffect(() => {
		current.current = controller;
		const epoch = ++mounts.current;
		void controller.start();
		return () => {
			queueMicrotask(() => {
				if (current.current !== controller || mounts.current === epoch) controller.dispose();
			});
		};
	}, [controller]);
	const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return { ...state, login: controller.login, logout: controller.logout, retry: controller.retry };
}
