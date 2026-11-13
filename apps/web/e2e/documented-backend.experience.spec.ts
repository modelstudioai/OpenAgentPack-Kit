import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { encodeFrame, type SessionEvent, type SseFrame } from "@openagentpack/kit-sdk/protocol";
import { expect, test } from "./fixtures.ts";

// 保护公开接入示例：独立 HTTP 后端采用不同路径/方法/JSON 包装，前端无需 Kit Context。
test("文档 SDK 通过实际 HTTP/SSE 连接独立后端，显示回复且只发送一次", async ({ page }) => {
	const streams = new Set<ServerResponse>();
	const writes: unknown[] = [];
	const identities: (string | undefined)[] = [];
	const protocolHeaders: (string | string[] | undefined)[] = [];
	const dataCalls: string[] = [];
	let creates = 0;
	let executions = 0;
	const summary = {
		session_id: "example-session",
		agent_slug: "demo",
		title: "独立详情",
		created_at: "2026-11-12T00:00:00Z",
		status: "idle",
	};
	const emit = (frame: SseFrame) => {
		for (const stream of streams) stream.write(encodeFrame(frame));
	};
	const event = (data: SessionEvent) => emit({ type: "event", data });
	const json = (res: ServerResponse, value: unknown) => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ payload: value }));
	};
	const routes: Record<string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>> = {
		"GET /v1/groups": (_req, res) => json(res, ["demo"]),
		"POST /v1/search": (_req, res) => json(res, { sessions: [summary], nextPageToken: null }),
		"GET /v1/detail/example-session": (_req, res) => json(res, summary),
		"PUT /v1/create": (_req, res) => {
			creates++;
			json(res, summary);
		},
		"PUT /v1/upload": (_req, res) => json(res, { file_id: "file", filename: "demo.txt", size: 4 }),
		"GET /v1/scan/file": (_req, res) => json(res, { file_id: "file", status: "available", available: true }),
		"PUT /v1/preview": (_req, res) =>
			json(res, {
				plan_id: "plan",
				confirm_token: "confirmation",
				expires_at: Date.now() + 60000,
				destructive: true,
				diff: [{ resource: "example-session", action: "delete", destructive: true }],
			}),
		"PATCH /v1/remove": async (req, res) => {
			let body = "";
			for await (const chunk of req) body += chunk;
			expect(JSON.parse(body)).toMatchObject({ plan_id: "plan", confirm_token: "confirmation" });
			executions++;
			json(res, { deleted: true });
		},
		"GET /v1/bytes/file": (_req, res) => {
			res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": 'attachment; filename="result.txt"' });
			res.end("artifact");
		},
	};
	const server = createServer(async (req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
		res.setHeader("Access-Control-Expose-Headers", "content-disposition,content-type");
		res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
		if (req.method === "OPTIONS") {
			res.writeHead(204).end();
			return;
		}
		identities.push(req.headers.authorization);
		protocolHeaders.push(req.headers["x-kit-protocol-version"]);
		dataCalls.push(`${req.method} ${req.url}`);
		const route = routes[`${req.method} ${req.url}`];
		if (route) {
			await route(req, res);
			return;
		}
		if (req.url?.startsWith("/v1/conversations/example-session/watch")) {
			res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
			streams.add(res);
			res.on("close", () => streams.delete(res));
			res.write(encodeFrame({ type: "reset", data: { session_id: "example-session" } }));
			res.write(
				encodeFrame({
					type: "event",
					data: { event_id: "state", type: "session_status", metadata: { status: "idle" } },
				}),
			);
			res.write(
				encodeFrame({
					type: "ready",
					data: { session_id: "example-session", after: null, replayed: 1, cursor: null },
				}),
			);
			return;
		}
		if (req.url === "/v1/reply" && req.method === "POST") {
			let body = "";
			for await (const chunk of req) body += chunk;
			const message = JSON.parse(body);
			writes.push(message);
			res.writeHead(202, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ payload: { session_id: "example-session", accepted: true, event_ids: ["user"] } }));
			event({ event_id: "state", type: "session_status", metadata: { status: "running" } });
			event({ event_id: "user", type: "message", role: "user", content: [{ type: "text", text: message.input }] });
			event({
				event_id: "answer",
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: `独立后端已收到：${message.input}` }],
			});
			event({ event_id: "state", type: "session_status", metadata: { status: "idle" } });
			return;
		}
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({ payload: { requires_action: false, batch_id: null, pending_call_ids: [], requests: [] } }),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("测试后端未启动");
	const unexpected: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/api/kit/")) unexpected.push(request.url());
	});
	try {
		await page.goto(
			`/e2e/fixtures/documented-backend.html?backend=${encodeURIComponent(`http://127.0.0.1:${address.port}`)}`,
		);
		await expect(page.getByRole("status", { name: "" }).filter({ hasText: "示例后端已连接" })).toBeVisible();
		await page.getByLabel("消息输入", { exact: true }).fill("公开 SDK 接入");
		await page.getByRole("button", { name: "发送", exact: true }).click();
		await expect(page.getByText("独立后端已收到：公开 SDK 接入", { exact: true })).toBeVisible();
		await page.getByLabel("消息输入", { exact: true }).fill("下一轮");
		await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
		expect(writes).toEqual([expect.objectContaining({ conversation: "example-session", input: "公开 SDK 接入" })]);
		await expect(page.getByText("目录分组：demo")).toBeVisible();
		await expect(page.getByText("详情：独立详情")).toBeVisible();
		await page
			.locator('input[type="file"]')
			.setInputFiles({ name: "demo.txt", mimeType: "text/plain", buffer: Buffer.from("demo") });
		await expect(page.getByText("demo.txt", { exact: true })).toBeVisible();
		await expect.poll(() => dataCalls.some((call) => call === "GET /v1/scan/file")).toBe(true);
		await page.getByRole("button", { name: "创建新示例会话" }).click();
		await page.getByLabel("消息输入", { exact: true }).fill("新会话首句");
		await page.getByRole("button", { name: "发送", exact: true }).click();
		await expect(page.getByText("独立后端已收到：新会话首句", { exact: true })).toBeVisible();
		expect(creates).toBe(1);
		await page.getByRole("button", { name: "准备删除示例会话" }).click();
		await expect(page.getByRole("alertdialog")).toContainText("example-session");
		expect(executions).toBe(0);
		await page.getByRole("button", { name: "确认", exact: true }).click();
		await expect.poll(() => executions).toBe(1);
		const downloaded = page.waitForEvent("download");
		await page.getByRole("button", { name: "下载示例产物" }).click();
		expect((await downloaded).suggestedFilename()).toBe("result.txt");
		expect(identities.every((value) => value === "Bearer example-user")).toBe(true);
		expect(protocolHeaders.every((value) => value === undefined)).toBe(true);
		expect(unexpected).toEqual([]);
	} finally {
		await page.goto("about:blank");
		for (const stream of streams) stream.end();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
