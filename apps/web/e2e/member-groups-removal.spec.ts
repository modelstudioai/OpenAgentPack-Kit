import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN } from "./helpers.ts";

const api = process.env.KIT_E2E_API_URL ?? "http://localhost:8787";
const origin = process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174";
const headers = { authorization: `Bearer ${ADMIN_TOKEN}` };

// 保护已有分组成员的列表、用量入口和旧链接恢复；真实 Kit API/SQLite 保留关系。
for (const width of [1280, 390]) {
	test(`成员管理：移除用户组界面，旧链接回成员列表且保留数据（${width}px）`, async ({ page, request }, testInfo) => {
		await page.setViewportSize({ width, height: 844 });
		const suffix = `${width}-${Date.now()}`;
		const memberResponse = await request.post(`${api}/api/admin/members`, {
			headers,
			data: {
				username: `kit-e2e-m-${suffix}`,
				display_name: `分组移除验收成员 ${suffix}`,
				auth_type: "local",
				password_mode: "auto",
			},
		});
		expect(memberResponse.status()).toBe(201);
		const member = (await memberResponse.json()).data.member;
		const groupResponse = await request.post(`${api}/api/admin/groups`, {
			headers,
			data: { name: `kit-e2e-groups-${suffix}`, description: "成员管理移除用户组界面回归" },
		});
		expect(groupResponse.status()).toBe(201);
		const group = (await groupResponse.json()).data;
		const linked = await request.patch(`${api}/api/admin/groups/${group.group_id}/members`, {
			headers,
			data: { add_member_ids: [member.member_id] },
		});
		expect(linked.ok()).toBe(true);

		const groupRequests: string[] = [];
		page.on("request", (request) => {
			if (/^\/api\/admin\/(groups|members\/[^/]+\/groups)(\/|$)/.test(new URL(request.url()).pathname)) {
				groupRequests.push(request.url());
			}
		});
		const consoleUrl = (path: string) => {
			const target = new URL(path, origin);
			target.searchParams.set("api", api);
			return target.href;
		};
		await page.goto(consoleUrl("/groups"));
		await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
		await page.getByRole("button", { name: "进入", exact: true }).click();
		for (const path of ["/members", "/groups", `/groups/${group.group_id}`]) {
			await page.goto(consoleUrl(path));
			await expect(page).toHaveURL(consoleUrl("/members"));
			await page.reload();
			await expect(page.getByRole("heading", { name: "成员管理", exact: true })).toBeVisible();
			await page.getByRole("textbox", { name: "用户名或显示名搜索", exact: true }).fill(member.username);
			const listed = page.waitForResponse((response) => {
				const target = new URL(response.url());
				return target.pathname === "/api/admin/members" && target.searchParams.get("search") === member.username;
			});
			await page.getByRole("button", { name: "搜索", exact: true }).click();
			const response = await listed;
			expect(response.ok()).toBe(true);
			expect((await response.json()).data).toEqual([
				expect.objectContaining({
					member_id: member.member_id,
					groups: [{ group_id: group.group_id, name: group.name }],
				}),
			]);
			const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: member.username, exact: true }) });
			await expect(row).toBeVisible();
			await expect(row.getByRole("button", { name: "查看用量", exact: true })).toBeVisible();
			await expect(page.getByRole("button", { name: "创建用户", exact: true })).toBeVisible();
			await expect(page.getByRole("tablist")).toHaveCount(0);
			await expect(page.getByRole("columnheader", { name: "所属用户组", exact: true })).toHaveCount(0);
			await expect(page.getByRole("button", { name: "配置用户组", exact: true })).toHaveCount(0);
			await expect(page.getByText(group.name, { exact: true })).toHaveCount(0);
			await expect(page.getByText("当前分组用于组织配置，尚未限制 Agent 访问。", { exact: true })).toHaveCount(0);
		}
		expect(groupRequests).toEqual([]);
		await page.screenshot({ path: testInfo.outputPath("members-without-groups.png"), fullPage: true });
	});
}
