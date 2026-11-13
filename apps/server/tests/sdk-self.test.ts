import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createProjectRuntime,
	executePlannedProject,
	planProjectContext,
	resolveProjectConfigFromObject,
	StateManager,
	setDefaultFetch,
	validateProjectConfig,
} from "@openagentpack/sdk";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => {
	setDefaultFetch(fetch);
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const configuration = (agents: unknown[], provider = "bailian") => ({
	version: "1",
	project: "sdk-self-contract",
	providers: {
		[provider]: { api_key: "unit-provider-key", base_url: "https://provider.example.test/api/v1/agentstudio" },
	},
	agents: {
		coordinator: { name: "协调者", model: "auto", instructions: "", multiagent: { type: "coordinator", agents } },
	},
});
const resolve = (agents: unknown[], provider = "bailian") =>
	resolveProjectConfigFromObject(configuration(agents, provider), {
		projectName: "sdk-self-contract",
		resolveEnv: false,
	});

describe("锁定 SDK 的公开 Self 合同", () => {
	it("Self 单独使用可校验，不是普通 Agent 的自引用或额外资源", async () => {
		const loaded = await resolve([{ type: "self" }]);
		expect(validateProjectConfig(loaded.config).filter((item) => item.severity === "error")).toEqual([]);
		expect(loaded.config.agents?.coordinator?.multiagent?.agents).toEqual([{ type: "self" }]);
		const ordinarySelfReference = await resolve(["coordinator"]);
		expect(validateProjectConfig(ordinarySelfReference.config).map((item) => item.code)).toContain(
			"config.agent.multiagent.self",
		);
	});
	it.each(
		[
			[{ type: "self" }, { type: "self" }],
			[{ type: "self", id: "agent_other" }],
			[{ type: "self", agent_id: "agent_other" }],
			[{ type: "self", version: 2 }],
		].map((agents) => ({ agents })),
	)("拒绝重复或携带其他身份/版本的 Self：%j", async ({ agents }) => {
		await expect(resolve(agents)).rejects.toThrow();
	});
	it.each(["qoder", "claude", "ark"])("%s 不开放百炼专属 Self 能力", async (provider) => {
		const loaded = await resolve([{ type: "self" }], provider);
		expect(validateProjectConfig(loaded.config).map((item) => item.code)).toContain(
			`${provider}.agent.multiagent.self.unsupported`,
		);
	});
	it.each([false, true])("发布发送原生 Self；回读/导出兼容空占位=%s，移除 Self 可更新", async (nullPlaceholders) => {
		const root = await mkdtemp(join(tmpdir(), "kit-sdk-self-"));
		roots.push(root);
		const loaded = await resolve([{ type: "self" }, { agent_id: "agent_existing" }]);
		const state = StateManager.initialize(join(root, "state.json"));
		const context = createProjectRuntime({ projectName: loaded.projectName, config: loaded.config, state });
		let remote: Record<string, unknown> | undefined;
		const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
		setDefaultFetch(async (input, init) => {
			const url = new URL(String(input));
			const method = init?.method ?? "GET";
			if (method !== "GET") {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				writes.push({ method, path: url.pathname, body });
				const roster = body.multiagent as { type: string; agents: { type: string }[] };
				remote = {
					...body,
					id: "agent_root",
					version: writes.length,
					multiagent: {
						...roster,
						agents: roster.agents.map((member) =>
							nullPlaceholders && member.type === "self" ? { ...member, id: null, version: null } : member,
						),
					},
				};
				return Response.json(remote);
			}
			if (url.pathname.endsWith("/agents"))
				return Response.json({
					data: [remote, { id: "agent_existing", name: "外部成员", model: { id: "auto" }, system: "" }].filter(Boolean),
				});
			if (url.pathname.endsWith("/agents/agent_root")) return Response.json(remote);
			throw new Error(`Unexpected SDK request: ${method} ${url.pathname}`);
		});

		const planned = await planProjectContext(context, { refresh: false });
		expect(planned.plan.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
		expect(planned.plan.actions.map((action) => ({ action: action.action, name: action.address.name }))).toEqual([
			{ action: "create", name: "coordinator" },
		]);
		expect(writes).toHaveLength(0);
		await executePlannedProject(planned);
		expect(writes).toHaveLength(1);
		expect(writes[0]?.body.multiagent).toEqual({
			type: "coordinator",
			agents: [{ type: "self" }, { type: "agent", id: "agent_existing" }],
		});
		expect(state.listResources().map((resource) => resource.address.name)).toEqual(["coordinator"]);

		const unchanged = await planProjectContext(context, { refresh: true });
		expect(unchanged.plan.actions.map((action) => action.action)).toEqual(["no-op"]);
		const comparable = await context.providers.get("bailian")!.readComparableResource!(
			"agent",
			"agent_root",
			"coordinator",
			loaded.config.agents!.coordinator!,
		);
		expect(comparable?.comparable).toMatchObject({ multiagent: { type: "coordinator", self: true } });
		const exported = await context.providers.get("bailian")!.exportResources!("agent");
		expect(exported.map((entry) => entry.decl.multiagent)).toContainEqual(
			loaded.config.agents?.coordinator?.multiagent,
		);

		context.config.agents!.coordinator!.multiagent!.agents = [{ agent_id: "agent_existing" }];
		const removal = await planProjectContext(context, { refresh: true });
		expect(removal.plan.actions.map((action) => action.action)).toEqual(["update"]);
		await executePlannedProject(removal);
		expect(writes).toHaveLength(2);
		expect(writes[1]?.body.multiagent).toEqual({
			type: "coordinator",
			agents: [{ type: "agent", id: "agent_existing" }],
		});
	});
});
