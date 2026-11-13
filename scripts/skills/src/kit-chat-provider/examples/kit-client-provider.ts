import type { ChatProvider } from "@openagentpack/kit-sdk/providers";
import { createKitChatProvider, type KitClient } from "@openagentpack/kit-sdk/providers/kit";

// Compatibility for applications that already own a complete KitClient.
export function wrapExistingKitClient(client: KitClient): ChatProvider {
	return createKitChatProvider(client);
}
