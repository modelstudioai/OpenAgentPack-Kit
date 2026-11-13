import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteVaultDetailSchema } from "@openagentpack/kit-sdk/protocol";
import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createSdkGateway } from "../src/gateway/sdk.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const gateway = () =>
	createSdkGateway({ apiKey: "test-provider-key", baseUrl: "https://provider.example.test/api/v1/agentstudio" });
afterEach(() => {
	vi.restoreAllMocks();
	setDefaultFetch(fetch);
});

it("公开 SDK runtime 分页读取密钥，详情仅投影名称/变量名/域名，忽略 auth 值与额外属性", async () => {
	const calls: URL[] = [];
	const secret = "test-value-never-returned";
	const credential = (id: string) => ({
		id,
		display_name: `服务 ${id}`,
		metadata: { private: secret },
		auth: {
			type: "environment_variable",
			secret_name: "SERVICE_TOKEN",
			secret_value: secret,
			networking: { allowed_hosts: ["api.example.com", "*.example.org"], private: secret },
			injection_location: { header: true },
		},
	});
	setDefaultFetch(async (input) => {
		const url = new URL(String(input));
		calls.push(url);
		if (url.pathname.endsWith("/vaults/vlt_test"))
			return Response.json({ id: "vlt_test", display_name: "服务密钥库", metadata: { secret } });
		expect(url.pathname).toBe("/api/v1/agentstudio/vaults/vlt_test/credentials");
		return Response.json(
			url.searchParams.has("page")
				? { data: [credential("cred_1"), { id: "cred_2", auth: { secret_value: secret } }], has_more: false }
				: { data: [credential("cred_1")], has_more: true, next_page: "opaque+page/=" },
		);
	});
	const result = await gateway().getRemoteVaultDetail("vlt_test");
	expect(result).toEqual({
		vault_id: "vlt_test",
		name: "服务密钥库",
		credentials: [
			{
				credential_id: "cred_1",
				name: "服务 cred_1",
				secret_name: "SERVICE_TOKEN",
				allowed_hosts: ["api.example.com", "*.example.org"],
			},
			{ credential_id: "cred_2", name: "cred_2", secret_name: "", allowed_hosts: [] },
		],
	});
	expect(RemoteVaultDetailSchema.safeParse(result).success).toBe(true);
	expect(JSON.stringify(result)).not.toMatch(/test-value-never-returned|auth|secret_value|metadata|injection_location/);
	expect(calls.map((url) => url.searchParams.get("page"))).toEqual([null, null, "opaque+page/="]);
});

it("空库返回空列表；文本脱敏，错误正文和错误形状不泄露到上层", async () => {
	let response: unknown = { data: [] };
	let status = 200;
	setDefaultFetch(async (input) =>
		String(input).includes("/credentials")
			? Response.json(response, { status })
			: Response.json({ id: "vlt_test", display_name: "库 Bearer test-provider-key" }),
	);
	const sdk = gateway();
	expect(await sdk.getRemoteVaultDetail("vlt_test")).toEqual({
		vault_id: "vlt_test",
		name: "库 [redacted]",
		credentials: [],
	});
	response = {
		data: [
			{
				id: "cred_1",
				display_name: "Bearer test-provider-key",
				auth: {
					secret_name: "secret=private-value",
					networking: { allowed_hosts: ["https://user:pass@example.com/?token=private-value"] },
				},
			},
		],
	};
	expect((await sdk.getRemoteVaultDetail("vlt_test"))?.credentials).toEqual([
		{
			credential_id: "cred_1",
			name: "[redacted]",
			secret_name: "secret=[redacted]",
			allowed_hosts: ["https://example.com/"],
		},
	]);
	response = { data: [{ display_name: "bad shape" }] };
	await expect(sdk.getRemoteVaultDetail("vlt_test")).rejects.toMatchObject({
		code: "provider_error",
		message: "密钥列表数据无效，请稍后重试",
	});
	status = 500;
	response = { message: "test-provider-key private-value" };
	await expect(sdk.getRemoteVaultDetail("vlt_test")).rejects.toMatchObject({
		code: "provider_error",
		message: "密钥库详情查询失败，请稍后重试",
	});
});

it("非法 ID 不请求 Provider；不存在、归档或 ID 不一致的库不能继续查询密钥", async () => {
	const request = vi.fn(async () => Response.json({ id: "vlt_test", archived_at: "2026-11-02" }));
	setDefaultFetch(request);
	const sdk = gateway();
	for (const id of ["vlt_test/credentials", "vlt_test?expand=credentials", "vlt_test%2Fcredentials"])
		await expect(sdk.getRemoteVaultDetail(id)).rejects.toMatchObject({ code: "invalid_request" });
	expect(request).not.toHaveBeenCalled();
	expect(await sdk.getRemoteVaultDetail("vlt_test")).toBeNull();
	request.mockResolvedValueOnce(Response.json({ message: "not found" }, { status: 404 }));
	expect(await sdk.getRemoteVaultDetail("vlt_test")).toBeNull();
	request.mockResolvedValueOnce(Response.json({ id: "another_vault" }));
	await expect(sdk.getRemoteVaultDetail("vlt_test")).rejects.toMatchObject({
		code: "provider_error",
		message: "密钥库信息不一致，请稍后重试",
	});
	expect(request).toHaveBeenCalledTimes(3);
});

it("详情只供管理员和审计员读取，不缓存；未认证拒绝、缺失库404、查看不执行写操作", async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "kit-vault-detail-"));
	const db = openDatabase(dataDir);
	try {
		const services = createKitServices(
			loadConfig({
				KIT_GATEWAY: "mock",
				KIT_DATA_DIR: dataDir,
				ADMIN_TOKEN: "admin",
				KIT_ADMIN_TOKENS: "auditor:auditor",
			}),
			db,
		);
		const app = createApp(services);
		const detail = vi.spyOn(services.gateway, "getRemoteVaultDetail");
		const path = "/api/admin/remote/vaults/vlt_mock_1";
		for (const token of ["admin", "auditor"]) {
			const response = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			const body = (await response.json()) as { data: unknown };
			expect(RemoteVaultDetailSchema.parse(body.data).credentials[0]?.secret_name).toBe("SERVICE_TOKEN");
		}
		detail.mockClear();
		expect((await app.request(path)).status).toBe(401);
		expect((await app.request(path, { headers: { authorization: "Bearer invalid" } })).status).toBe(403);
		expect(detail).not.toHaveBeenCalled();
		expect(
			(await app.request("/api/admin/remote/vaults/missing", { headers: { authorization: "Bearer admin" } })).status,
		).toBe(404);
		expect(services.operations.list()).toEqual([]);
		expect(services.audit.list()).toEqual([]);
	} finally {
		db.close();
		rmSync(dataDir, { recursive: true, force: true });
	}
});
