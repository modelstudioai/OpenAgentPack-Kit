import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolApprovalsResponse } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const headers = { "content-type": "application/json", "x-kit-protocol-version": "2.0.0", cookie: "kit_subject=owner" };
async function setup(text = "approval") {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-approval-"));
	const services = createKitServices(
		loadConfig({ KIT_GATEWAY: "mock", KIT_AUTH_MODE: "anonymous", KIT_DATA_DIR: dataDir, ADMIN_TOKEN: "test" }),
		openDatabase(dataDir),
	);
	services.catalog.upsert({ slug: "assistant", display_name: "Assistant", remote_agent_id: "mock" });
	services.catalog.setStatus("assistant", "listed");
	const app = createApp(services);
	const created = await app.request("/api/kit/sessions", {
		method: "POST",
		headers,
		body: JSON.stringify({ agent_slug: "assistant" }),
	});
	const { data: session } = (await created.json()) as { data: { session_id: string } };
	const path = `/api/kit/sessions/${session.session_id}`;
	expect(
		(await app.request(`${path}/messages`, { method: "POST", headers, body: JSON.stringify({ text }) })).status,
	).toBe(202);
	const list = async () => {
		const result = await app.request(`${path}/tool-approvals`, { headers });
		expect(result.status).toBe(200);
		return ((await result.json()) as { data: ToolApprovalsResponse }).data;
	};
	const decide = (body: unknown, customHeaders = headers) =>
		app.request(`${path}/tool-approvals`, { method: "POST", headers: customHeaders, body: JSON.stringify(body) });
	return { app, services, sessionId: session.session_id, path, list, decide };
}

describe("工具审批协议与归属", () => {
	it("同批逐项批准/无原因拒绝，保留子线程；完成前普通发送被拒且不扣 Credits", async () => {
		const { app, path, services, list, decide } = await setup("approval thread");
		const usedCredits = async () => {
			const response = await app.request("/api/kit/quota", { headers });
			expect(response.status).toBe(200);
			return ((await response.json()) as { data: { used: number } }).data.used;
		};
		const before = await list();
		expect(before.requires_action).toBe(true);
		expect(before.requests).toHaveLength(2);
		expect(before.requests.every((item) => item.actionable && item.session_thread_id === "sthr_mock_approval")).toBe(
			true,
		);
		expect(await usedCredits()).toBe(1);
		const blocked = await app.request(`${path}/messages`, {
			method: "POST",
			headers,
			body: JSON.stringify({ text: "不能绕过审批" }),
		});
		expect(blocked.status).toBe(409);
		expect(await blocked.json()).toMatchObject({ error: { code: "conflict" } });
		expect(await usedCredits()).toBe(1);
		const approve = { batch_id: before.batch_id, call_id: "call_read", result: "allow" };
		expect((await decide({ ...approve, session_thread_id: "forged", arguments: "changed" })).status).toBe(202);
		expect((await decide(approve)).status).toBe(409);
		const partial = await list();
		expect(partial.pending_call_ids).toEqual(["call_write"]);
		expect(partial.requires_action).toBe(true);
		expect((await decide({ batch_id: before.batch_id, call_id: "call_write", result: "deny" })).status).toBe(202);
		expect((await list()).requires_action).toBe(false);
		const history = await services.gateway.listEvents(path.split("/").at(-1)!);
		expect(
			history.events
				.filter((event) => event.type === "tool_approval_response")
				.every((event) => event.metadata?.session_thread_id === "sthr_mock_approval"),
		).toBe(true);
		// 审批响应本身不扣费；解除审批后新消息才再次受理扣费。
		expect(await usedCredits()).toBe(1);
		expect(
			(
				await app.request(`${path}/messages`, {
					method: "POST",
					headers,
					body: JSON.stringify({ text: "继续执行" }),
				})
			).status,
		).toBe(202);
		expect(await usedCredits()).toBe(2);
	});

	it("真实存在的会话对他人返回 404，过期批次和未知调用拒绝，拒绝原因限制 200 字", async () => {
		const { app, path, list, decide } = await setup();
		const state = await list();
		const other = { ...headers, cookie: "kit_subject=other" };
		expect((await app.request(`${path}/tool-approvals`, { headers: other })).status).toBe(404);
		expect((await decide({ batch_id: state.batch_id, call_id: "call_read", result: "allow" }, other)).status).toBe(404);
		expect((await decide({ batch_id: "expired", call_id: "call_read", result: "allow" })).status).toBe(409);
		expect((await decide({ batch_id: state.batch_id, call_id: "missing", result: "deny" })).status).toBe(409);
		expect(
			(await decide({ batch_id: state.batch_id, call_id: "call_read", result: "deny", deny_message: "拒".repeat(201) }))
				.status,
		).toBe(400);
	});

	it("同调用并发决定只发送一次，不确定结果不自动重发", async () => {
		const { services, list, decide } = await setup();
		const state = await list();
		const original = services.gateway.respondToolApproval.bind(services.gateway);
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		services.gateway.respondToolApproval = vi.fn(async (id, input) => {
			await blocked;
			return original(id, input);
		});
		const body = { batch_id: state.batch_id, call_id: "call_read", result: "allow" };
		const first = decide(body);
		await vi.waitFor(() => expect(services.gateway.respondToolApproval).toHaveBeenCalledOnce());
		expect((await decide(body)).status).toBe(409);
		release();
		expect((await first).status).toBe(202);
		services.gateway.respondToolApproval = vi.fn(async () => {
			throw new Error("network lost after POST");
		});
		const uncertain = { ...body, call_id: "call_write", result: "deny" };
		expect((await decide(uncertain)).status).toBe(502);
		expect((await decide(uncertain)).status).toBe(409);
		expect(services.gateway.respondToolApproval).toHaveBeenCalledOnce();
		await list();
		// 刷新只检查 Provider，不替用户重发。
		expect(services.gateway.respondToolApproval).toHaveBeenCalledOnce();
	});

	it("跨批次可再次处理同 call_id，旧批次永远不能批准新请求", async () => {
		const { app, path, services, sessionId, list, decide } = await setup();
		const first = await list();
		await services.gateway.interrupt(sessionId);
		expect(
			(
				await app.request(`${path}/messages`, {
					method: "POST",
					headers,
					body: JSON.stringify({ text: "approval new batch" }),
				})
			).status,
		).toBe(202);
		const second = await list();
		expect(second.batch_id).not.toBe(first.batch_id);
		expect((await decide({ batch_id: first.batch_id, call_id: "call_read", result: "allow" })).status).toBe(409);
		expect((await decide({ batch_id: second.batch_id, call_id: "call_read", result: "allow" })).status).toBe(202);
	});

	it("未知工具审批合同只读，不能通过 API 绕过确认", async () => {
		const { services, list, decide } = await setup();
		const original = services.gateway.listEvents.bind(services.gateway);
		services.gateway.listEvents = async (id, options) => {
			const page = await original(id, options);
			return {
				...page,
				events: page.events.map((event) =>
					event.type === "tool_approval_request"
						? {
								...event,
								content: [
									{
										type: "data",
										data: { ...(event.content?.[0]?.data as Record<string, unknown>), tool_type: "future-tool" },
									},
								],
							}
						: event,
				),
			};
		};
		const state = await list();
		expect(state.requests).toHaveLength(2);
		expect(state.requests.every((request) => !request.actionable)).toBe(true);
		expect((await decide({ batch_id: state.batch_id, call_id: "call_read", result: "allow" })).status).toBe(409);
	});

	it("混版发送、审批和流式请求明确拒绝", async () => {
		const { app, path, list } = await setup();
		const state = await list();
		const old = { ...headers, "x-kit-protocol-version": "1.0.0" };
		expect((await app.request(`${path}/stream`, { headers: old })).status).toBe(409);
		expect((await app.request(`${path}/tool-approvals`, { headers: old })).status).toBe(409);
		expect(
			(await app.request(`${path}/messages`, { method: "POST", headers: old, body: JSON.stringify({ text: "x" }) }))
				.status,
		).toBe(409);
		expect(state.requests).toHaveLength(2);
	});
});
