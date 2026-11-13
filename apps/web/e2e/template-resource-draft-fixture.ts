import type { ResourceDraftView } from "@openagentpack/kit-sdk/protocol";
import type { Page, Route } from "@playwright/test";
import { expect } from "./fixtures.ts";
import { ADMIN_TOKEN } from "./helpers.ts";

export const draftId = "resource-draft-1";
export const draftProjectPath = `/api/admin/resource-drafts/${draftId}/resources`;
const draftsPath = "/api/admin/resource-drafts";
const timestamp = "2026-11-02T12:00:00.000Z";

export type DraftReceipt = ResourceDraftView;

export function draftReceipt(index = 1): DraftReceipt {
	return {
		draft_id: `resource-draft-${index}`,
		project_name: `resource-draft-${index}`,
		status: "draft",
		resources: [],
		cleanup_pending: false,
		created_at: timestamp,
		updated_at: timestamp,
	};
}

/** 统一模拟管理员隔离草稿生命周期；资源表单继续各自断言项目 API，避免复制整个服务端。 */
export function resourceDraftFixture(initial: DraftReceipt | null = null) {
	const receipts = new Map<string, DraftReceipt>(initial ? [[initial.draft_id, initial]] : []);
	const state = {
		active: initial,
		receipts,
		requests: [] as string[],
		created: initial ? 1 : 0,
		discarded: [] as string[],
		discardableFailures: new Set<string>(),
		beforeRead: undefined as ((view: DraftReceipt) => Promise<void>) | undefined,
		beforeFinalize: undefined as ((view: DraftReceipt) => Promise<void>) | undefined,
		readError: "",
		finalizeError: "",
		finalizeErrorStatus: 503,
	};
	function ensure() {
		if (!state.active || state.active.status === "published") {
			state.created += 1;
			state.active = draftReceipt(state.created);
			receipts.set(state.active.draft_id, state.active);
		}
		return state.active;
	}
	function complete(view: DraftReceipt) {
		view.cleanup_pending = false;
		if (state.active?.draft_id === view.draft_id) state.active = null;
	}
	async function discard(route: Route, path: string) {
		const id = path.slice(draftsPath.length + 1).split("/")[0] ?? "";
		const view = receipts.get(id);
		if (!view || view.status === "published") return route.fulfill({ json: { data: { discarded: false } } });
		if (view.status !== "draft" && !state.discardableFailures.has(id))
			return route.fulfill({
				status: 409,
				json: {
					error: {
						code: "conflict",
						message: "发布结果尚未确认，保留草稿",
						details: { reason: "publication_unresolved" },
					},
				},
			});
		receipts.delete(id);
		if (state.active?.draft_id === id) state.active = null;
		state.discarded.push(id);
		return route.fulfill({ json: { data: { discarded: true } } });
	}
	function respondError(route: Route, status: number, message: string) {
		return route.fulfill({
			status,
			json: { error: { code: status === 409 ? "conflict" : "provider_error", message } },
		});
	}
	async function finalizeView(route: Route, view: DraftReceipt) {
		await state.beforeFinalize?.(view);
		if (state.finalizeError) return respondError(route, state.finalizeErrorStatus, state.finalizeError);
		if (view.status !== "published")
			return route.fulfill({ status: 409, json: { error: { code: "conflict", message: "尚未取得发布成功凭证" } } });
		complete(view);
		return route.fulfill({ json: { data: view } });
	}
	async function readView(route: Route, path: string) {
		const id = path.slice(draftsPath.length + 1).split("/")[0] ?? "";
		const view = receipts.get(id);
		if (!view) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "草稿不存在" } } });
		await state.beforeRead?.(view);
		if (route.request().method() === "POST" && path.endsWith("/finalize")) return finalizeView(route, view);
		if (state.readError) return respondError(route, 503, state.readError);
		return route.fulfill({ json: { data: view } });
	}
	async function handle(route: Route, path: string): Promise<boolean> {
		if (!path.startsWith(draftsPath)) return false;
		if (/\/resources(?:\/|$)/.test(path)) return false;
		const method = route.request().method();
		state.requests.push(`${method} ${path}`);
		if (method === "GET" && path === `${draftsPath}/active`) await route.fulfill({ json: { data: state.active } });
		else if (method === "POST" && path === draftsPath) await route.fulfill({ status: 201, json: { data: ensure() } });
		else if (method === "POST" && path.endsWith("/discard")) await discard(route, path);
		else await readView(route, path);
		return true;
	}
	return Object.assign(state, { handle });
}

export async function installResourceDraftFixture(
	page: Page,
	apiBase: string,
	drafts: ReturnType<typeof resourceDraftFixture>,
) {
	await page.route(`${apiBase}/api/admin/resource-drafts**`, async (route) => {
		expect(route.request().headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
		const path = new URL(route.request().url()).pathname.slice(new URL(apiBase).pathname.length);
		if (!(await drafts.handle(route, path))) await route.fallback();
	});
}
