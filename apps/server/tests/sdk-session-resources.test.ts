import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { createSdkGateway } from "../src/gateway/sdk.ts";

const gateway = () =>
	createSdkGateway({ apiKey: "sk-unit-test-credential", baseUrl: "https://provider.example.test/api/v1/agentstudio" });
afterEach(() => setDefaultFetch(fetch));

// 运行时挂载是新的 provider HTTP 合同：挂载 URL/body 前缀转换与卸载 DELETE 必须与
// 实测形状一致（docs/research/bailian-session-file-mount.md 2026-11-02 追测）。
describe("运行时会话资源的 SDK HTTP 合同", () => {
	it("挂载转换 /mnt/session 前缀并返回资源 id；卸载走 DELETE resources/:id", async () => {
		const calls: { method: string; url: URL; body?: Record<string, unknown> }[] = [];
		setDefaultFetch(async (input, init) => {
			const url = new URL(String(input));
			const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
			calls.push({ method: init?.method ?? "GET", url, body });
			if (init?.method === "POST" && url.pathname.endsWith("/resources")) {
				return Response.json({
					id: "sesrsc_1",
					type: "file",
					file_id: "file-copy-internal",
					mount_path: "/mnt/session/uploads/a.csv",
					memory_store_id: null,
					access: null,
					instructions: null,
					created_at: "2026-11-02T00:00:00Z",
					updated_at: "2026-11-02T00:00:00Z",
					request_id: "req-1",
				});
			}
			if (init?.method === "DELETE") {
				return Response.json({ id: "sesrsc_1", type: "session_resource_deleted", request_id: "req-2" });
			}
			return Response.json({ message: "unexpected" }, { status: 500 });
		});
		const mounted = await gateway().mountSessionResource("sesn_1", {
			fileId: "file-1",
			mountPath: "/mnt/session/uploads/a.csv",
		});
		expect(mounted).toEqual({ resourceId: "sesrsc_1", mountPath: "/mnt/session/uploads/a.csv" });
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url.pathname).toBe("/api/v1/agentstudio/sessions/sesn_1/resources");
		expect(calls[0]?.body).toEqual({ type: "file", file_id: "file-1", mount_path: "/uploads/a.csv" });
		await gateway().unmountSessionResource("sesn_1", "sesrsc_1");
		expect(calls[1]?.method).toBe("DELETE");
		expect(calls[1]?.url.pathname).toBe("/api/v1/agentstudio/sessions/sesn_1/resources/sesrsc_1");
	});
});
