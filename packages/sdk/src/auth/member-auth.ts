import { AbortScope } from "../internal/abort-scope.ts";
import { abortableResponse } from "../internal/body.ts";
import { errorFromResponse, KitError, type MemberLoginRequest, type MemberView } from "../protocol/index.ts";
import type { ChatProvider } from "../providers/contract.ts";
import { createKitClient, type KitClient } from "../providers/kit/client.ts";
import { createRequest, type RequestClient } from "../request/index.ts";

export interface StoredMemberSession {
	access_token: string;
	expires_at: string;
}

/** 存储由宿主按完整 apiBaseUrl 隔离；core 不访问浏览器存储。 */
export interface MemberSessionStorage {
	load(): StoredMemberSession | null;
	save(session: StoredMemberSession | null): void;
}

export interface MemberAuthOptions {
	baseUrl: string;
	mode: "member" | "anonymous";
	storage: MemberSessionStorage;
	fetchImpl?: typeof fetch;
	/** 使用与自建后端相同的公开 Request/Provider 接入；每次身份绑定只创建一次。 */
	createChatProvider?: (request: RequestClient) => ChatProvider;
	/** Public data Client factory; the Request is bound to the same immutable identity as ChatProvider. */
	createClient?: (request: RequestClient) => KitClient;
}

export interface MemberAuthSnapshot {
	status: "checking" | "signed-out" | "signed-in" | "anonymous" | "error";
	member: MemberView | null;
	client: KitClient | null;
	chatProvider: ChatProvider | null;
	generation: number;
	error: string | null;
	pending: boolean;
}

interface Epoch {
	abort: AbortController;
	client: KitClient;
	chatProvider: ChatProvider | null;
}

/**
 * Kit 本地成员身份生命周期。每次身份绑定创建固定 token 的独立 client；旧 client 永久失效，
 * 因此延迟读取的附件、建会话重试与旧 SSE 都不能借新成员的身份继续执行。
 */
export function createMemberAuthController(options: MemberAuthOptions) {
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	const publicConnection = {
		baseUrl: options.baseUrl,
		fetchImpl: ((url, init) => fetchImpl(url, { ...init, credentials: "omit" })) as typeof fetch,
	};
	const makeClient = (connection: Parameters<typeof createRequest>[0]) =>
		options.createClient
			? options.createClient(createRequest({ ...connection, mapHttpError: errorFromResponse }))
			: createKitClient(connection as Parameters<typeof createKitClient>[0]);
	const publicClient = makeClient(publicConnection);
	const listeners = new Set<() => void>();
	let snapshot: MemberAuthSnapshot = {
		status: "checking",
		member: null,
		client: null,
		chatProvider: null,
		generation: 0,
		error: null,
		pending: false,
	};
	let epoch: Epoch | null = null;
	let expiryTimer: ReturnType<typeof setTimeout> | undefined;
	let session: StoredMemberSession | null = null;
	let pendingLogout: string | null = null;
	let started: Promise<void> | null = null;
	let disposed = false;
	let busy = false;

	function publish(patch: Partial<MemberAuthSnapshot>) {
		if (disposed) return;
		snapshot = { ...snapshot, ...patch };
		for (const listener of listeners) listener();
	}
	function detach(status: MemberAuthSnapshot["status"], pending = false) {
		epoch?.abort.abort();
		epoch = null;
		clearTimeout(expiryTimer);
		publish({
			status,
			pending,
			client: null,
			chatProvider: null,
			member: null,
			generation: snapshot.generation + 1,
			error: null,
		});
	}
	function clearStorage() {
		try {
			options.storage.save(null);
		} catch {
			/* 当前内存身份仍必须清除。 */
		}
	}
	function invalidate(owner: Epoch) {
		if (disposed || epoch !== owner) return;
		session = null;
		clearStorage();
		detach("signed-out");
		publish({ error: "登录已失效，请重新登录" });
	}
	function bind(token?: string): Epoch {
		const abort = new AbortController();
		const owner = { abort } as Epoch;
		const connection = {
			baseUrl: options.baseUrl,
			headers: (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}),
			fetchImpl: async (url: RequestInfo | URL, init?: RequestInit) => {
				abort.signal.throwIfAborted();
				const signal = init?.signal ? AbortSignal.any([abort.signal, init.signal]) : abort.signal;
				const scope = new AbortScope(signal);
				let response: Response | undefined;
				try {
					// 外层 Request 看不到身份 signal；等待响应头也必须在本次登录的取消边界内。
					response = await scope.wait(
						fetchImpl(url, { ...init, signal, credentials: token ? "omit" : "include" }),
						async (late) => {
							await late.body?.cancel().catch(() => undefined);
						},
					);
					scope.check();
					if (response.status === 401) invalidate(owner);
					// 响应返回后仍使用身份 signal；释放临时 scope 不得中断正常正文读取。
					return abortableResponse(response, signal);
				} catch (error) {
					await response?.body?.cancel().catch(() => undefined);
					throw error;
				} finally {
					scope.dispose();
				}
			},
		};
		const client = makeClient(connection);
		const provider = options.createChatProvider?.(createRequest({ ...connection, mapHttpError: errorFromResponse }));
		owner.chatProvider = provider
			? {
					transformMessage: provider.transformMessage?.bind(provider),
					...(provider.listThreads ? { listThreads: provider.listThreads.bind(provider) } : {}),
					...(provider.listThreadEvents ? { listThreadEvents: provider.listThreadEvents.bind(provider) } : {}),
					sendMessage: provider.sendMessage.bind(provider),
					interrupt: provider.interrupt.bind(provider),
					toolApprovals: provider.toolApprovals.bind(provider),
					submitToolApproval: provider.submitToolApproval.bind(provider),
					async stream(...args) {
						try {
							await provider.stream(...args);
						} catch (error) {
							if (error instanceof KitError && error.code === "unauthorized") invalidate(owner);
							throw error;
						}
					},
				}
			: null;
		owner.client = {
			...client,
			stream: async (...args: Parameters<KitClient["stream"]>) => {
				try {
					return await client.stream(...args);
				} catch (error) {
					if (error instanceof KitError && error.code === "unauthorized") invalidate(owner);
					throw error;
				}
			},
		};
		epoch = owner;
		return owner;
	}
	function activate(owner: Epoch, member: MemberView, value: StoredMemberSession) {
		if (epoch !== owner || disposed) return;
		const remaining = Date.parse(value.expires_at) - Date.now();
		if (!(remaining > 0)) throw new KitError("unauthorized", "登录已失效，请重新登录");
		session = value;
		expiryTimer = setTimeout(() => invalidate(owner), Math.min(remaining, 2_147_483_647));
		publish({
			status: "signed-in",
			pending: false,
			client: owner.client,
			chatProvider: owner.chatProvider,
			member,
			error: null,
		});
	}
	function signedOut() {
		if (options.mode === "anonymous") {
			const owner = bind();
			publish({
				status: "anonymous",
				client: owner.client,
				chatProvider: owner.chatProvider,
				member: null,
				pending: false,
			});
		} else publish({ status: "signed-out", client: null, member: null, pending: false });
	}
	async function revokePending() {
		if (!pendingLogout) return;
		const token = pendingLogout;
		await makeClient({
			baseUrl: options.baseUrl,
			headers: () => ({ Authorization: `Bearer ${token}` }),
			fetchImpl: (url, init) => fetchImpl(url, { ...init, credentials: "omit" }),
		}).auth.logout();
		if (pendingLogout === token) pendingLogout = null;
	}
	function loadSession() {
		let stored: StoredMemberSession | null;
		try {
			stored = options.storage.load();
		} catch {
			throw new Error("无法读取登录状态，请检查浏览器存储后重试");
		}
		if (
			stored &&
			((!options.createClient && !stored.access_token.startsWith("kit_member_")) ||
				!(Date.parse(stored.expires_at) > Date.now()))
		) {
			clearStorage();
			return null;
		}
		return stored;
	}
	function restoreFailed(error: unknown, owner: Epoch | null) {
		if (disposed || (owner && epoch !== owner)) return;
		if (owner && error instanceof KitError && error.code === "unauthorized") {
			invalidate(owner);
			return;
		}
		detach("error");
		publish({ error: "无法恢复登录状态，请检查服务连接后重试" });
	}
	async function restore() {
		if (disposed || busy) return;
		busy = true;
		detach("checking");
		let owner: Epoch | null = null;
		try {
			session = loadSession();
			if (!session) {
				signedOut();
				return;
			}
			owner = bind(session.access_token);
			const current = await owner.client.auth.me();
			if (disposed || epoch !== owner) return;
			if (!current.member || !current.expires_at) throw new KitError("unauthorized", "请使用本地成员账号登录");
			activate(owner, current.member, { ...session, expires_at: current.expires_at });
		} catch (error) {
			restoreFailed(error, owner);
		} finally {
			busy = false;
		}
	}
	async function logout() {
		if (disposed || busy) return;
		busy = true;
		pendingLogout ??= session?.access_token ?? null;
		session = null;
		clearStorage();
		detach("signed-out", true);
		try {
			await revokePending();
			if (!disposed) signedOut();
		} catch {
			publish({ status: "error", error: "服务端退出未完成，本地已锁定。请检查连接后重试退出。", pending: false });
		} finally {
			busy = false;
		}
	}
	async function acceptLogin(issued: StoredMemberSession, member: MemberView) {
		if (disposed) {
			pendingLogout = issued.access_token;
			await revokePending();
			return;
		}
		try {
			options.storage.save(issued);
		} catch {
			throw new Error("无法保存登录状态，请允许浏览器会话存储后重试");
		}
		activate(bind(issued.access_token), member, issued);
	}
	async function loginFailed(error: unknown, issued: StoredMemberSession | null) {
		if (issued) {
			pendingLogout = issued.access_token;
			clearStorage();
			try {
				await revokePending();
			} catch {
				/* 保留 token 供显式重试撤销。 */
			}
		}
		if (disposed) return;
		detach(pendingLogout ? "error" : "signed-out");
		const message = error instanceof Error ? error.message : "登录失败，请重试";
		publish({ error: pendingLogout ? "服务端退出未完成，本地已锁定，请检查连接后重试。" : message });
		throw error;
	}
	async function login(input: MemberLoginRequest) {
		if (disposed || busy) return;
		busy = true;
		pendingLogout ??= session?.access_token ?? null;
		session = null;
		clearStorage();
		detach("signed-out", true);
		let issued: StoredMemberSession | null = null;
		try {
			await revokePending();
			const result = await publicClient.auth.login(input);
			issued = { access_token: result.access_token, expires_at: result.expires_at };
			await acceptLogin(issued, result.member);
		} catch (error) {
			await loginFailed(error, issued);
		} finally {
			busy = false;
			publish({ pending: false });
		}
	}
	return {
		getSnapshot: () => snapshot,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		start: () => {
			started ??= restore();
			return started;
		},
		login,
		logout,
		retry: () => (pendingLogout ? logout() : restore()),
		dispose: () => {
			disposed = true;
			epoch?.abort.abort();
			epoch = null;
			clearTimeout(expiryTimer);
			listeners.clear();
		},
	};
}

export type MemberAuthController = ReturnType<typeof createMemberAuthController>;
