import type { Page } from "@playwright/test";
import { expect } from "./fixtures.ts";
import { inlineApi } from "./template-inline-helpers.ts";

type Kind = "environments" | "files" | "memory-stores" | "vaults";
function detailConfiguration(kind: Kind, id: string) {
	switch (kind) {
		case "environments":
			return {
				description: `环境 ${id}`,
				configuration: { type: "cloud", networking: { type: "limited", allowed_hosts: ["example.test"] } },
			};
		case "memory-stores":
			return { description: `记忆 ${id}`, entries: [{ key: "guide.md", content: `正文 ${id}` }] };
		case "vaults":
			return {
				credentials: [
					{
						credential_id: "credential_fixture",
						name: "项目服务",
						secret_name: "PROJECT_KEY",
						allowed_hosts: ["api.example.test"],
					},
				],
			};
		default:
			return {};
	}
}
/** 仅替换资源目录边界；分页与 Provider 投影由 gateway 合同保护。 */
export async function installInlineSelectionFixture(page: Page, kind: Kind, count = 23) {
	const label = { environments: "环境", files: "文件", "memory-stores": "记忆库", vaults: "密钥库" }[kind];
	const ids = {
		environments: "environment_id",
		files: "file_id",
		"memory-stores": "memory_store_id",
		vaults: "vault_id",
	};
	const rows = Array.from({ length: count }, (_, index) => ({
		[ids[kind]]: `resource_${index + 1}`,
		...(kind === "files"
			? { filename: `资料 ${index + 1}.txt`, size: 12, available: true }
			: { name: `资源 ${index + 1}` }),
	}));
	const state = {
		rows,
		listError: false,
		detailError: false,
		requests: [] as string[],
		detailGate: undefined as Promise<void> | undefined,
	};
	await page.route(`${inlineApi}/api/admin/remote/${kind}**`, async (route) => {
		expect(route.request().method()).toBe("GET");
		const id = new URL(route.request().url()).pathname.split(`/remote/${kind}`)[1]?.slice(1);
		state.requests.push(id || "list");
		if (id) await state.detailGate;
		if (id ? state.detailError : state.listError)
			return route.fulfill({
				status: 503,
				json: { error: { code: "provider_error", message: `${label}${id ? "详情" : "列表"}暂不可用` } },
			});
		if (!id) return route.fulfill({ json: { data: rows } });
		const row = rows.find((item) => item[ids[kind]] === id);
		if (!row) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "资源不存在" } } });
		return route.fulfill({
			json: {
				data: {
					...row,
					...detailConfiguration(kind, id),
				},
			},
		});
	});
	return state;
}
