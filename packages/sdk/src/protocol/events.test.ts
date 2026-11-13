import { describe, expect, it } from "vitest";
import type { SessionEvent } from "./events.ts";
import {
	artifactOf,
	bucketOf,
	isSessionRemovedStatus,
	isTerminalSessionStatus,
	isTurnEndEvent,
	stableEventId,
	threadIdOf,
} from "./events.ts";

const ev = (over: Partial<SessionEvent>): SessionEvent => ({ type: "message", ...over });

describe("事件派生读取", () => {
	it("分桶覆盖已知类型", () => {
		expect(bucketOf("message")).toBe("message");
		expect(bucketOf("reasoning")).toBe("reasoning");
		expect(bucketOf("tool_call")).toBe("tool");
		expect(bucketOf("mcp_call_output")).toBe("tool");
		expect(bucketOf("thread_created")).toBe("thread");
		expect(bucketOf("session_status")).toBe("status");
		expect(bucketOf("error")).toBe("error");
		expect(bucketOf("never_seen_before")).toBe("other");
	});

	it("turn 结束判定", () => {
		expect(isTurnEndEvent(ev({ type: "session_status", metadata: { status: "idle" } }))).toBe(true);
		expect(isTurnEndEvent(ev({ type: "session_status", metadata: { status: "running" } }))).toBe(false);
		expect(isTurnEndEvent(ev({ type: "message", metadata: { status: "idle" } }))).toBe(false);
	});

	it("归属与引用分离，主线程不成为子 Agent，会话状态保持全局", () => {
		expect(threadIdOf(ev({ metadata: { thread_id: "thrd_main", session_thread_id: "sthr_target" } }))).toBeUndefined();
		expect(threadIdOf(ev({ metadata: { thread_id: "sthr_owner", session_thread_id: "sthr_target" } }))).toBe(
			"sthr_owner",
		);
		expect(
			threadIdOf(
				ev({ type: "thread_message_sent", metadata: { thread_id: "thrd_main", to_session_thread_id: "sthr_target" } }),
			),
		).toBeUndefined();
		expect(isTurnEndEvent(ev({ type: "session_status", metadata: { thread_id: "sthr_child", status: "idle" } }))).toBe(
			true,
		);
	});

	it("thread / artifact 读取", () => {
		expect(threadIdOf(ev({ metadata: { session_thread_id: "sthr_1" } }))).toBe("sthr_1");
		expect(threadIdOf(ev({}))).toBeUndefined();
		expect(artifactOf(ev({ metadata: { artifact: { file_id: "f_1", filename: "a.pdf" } } }))).toEqual({
			file_id: "f_1",
			filename: "a.pdf",
			content_type: undefined,
			size: undefined,
		});
		expect(artifactOf(ev({ metadata: { artifact: { filename: "x" } } }))).toBeUndefined();
	});

	it("稳定 id：有 event_id 用之，无则合成且稳定", () => {
		expect(stableEventId(ev({ event_id: "e_1" }))).toBe("e_1");
		const a = stableEventId(ev({ content: [{ type: "text", text: "hi" }] }));
		const b = stableEventId(ev({ content: [{ type: "text", text: "hi" }] }));
		const c = stableEventId(ev({ content: [{ type: "text", text: "ho" }] }));
		expect(a).toBe(b);
		expect(a).not.toBe(c);
		expect(a.startsWith("synthetic:")).toBe(true);
	});

	it("终止状态判定（与 SDK 同语义：idle 也算无进行中运行）", () => {
		expect(isTerminalSessionStatus("terminated")).toBe(true);
		expect(isTerminalSessionStatus("idle")).toBe(true);
		expect(isTerminalSessionStatus("running")).toBe(false);
		expect(isTerminalSessionStatus(undefined)).toBe(false);
	});

	it("移除状态判定", () => {
		expect(isSessionRemovedStatus("deleted")).toBe(true);
		expect(isSessionRemovedStatus("idle")).toBe(false);
	});
});
