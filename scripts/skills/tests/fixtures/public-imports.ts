import {
	type ChatController,
	createChatController,
	createSessionStore,
	type SessionStoreOptions,
} from "@openagentpack/kit-sdk/chat";
import type { UseChatOptions, UseChatResult } from "@openagentpack/kit-sdk/chat/hooks";
import { type MessageTransformer, transformSessionEvent } from "@openagentpack/kit-sdk/messages";
import type { ChatProvider } from "@openagentpack/kit-sdk/providers";
import { streamProtocolFrames } from "@openagentpack/kit-sdk/providers/kit";
import type { createRequest as requestEntry } from "@openagentpack/kit-sdk/request";
import { createRequest } from "@openagentpack/kit-sdk/request";
import { createMutation, createObservable, createQuery } from "@openagentpack/kit-sdk/state";
import type { createSseStream as streamEntry } from "@openagentpack/kit-sdk/stream";
import { createSseStream } from "@openagentpack/kit-sdk/stream";

const localState = createObservable({ editing: false });
const query = createQuery(async () => "value");
const mutation = createMutation(async (value: string) => value);
const chatOptions: UseChatOptions = { sessionId: null, provider: null as unknown as ChatProvider };
const chatResult: UseChatResult | null = null;
const controllerSnapshot = (controller: ChatController): ReturnType<ChatController["getSnapshot"]> =>
	controller.getSnapshot();
const rootRequest: typeof requestEntry = createRequest;
const rootStream: typeof streamEntry = createSseStream;
void [
	localState,
	query,
	mutation,
	streamProtocolFrames,
	chatOptions,
	chatResult,
	controllerSnapshot,
	rootRequest,
	rootStream,
];

// Existing five-operation providers remain valid; standalone stores can use the same conversion.
export function messageProjectionConsumer(legacyProvider: Omit<ChatProvider, "transformMessage">) {
	const provider: ChatProvider = legacyProvider;
	const transformMessage: MessageTransformer = transformSessionEvent;
	const options: SessionStoreOptions = { transformMessage };
	return { controller: createChatController(provider, "session"), store: createSessionStore("session", options) };
}
