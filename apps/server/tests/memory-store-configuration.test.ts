import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createSdkGateway } from "../src/gateway/sdk.ts";
import { createKitServices } from "../src/services/index.ts";
import { openDatabase } from "../src/store/db.ts";

const sdk = () =>
	createSdkGateway({ apiKey: "test-provider-key", baseUrl: "https://provider.example.test/api/v1/agentstudio" });
const info = {
	id: "memory_original",
	name: "原记忆库",
	description: "原描述",
	updated_at: "2026-11-03",
	entry_count: 2,
};
const memory = (id: string, path: string, content: string) => ({
	id,
	type: "memory",
	memory_store_id: info.id,
	path,
	content,
	content_sha256: createHash("sha256").update(content).digest("hex"),
});
afterEach(() => {
	vi.restoreAllMocks();
	setDefaultFetch(fetch);
});

it("返回正文隐藏带引号和转义的凭据，标记不能复制，普通查询与变量引用保持原文", async () => {
	const content = [
		'{"api_key":"fixture-private-key","password":"private value with \\"quotes\\""}',
		"'access_key': 'fixture-private-access'",
		'authorization="fixture-private-auth"',
	].join("\n");
	const safe = `token=\${TOKEN}\n{"api_key":"\${API_KEY}"}\nhttps://docs.example.test/?q=guide&page=2`;
	setDefaultFetch(async (input) =>
		String(input).endsWith(`/memory_stores/${info.id}`)
			? Response.json(info)
			: Response.json({ data: [memory("memory_one", "config.json", content), memory("memory_two", "guide.md", safe)] }),
	);
	const detail = await sdk().getRemoteMemoryStoreConfiguration(info.id);
	expect(JSON.stringify(detail)).not.toMatch(/fixture-private|private value/);
	expect(detail?.entries[0]?.content).toContain('"api_key":"[redacted]"');
	expect(detail?.copy_restricted_fields).toEqual(["条目 1 的正文"]);
	expect(detail?.entries[1]?.content).toBe(safe);
});

it("完整读取分页、子目录和缺少正文的条目，不请求任何写接口或返回原始 metadata", async () => {
	const calls: URL[] = [];
	setDefaultFetch(async (input, init) => {
		const url = new URL(String(input));
		calls.push(url);
		expect(init?.method ?? "GET").toBe("GET");
		if (url.pathname.endsWith(`/memory_stores/${info.id}`)) return Response.json(info);
		if (url.pathname.endsWith("/memories/memory_two"))
			return Response.json(memory("memory_two", "nested/two.md", "第二条"));
		expect(url.searchParams.get("limit")).toBe("20");
		if (url.searchParams.has("path_prefix"))
			return Response.json({
				data: [{ ...memory("memory_two", "nested/two.md", "第二条"), content: undefined }],
				next_page: null,
			});
		if (url.searchParams.has("page")) {
			expect(url.searchParams.get("page")).toBe("opaque+page/=");
			return Response.json({ data: [], prefixes: ["nested/"], next_page: null });
		}
		return Response.json({
			data: [{ ...memory("memory_one", "one.md", "第一条"), metadata: { private: "not-returned" } }],
			next_page: "opaque+page/=",
		});
	});
	expect(await sdk().getRemoteMemoryStoreConfiguration(info.id)).toEqual({
		memory_store_id: info.id,
		name: info.name,
		description: info.description,
		entries: [
			{ key: "one.md", content: "第一条" },
			{ key: "nested/two.md", content: "第二条" },
		],
		copy_restricted_fields: [],
	});
	expect(calls.some((url) => url.pathname.endsWith("/memories/memory_two"))).toBe(true);
});

it.each(["missing-cursor", "repeated-cursor", "missing-content", "changed-digest"])(
	"导入不完整时拒绝返回可复制快照：%s",
	async (failure) => {
		setDefaultFetch(async (input) => {
			const url = new URL(String(input));
			if (url.pathname.endsWith(`/memory_stores/${info.id}`)) return Response.json(info);
			const item = {
				...memory("memory_one", "one.md", "原正文"),
				content: failure === "missing-content" ? null : "已变化正文",
			};
			if (url.pathname.endsWith("/memories/memory_one")) return Response.json(item);
			if (failure === "missing-cursor") return Response.json({ data: [], has_more: true });
			if (failure === "repeated-cursor") return Response.json({ data: [], next_page: "repeat" });
			return Response.json({ data: [item] });
		});
		await expect(sdk().getRemoteMemoryStoreConfiguration(info.id)).rejects.toMatchObject({ code: "provider_error" });
	},
);

it("条目配置只供管理身份读取，缺失404，原记忆库在本地修改前后保持不变", async () => {
	const root = mkdtempSync(join(tmpdir(), "kit-memory-entry-read-"));
	const db = openDatabase(root);
	try {
		const services = createKitServices(
			loadConfig({
				KIT_GATEWAY: "mock",
				KIT_DATA_DIR: root,
				ADMIN_TOKEN: "admin",
				KIT_ADMIN_TOKENS: "auditor:auditor",
			}),
			db,
		);
		const app = createApp(services);
		const path = "/api/admin/remote/memory-stores/memory-guide";
		const writes = vi.spyOn(services.gateway, "resourceDraftDocument");
		const original = await services.gateway.getRemoteMemoryStoreConfiguration("memory-guide");
		expect(original?.entries.length).toBeGreaterThan(0);
		for (const token of ["admin", "auditor"]) {
			const response = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(await response.json()).toEqual({ data: original });
		}
		expect((await app.request(path)).status).toBe(401);
		expect(
			(await app.request("/api/admin/remote/memory-stores/missing", { headers: { authorization: "Bearer admin" } }))
				.status,
		).toBe(404);
		expect(writes).not.toHaveBeenCalled();
		expect(await services.gateway.getRemoteMemoryStoreConfiguration("memory-guide")).toEqual(original);
	} finally {
		db.close();
		rmSync(root, { recursive: true, force: true });
	}
});
