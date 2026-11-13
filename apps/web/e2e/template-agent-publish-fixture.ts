import type { Page } from "@playwright/test";
import { expect } from "./fixtures.ts";
import { ADMIN_TOKEN } from "./helpers.ts";

/** 表单用例停在发布复核；完整发布及原远端版本不变由 Mock 集成保护。 */
export async function installAgentPublishReviewFixture(
	page: Page,
	apiBase: string,
	projectPath: string,
	revision: () => string,
) {
	const steps: string[] = [];
	const urls = new Set(["validate", "build", "plan"].map((action) => `${apiBase}${projectPath}/${action}`));
	await page.route(
		(url) => urls.has(url.href),
		async (route) => {
			expect(route.request().method()).toBe("POST");
			expect(route.request().headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
			const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
			steps.push(action);
			if (action === "plan")
				return route.fulfill({
					json: {
						data: {
							plan_id: "agent-plan",
							confirm_token: "agent-confirm",
							project_revision: revision(),
							expires_at: Date.now() + 60_000,
							destructive: false,
							diff: [{ resource: "agent:new", action: "create", destructive: false, summary: "创建智能体副本" }],
						},
					},
				});
			return route.fulfill({
				json: { data: { project_revision: revision(), diagnostics: [], warnings: [], agents: [] } },
			});
		},
	);
	return steps;
}
