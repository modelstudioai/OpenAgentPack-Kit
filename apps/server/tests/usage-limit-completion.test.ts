import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionEvent, type SseFrame, sessionStatusOf } from "@openagentpack/kit-sdk/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import type { GatewaySessionInfo } from "../src/gateway/types.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";
import { createMemberStore } from "../src/store/members.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function status(id: string, state: string, reason = "completed", child = false): SessionEvent {
	return {
		event_id: id,
		type: child ? "thread_status" : "session_status",
		// 创建时间不会因同 ID 快照更新而改变，不能作为完成的新旧依据。
		created_at: "2026-10-01T00:00:00.000Z",
		metadata: {
			status: state,
			stop_reason: { type: reason },
			...(child ? { session_thread_id: "sthr_child" } : {}),
		},
	};
}

async function ready(iterator: AsyncGenerator<SseFrame>) {
	for (;;) {
		const frame = await iterator.next();
		if (frame.done) throw new Error("stream ended before ready");
		if (frame.value.type === "ready") return;
	}
}

async function setup(reuseAcrossTurns = false) {
	const directory = mkdtempSync(join(tmpdir(), "kit-limit-completion-"));
	cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
	const db = openDatabase(directory);
	cleanups.push(() => db.close());
	const services = createKitServices(loadConfig({ KIT_GATEWAY: "mock", KIT_DATA_DIR: directory }), db);
	const now = new Date().toISOString();
	createMemberStore(db).create(
		{
			member_id: "member",
			username: "member",
			display_name: "Member",
			auth_type: "local",
			status: "active",
			created_at: now,
			updated_at: now,
		},
		"unused",
	);
	const session = await services.sessions.create({
		subjectId: "member",
		agentSlug: "demo",
		remoteAgentId: "agent_mock_assistant",
	});
	const id = session.session_id;
	const events = [status("shared-status", "idle")];
	let detail: GatewaySessionInfo = {
		session_id: id,
		status: "idle",
		usage: { input_tokens: 0, output_tokens: 0 },
		stats: { active_seconds: 0 },
	};
	const listeners = new Set<(event: SessionEvent) => void>();
	let turn = 0;
	const statusId = () => (reuseAcrossTurns ? "shared-status" : `turn-${turn}-status`);
	function publish(event: SessionEvent) {
		const position = events.findIndex((previous) => previous.event_id === event.event_id);
		if (position < 0) events.push(event);
		else events[position] = event;
		for (const listener of listeners) listener(event);
	}
	vi.spyOn(services.gateway, "getSession").mockImplementation(async () => detail);
	vi.spyOn(services.gateway, "listEvents").mockImplementation(async () => ({
		events: [...events],
		next_page_token: null,
	}));
	services.gateway.streamEvents = async function* (_sessionId, options = {}) {
		const queue: SessionEvent[] = [];
		let wake: (() => void) | undefined;
		const receive = (event: SessionEvent) => {
			queue.push(event);
			wake?.();
		};
		const abort = () => wake?.();
		listeners.add(receive);
		options.signal?.addEventListener("abort", abort, { once: true });
		options.onReady?.();
		try {
			while (!options.signal?.aborted) {
				const event = queue.shift();
				if (event) yield event;
				else await new Promise<void>((resolve) => (wake = resolve));
			}
		} finally {
			listeners.delete(receive);
			options.signal?.removeEventListener("abort", abort);
		}
	};
	const send = vi.spyOn(services.gateway, "sendMessage").mockImplementation(async () => {
		turn += 1;
		detail = { ...detail, status: "running", stop_reason: undefined };
		// Provider 先创建主状态，后创建用户消息；完成时只原位更新主状态。
		publish(status(statusId(), "running", ""));
		publish({ event_id: `message-${turn}`, type: "message", role: "user", content: [] });
		return { event_ids: [`message-${turn}`] };
	});
	services.usageLimits.setPolicy(
		{ monthly_tokens: 10000, monthly_active_seconds: null, daily_tokens: null, daily_active_seconds: null },
		"admin",
	);
	function complete(reason = "completed") {
		detail = {
			...detail,
			status: "idle",
			stop_reason: { type: reason },
			usage: { input_tokens: 120 * turn, output_tokens: 80 * turn },
		};
		publish(status(statusId(), "idle", reason));
	}
	async function open() {
		const controller = new AbortController();
		const iterator = services.sessions.openStream(id, { signal: controller.signal });
		const close = async () => {
			controller.abort();
			await iterator.return(undefined);
		};
		cleanups.push(close);
		await ready(iterator);
		return close;
	}
	return {
		services,
		id,
		events,
		send,
		publish,
		complete,
		open,
		run: (key: string) => services.sessions.send(id, { text: "hello", clientMessageId: key }),
		staleIdle: () => {
			detail = { ...detail, status: "idle", stop_reason: { type: "completed" } };
			publish(status("shared-status", "idle"));
		},
		waitForState: (state: string) =>
			vi.waitFor(() => {
				const latest = services.buffers.get(id)?.latestStatus;
				expect(latest && sessionStatusOf(latest)).toBe(state);
			}),
	};
}

describe("月度限额的主会话完成证据", () => {
	it("同 ID 主状态在用户消息前创建并原位结束，重连后仍可连续发送", async () => {
		const f = await setup();
		for (let round = 1; round <= 3; round += 1) {
			await expect(f.run(`round-${round}`)).resolves.toEqual({ event_ids: [`message-${round}`] });
			f.complete();
			expect(f.events.findIndex((event) => event.event_id === `turn-${round}-status`)).toBeLessThan(
				f.events.findIndex((event) => event.event_id === `message-${round}`),
			);
			// 没有浏览器订阅时，泵仍会消费到终态再释放；下一轮必须通过历史重建。
			await vi.waitFor(() => expect(f.services.buffers.get(f.id)).toBeUndefined());
		}
		expect((await f.services.usageLimits.member("member")).tokens).toMatchObject({ used: 600, status: "ok" });
	});

	it("跨轮完全复用主状态身份和值时，使用同一订阅中的更新顺序而非历史位置", async () => {
		const f = await setup(true);
		await f.open();
		for (let round = 1; round <= 2; round += 1) {
			await f.run(`round-${round}`);
			await f.waitForState("running");
			f.complete();
			await f.waitForState("idle");
			// 结束后用户回显仍可更新，不得抹掉早于 idle 的首次回显证据。
			f.publish({
				event_id: `message-${round}`,
				type: "message",
				role: "user",
				content: [{ type: "text", text: "confirmed" }],
			});
			await vi.waitFor(() =>
				expect(
					f.services.buffers.get(f.id)?.events.find((event) => event.event_id === `message-${round}`)?.content,
				).toEqual([{ type: "text", text: "confirmed" }]),
			);
		}
		await expect(f.run("round-3")).resolves.toEqual({ event_ids: ["message-3"] });
	});

	it("重建后的游标增大不能把同身份旧 idle 当作本轮完成", async () => {
		const f = await setup(true);
		const close = await f.open();
		const firstEpoch = f.services.buffers.get(f.id)?.epoch;
		await f.run("round-1");
		await f.waitForState("running");
		await close();
		f.staleIdle();
		await vi.waitFor(() => expect(f.services.buffers.get(f.id)).toBeUndefined());
		// 新世代的状态排列在消息后，序号也更大，但没有跨世代更新证据。
		f.events.push(f.events.shift()!);
		await f.open();
		expect(f.services.buffers.get(f.id)?.epoch).not.toBe(firstEpoch);
		await expect(f.run("round-2")).rejects.toMatchObject({ code: "conflict" });
		expect(f.send).toHaveBeenCalledTimes(1);
	});

	it("Provider 详情旧 idle、子线程结束和等待审批均不能解除上一轮保护", async () => {
		const f = await setup();
		await f.run("round-1");
		f.staleIdle();
		f.publish(status("child-finished", "idle", "completed", true));
		await expect(f.run("round-2")).rejects.toMatchObject({ code: "conflict" });
		f.complete("requires_action");
		await expect(f.run("round-2")).rejects.toMatchObject({ code: "conflict" });
		expect(f.send).toHaveBeenCalledTimes(1);
		f.complete();
		await expect(f.run("round-2")).resolves.toEqual({ event_ids: ["message-2"] });
	});
});
