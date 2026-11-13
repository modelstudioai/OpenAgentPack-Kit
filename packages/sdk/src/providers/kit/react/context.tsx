import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { KitClient } from "../client.ts";

const KitContext = createContext<{ client: KitClient } | null>(null);

export function KitProvider({ client, children }: { client: KitClient; children: ReactNode }) {
	const value = useMemo(() => ({ client }), [client]);
	return <KitContext.Provider value={value}>{children}</KitContext.Provider>;
}

/** 仅供可注入 Provider 的 Hook 使用；公开 Context/Client Hook 仍要求 KitProvider。 */
export function useOptionalKitContext() {
	return useContext(KitContext);
}

export function useKitContext() {
	const ctx = useOptionalKitContext();
	if (!ctx) throw new Error("kit-sdk/providers/kit/react: 组件必须位于 <KitProvider> 内");
	return ctx;
}

export function useKitClient(): KitClient {
	return useKitContext().client;
}
