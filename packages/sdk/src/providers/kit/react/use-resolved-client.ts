import type { KitClient } from "../client.ts";
import { useOptionalKitContext } from "./context.tsx";

export function useResolvedClient(explicit?: KitClient): KitClient {
	const context = useOptionalKitContext();
	const client = explicit ?? context?.client;
	if (!client) throw new Error("Provide a public Client explicitly, or use KitProvider for compatibility");
	return client;
}
