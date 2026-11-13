import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN } from "./helpers.ts";

const api = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const origin = process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174";
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };

async function openLogs(page: Page, token = ADMIN_TOKEN) {
	const url = new URL("/operations", origin);
	url.searchParams.set("api", api);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(token);
	await page.getByRole("button", { name: /^进\s*入$/ }).click();
	return page.getByRole("region", { name: "操作日志", exact: true });
}

async function seedOperations(request: APIRequestContext, name: string) {
	const input = { name, category: "general", remote_agent_id: "agent_mock_assistant" };
	const created = await request.post(`${api}/api/admin/templates`, { headers, data: input });
	expect(created.status()).toBe(201);
	const { data: template } = await created.json();
	const target = `${api}/api/admin/templates/${template.template_id}`;
	const updated = await request.put(target, { headers, data: { ...input, base_version: template.version } });
	expect(updated.status()).toBe(200);
	const display = { display_name: name };
	const plan = await request.post(`${target}/listing/plan`, { headers, data: display });
	const { data: listing } = await plan.json();
	const listed = await request.post(`${target}/listing`, {
		headers,
		data: { ...display, plan_id: listing.plan_id, confirm_token: listing.confirm_token },
	});
	expect(listed.status()).toBe(200);
	const { data: entry } = await listed.json();
	const catalogPath = `${api}/api/admin/agents/${entry.slug}`;
	const unlistPlan = await request.post(`${catalogPath}/plan`, {
		headers,
		data: { action: "listing", status: "unlisted" },
	});
	const { data: unlist } = await unlistPlan.json();
	expect(
		(
			await request.patch(catalogPath, {
				headers,
				data: { status: "unlisted", plan_id: unlist.plan_id, confirm_token: unlist.confirm_token },
			})
		).status(),
	).toBe(200);
	const deletePlan = await request.post(`${target}/delete/plan`, { headers });
	const { data: deletion } = await deletePlan.json();
	expect(
		(
			await request.delete(target, {
				headers,
				data: { plan_id: deletion.plan_id, confirm_token: deletion.confirm_token },
			})
		).status(),
	).toBe(200);
}

// 真实管理操作写入后只展示本人记录，不显示操作人；删除不丢对象名称。
test("日志只展示当前管理员的智能体操作，隐藏操作人和刷新按钮", async ({ page, request, browser }) => {
	const name = `kit-e2e-log-${Date.now()}`;
	await seedOperations(request, name);
	const debug = await request.post(`${api}/api/admin/debug/sessions`, {
		headers,
		data: { remote_agent_id: "agent_mock_assistant", title: `调试-${name}` },
	});
	expect(debug.status()).toBe(201);
	const { data: session } = await debug.json();
	const debugTarget = `${api}/api/admin/debug/sessions/${session.session_id}`;
	const prepared = await request.post(`${debugTarget}/plan`, { headers, data: { action: "delete" } });
	const { data: deletion } = await prepared.json();
	expect(
		(
			await request.delete(debugTarget, {
				headers,
				data: { plan_id: deletion.plan_id, confirm_token: deletion.confirm_token },
			})
		).status(),
	).toBe(200);
	const memberResponse = await request.post(`${api}/api/admin/members`, {
		headers,
		data: { username: `log-${Date.now()}`, display_name: `${name}-成员`, auth_type: "local", password_mode: "auto" },
	});
	expect(memberResponse.status()).toBe(201);
	const { data: memberResult } = await memberResponse.json();
	const logs = await openLogs(page);
	for (const action of ["新建智能体", "编辑智能体", "上架智能体", "下架智能体", "删除智能体"]) {
		const row = logs.getByRole("row").filter({ hasText: name }).filter({ hasText: action });
		await expect(row).toHaveCount(1);
	}
	await expect(logs.getByRole("columnheader", { name: /操作人|操作者/ })).toHaveCount(0);
	await expect(logs.getByRole("button", { name: "刷新", exact: true })).toHaveCount(0);
	await expect(logs).not.toContainText(/admin:admin:[0-9a-f]{8}/);
	await expect(logs.getByRole("row").filter({ hasText: session.session_id })).toHaveCount(0);
	await expect(logs.getByRole("row").filter({ hasText: memberResult.member.member_id })).toHaveCount(0);
	const auditor = await browser.newContext();
	try {
		const auditPage = await auditor.newPage();
		const auditLogs = await openLogs(auditPage, "e2e-auditor");
		await expect(auditLogs.getByText("暂无操作记录", { exact: true })).toBeVisible();
		await expect(auditLogs.getByRole("row").filter({ hasText: name })).toHaveCount(0);
	} finally {
		await auditor.close();
	}
});

// 请求失败要与空日志区分；旧格式日志和无名称快照仍能展示，翻页经服务端查询。
test("日志加载失败可重试，兼容旧记录并支持分页和窄屏", async ({ page }) => {
	let calls = 0;
	await page.route("**/api/admin/audit?*", async (route) => {
		calls++;
		if (calls === 1)
			return route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "暂时不可用" } } });
		const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
		await route.fulfill({
			json: {
				total: 21,
				data: Array.from({ length: offset === 0 ? 20 : 1 }, (_, index) => ({
					id: 21 - offset - index,
					at: "2026-11-04T01:00:00.000Z",
					subject: "admin:admin:1234abcd",
					action: "templates.update",
					target: `旧智能体-${21 - offset - index}`,
					detail: index % 2 ? null : '["display_name"]',
				})),
			},
		});
	});
	const logs = await openLogs(page);
	await expect(logs.getByText("操作日志加载失败", { exact: true })).toBeVisible();
	await logs.getByRole("button", { name: "重试", exact: true }).click();
	await expect(logs.getByRole("row")).toHaveCount(21);
	await page.setViewportSize({ width: 390, height: 844 });
	await logs.getByTitle("下一页", { exact: true }).click();
	await expect(logs.getByRole("row")).toHaveCount(2);
	await expect(logs.getByText("旧智能体-1", { exact: true })).toBeVisible();
});
