/**
 * 契约测试：用录制的真实 provider 响应（tests/fixtures，已脱敏）驱动
 * 「raw ProviderSessionEvent → sanitizeSessionEvent → kit 契约 → core store」整条管道，
 * 并对 MockGateway 跑同一套不变量，防 sdk/mock 两实现漂移。
 * 录制：KIT_LIVE=1 … tsx tests/live/record.ts（只读）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createSessionStore } from "@openagentpack/kit-sdk/chat";
import { artifactOf, bucketOf, isTurnEndEvent, type SessionEvent, threadIdOf } from "@openagentpack/kit-sdk/protocol";
import { toBailianSessionEvent } from "@openagentpack/sdk/session-events";
import { describe, expect, it } from "vitest";
import { createMockGateway } from "../src/gateway/mock.ts";
import { normalizeAgentPage, normalizeAgentResources, toContractEvent } from "../src/gateway/sdk.ts";

const FIXTURES = join(process.cwd(), "tests/fixtures");

function loadFixture(name: string): unknown {
	return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;
}

function fixtureContract(raw: Record<string, unknown>) {
	return toContractEvent(
		toBailianSessionEvent({ ...(raw.raw as Record<string, unknown>), id: raw.id }, { event_format: "snapshot" }),
	);
}

function eventFixtures(): { name: string; events: Record<string, unknown>[] }[] {
	return readdirSync(FIXTURES)
		.filter((f) => f.startsWith("bailian-session-events-") && f.endsWith(".json"))
		.map((f) => ({ name: f, events: (loadFixture(f) as { events: Record<string, unknown>[] }).events }));
}

/**
 * 脱敏回归：fixture 会进仓库，除结构性白名单键外，任何字符串叶子都必须是 `[redacted:N]`。
 * 保护的不变量 = 录制器不把真实对话正文/工具入参/分页游标带进 git（曾经漏掉顶层字符串 `content`）。
 */
const STRUCTURAL_KEYS = new Set(["type", "raw_type", "role", "status", "tool_name", "id"]);
const REDACTED_LEAF = /^\[redacted:\d+\]$/;
// 实时帧保留必要协议枚举；身份与时间仅接受录制 fixture 使用的合成值。
function isSyntheticStreamLeaf(value: string, key?: string): boolean {
	if (key === "object") return value === "message" || value === "content";
	if (key === "session_status") return value === "running" || value === "idle";
	if (key === "created_at") return value === "2026-10-28T12:00:00.000Z";
	return key?.endsWith("_id") === true && /^(?:msg|sevt|thrd|id)_fixture\d+$/.test(value);
}

function collectPlainLeaves(value: unknown, key: string | undefined, out: string[]): void {
	if (typeof value === "string") {
		if (
			value === "" ||
			REDACTED_LEAF.test(value) ||
			(key !== undefined && STRUCTURAL_KEYS.has(key)) ||
			isSyntheticStreamLeaf(value, key)
		)
			return;
		out.push(`${key ?? "<root>"}=${value.slice(0, 32)}`);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectPlainLeaves(item, key, out);
		return;
	}
	if (value && typeof value === "object") {
		for (const [k, item] of Object.entries(value as Record<string, unknown>)) collectPlainLeaves(item, k, out);
	}
}

function assertContract(event: SessionEvent) {
	expect(typeof event.type).toBe("string");
	expect(event.type.length).toBeGreaterThan(0);
	for (const block of event.content ?? []) {
		expect(typeof (block as { type?: unknown }).type).toBe("string");
	}
	if (event.metadata !== undefined) expect(typeof event.metadata).toBe("object");
	// 开放联合：未知类型也必须落到某个展示分桶，不得被丢弃
	expect(["message", "reasoning", "tool", "status", "thread", "artifact", "error", "other"]).toContain(
		bucketOf(event.type),
	);
}

describe("录制 fixture → 契约管道", () => {
	const fixtures = eventFixtures();

	it("fixture 已加载且事件非空（脱敏由下一条叶子级用例保证）", () => {
		expect(fixtures.length).toBeGreaterThan(0);
		for (const fixture of fixtures) expect(fixture.events.length).toBeGreaterThan(0);
	});

	it("fixture 无未脱敏文本叶子（白名单外一律 [redacted:N]）", () => {
		const leaks: string[] = [];
		for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))) {
			collectPlainLeaves(loadFixture(file), undefined, leaks);
		}
		expect(leaks).toEqual([]);
	});

	it("sanitize 后满足 kit 契约（type/content/metadata/分桶）", () => {
		for (const fixture of fixtures) {
			for (const raw of fixture.events) {
				assertContract(fixtureContract(raw));
			}
		}
	});

	it("event_id 透传、thread/artifact 派生读取不抛错", () => {
		for (const fixture of fixtures) {
			for (const raw of fixture.events) {
				const event = fixtureContract(raw);
				if (typeof raw.id === "string") expect(event.event_id).toBe(raw.id);
				expect(() => {
					threadIdOf(event);
					artifactOf(event);
					isTurnEndEvent(event);
				}).not.toThrow();
			}
		}
	});

	it("core store 可归并全部录制事件且去重幂等", () => {
		for (const fixture of fixtures) {
			const store = createSessionStore("fixture-session");
			const sanitized = fixture.events.map((raw) => fixtureContract(raw));
			for (const event of sanitized) expect(store.applyEvent(event)).toBe("applied");
			const messageCount = () =>
				store.getSnapshot().messages.length +
				Object.values(store.getSnapshot().threads).reduce((sum, messages) => sum + messages.length, 0);
			const afterOnce = messageCount();
			expect(afterOnce).toBeGreaterThan(0);
			// 交叉重放：全部重复事件必须被判重
			for (const event of sanitized) expect(store.applyEvent(event)).toBe("duplicate");
			expect(messageCount()).toBe(afterOnce);
			// turn 语义：若录制含 idle 的 session_status，则归并后 turn 收敛
			if (sanitized.some(isTurnEndEvent)) expect(store.getSnapshot().turnRunning).toBe(false);
		}
	});
});

describe("list 路径不再产出空泡（mapper 补齐）", () => {
	it("tool_use/tool_result/message 事件带 tool_name 或文本 content", () => {
		let checked = 0;
		for (const fixture of eventFixtures()) {
			for (const raw of fixture.events) {
				const providerType = raw.type as string;
				if (!["tool_use", "tool_result", "message"].includes(providerType)) continue;
				const event = fixtureContract(raw);
				const meta = (event.metadata ?? {}) as Record<string, unknown>;
				const hasText = (event.content ?? []).some(
					(b) => typeof (b as { text?: string }).text === "string" && (b as { text: string }).text.length > 0,
				);
				expect(hasText || typeof meta.tool_name === "string").toBe(true);
				checked += 1;
			}
		}
		expect(checked).toBeGreaterThan(0);
	});
});

describe("agents 分页归一化（录制形状）", () => {
	it("{data:[{id,name}]} → kit 形状，且与录制长度一致", () => {
		const page = loadFixture("bailian-agents-page.json") as { data: { id: string; name: string }[] };
		const agents = normalizeAgentPage(page);
		expect(agents.length).toBe(page.data.length);
		expect(agents[0]?.agent_id).toBe(page.data[0]?.id);
		for (const agent of agents) {
			expect(agent.agent_id.length).toBeGreaterThan(0);
			expect(agent.name.length).toBeGreaterThan(0);
		}
	});

	it("兼容 items/agents 与 agent_id 旧形状", () => {
		expect(normalizeAgentPage({ items: [{ agent_id: "a1", name: "n1" }] })[0]).toEqual({ agent_id: "a1", name: "n1" });
		expect(normalizeAgentPage({ agents: [{ id: "a2" }] })[0]?.agent_id).toBe("a2");
		expect(normalizeAgentPage(null)).toEqual([]);
	});
});

describe("normalizeAgentResources：unknown 形状投影", () => {
	it("吸收字符串与 {name|id, description?} 条目，丢弃不可解析项", () => {
		expect(
			normalizeAgentResources({
				tools: ["web_search", { name: "code_interpreter", description: "运行代码" }, { unknown: true }, 42],
				skills: [{ id: "research" }, "slide-maker"],
				mcp_servers: [{ name: "github", description: "仓库查询" }],
			}),
		).toEqual({
			tools: [{ name: "web_search" }, { name: "code_interpreter", description: "运行代码" }],
			skills: [{ name: "research" }, { name: "slide-maker" }],
			mcp_servers: [{ name: "github", description: "仓库查询" }],
		});
	});

	it("接受 mcpServers 驼峰键；缺失与非数组字段归空数组", () => {
		expect(normalizeAgentResources({ mcpServers: ["github"] }).mcp_servers).toEqual([{ name: "github" }]);
		expect(normalizeAgentResources({ tools: "not-a-list" })).toEqual({
			tools: [],
			skills: [],
			mcp_servers: [],
		});
		expect(normalizeAgentResources(null)).toEqual({ tools: [], skills: [], mcp_servers: [] });
	});

	// Provider 的 skill 引用键名不定（console 版本详情已兼容 skill_name/skillName/skill_id）；
	// 通用投影只认 name|id，skill 专属键缺失曾把已配置技能整条丢弃、面板分区隐藏。
	it("live skill 引用形状：skill_name/skillName/skill_id/skill_key 键均可补名，无关对象仍丢弃", () => {
		expect(
			normalizeAgentResources({
				skills: [
					{ skill_name: "tang-poetry", version: 3 },
					{ skillName: "WeeklyReport" },
					{ skill_id: "data-clean" },
					{ skill_key: "local-skill" },
					"legacy-string",
					{ unknown: true },
				],
			}).skills,
		).toEqual([
			{ name: "tang-poetry" },
			{ name: "WeeklyReport" },
			{ name: "data-clean" },
			{ name: "local-skill" },
			{ name: "legacy-string" },
		]);
	});

	it("live 工具组形状：builtin_toolkit 展开 configs 并跳过禁用，mcp_toolkit 不重复投影", () => {
		expect(
			normalizeAgentResources({
				tools: [
					{
						type: "builtin_toolkit",
						mcp_server_name: null,
						default_config: { enabled: false, permission_policy: { type: "always_allow" } },
						configs: [
							{ name: "bash", enabled: true, permission_policy: { type: "always_ask" } },
							{ name: "grep", enabled: true, permission_policy: { type: "always_allow" } },
							{ name: "write", enabled: false, permission_policy: { type: "always_ask" } },
							{ name: "web_search", enabled: true, permission_policy: "always_ask" },
							{ name: "read", enabled: true },
							{ enabled: true },
						],
					},
					{
						type: "mcp_toolkit",
						mcp_server_name: "market-cmgjmcp00074997",
						default_config: { enabled: true },
						configs: [],
					},
					{ name: "legacy_tool", description: "旧形状兜底" },
				],
				mcp_servers: [{ type: "official", name: "market-cmgjmcp00074997", url: null }],
				skills: [],
			}),
		).toEqual({
			tools: [
				{ name: "bash", permission: "ask" },
				{ name: "grep", permission: "allow" },
				{ name: "web_search", permission: "ask" },
				{ name: "read", permission: "allow" },
				{ name: "legacy_tool", description: "旧形状兜底" },
			],
			skills: [],
			mcp_servers: [{ name: "market-cmgjmcp00074997" }],
		});
	});
});

describe("MockGateway 与契约同轨", () => {
	it("mock 产出的事件同样满足契约并可被 store 归并", async () => {
		const gateway = createMockGateway();
		const session = await gateway.createSession({ agentId: "agent_mock" });
		await gateway.sendMessage(session.session_id, { text: "契约", clientMessageId: "c1" });
		const store = createSessionStore(session.session_id);
		const abort = new AbortController();
		for await (const event of gateway.streamEvents(session.session_id, { signal: abort.signal })) {
			assertContract(event);

			store.applyEvent(event);
			if (isTurnEndEvent(event)) {
				abort.abort();
				break;
			}
		}
		expect(store.getSnapshot().turnRunning).toBe(false);
		expect(store.getSnapshot().messages.length).toBeGreaterThan(0);
	});
});
