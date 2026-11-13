import type { SessionEvent } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it } from "vitest";
import { createEventBufferRegistry } from "../src/services/event-buffer.ts";

const ev = (id: string): SessionEvent => ({ event_id: id, type: "message", content: [{ type: "text", text: id }] });

describe("event buffer", () => {
	it("append 去重且通知订阅者", () => {
		const registry = createEventBufferRegistry();
		const seen: string[] = [];
		registry.subscribe("s1", (change) => {
			if (change) seen.push(change.event.event_id as string);
		});
		registry.append("s1", ev("e1"));
		registry.append("s1", ev("e1"));
		registry.append("s1", ev("e2"));
		expect(registry.get("s1")?.events.map((e) => e.event_id)).toEqual(["e1", "e2"]);
		expect(seen).toEqual(["e1", "e2"]);
	});

	it("seed 幂等（重建路径）", () => {
		const registry = createEventBufferRegistry();
		registry.seed("s1", [ev("e1"), ev("e2")]);
		registry.seed("s1", [ev("e2"), ev("e3")]);
		expect(registry.get("s1")?.events.map((e) => e.event_id)).toEqual(["e1", "e2", "e3"]);
	});
});

describe("快照与传输游标", () => {
	it("同 ID 更新原位置但生成新的传输游标，完整重复幂等", () => {
		const registry = createEventBufferRegistry();
		const first = registry.append("s", ev("e"))!;
		const update = { ...ev("e"), content: [{ type: "text", text: "累计完成" }] };
		const second = registry.append("s", update)!;
		expect(second.cursor).not.toBe(first.cursor);
		expect(registry.get("s")?.events).toEqual([update]);
		expect(registry.replay("s", first.cursor)).toEqual({ reset: false, changes: [second] });
		expect(registry.append("s", update)).toBeUndefined();
	});
	it("日志淘汰或 epoch 失效时重建最新集合，不能按 event_id 跳过更新", () => {
		const registry = createEventBufferRegistry({ maxChanges: 1 });
		const first = registry.append("s", ev("a"))!;
		registry.append("s", ev("b"));
		registry.append("s", ev("c"));
		expect(registry.replay("s", first.cursor).reset).toBe(true);
		expect(registry.replay("s", "a").reset).toBe(true);
		registry.reset("s");
		expect(registry.replay("s", first.cursor)).toEqual({ reset: true, changes: [] });
	});
});

describe("当前状态权威", () => {
	it("旧位置的状态快照更新仍成为当前主状态，子线程不会覆盖它", () => {
		const registry = createEventBufferRegistry();
		registry.append("s", { event_id: "old", type: "session_status", metadata: { status: "running" } });
		registry.append("s", { event_id: "new", type: "session_status", metadata: { status: "idle" } });
		registry.append("s", {
			event_id: "old",
			type: "session_status",
			metadata: {
				status: "idle",
				stop_reason: { type: "requires_action", pending_batch_id: "batch", pending_call_ids: ["call"] },
			},
		});
		registry.append("s", {
			event_id: "child",
			type: "thread_status",
			metadata: { session_thread_id: "sthr_child", status: "running" },
		});
		expect(registry.get("s")?.latestStatus?.event_id).toBe("old");
	});
});
