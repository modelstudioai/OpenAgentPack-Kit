import {
	createChatController,
	createSessionStore,
	type SessionSnapshot,
	type SessionStoreOptions,
} from "@openagentpack/kit-sdk/chat";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";

// This owner is independent of React and must be disposed by its host.
export function observeSession(
	provider: ChatProvider,
	sessionId: string,
	onChange: (snapshot: SessionSnapshot) => void,
) {
	const controller = createChatController(provider, sessionId);
	const unsubscribe = controller.subscribe(() => onChange(controller.getSnapshot()));
	const dispose = () => {
		unsubscribe();
		controller.dispose();
	};
	const ready = controller.connect().catch((error) => {
		dispose();
		throw error;
	});
	return { controller, ready, dispose };
}

// Lower-level alternative: this host must feed SDK SessionEvent snapshots through
// applyEvent and manage lifecycle itself. Ordinary chat integrations use the owner above.
export function createLocalStore(sessionId: string, provider: ChatProvider) {
	const options: SessionStoreOptions = { transformMessage: provider.transformMessage?.bind(provider) };
	return createSessionStore(sessionId, options);
}
