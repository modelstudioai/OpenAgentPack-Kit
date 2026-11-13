import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSdkGateway } from "../src/gateway/sdk.ts";

const gateway = () =>
	createSdkGateway({ apiKey: "sk-unit-test-credential", baseUrl: "https://provider.example.test/api/v1/agentstudio" });
afterEach(() => setDefaultFetch(fetch));

describe("Skill 候选的公开 SDK HTTP 合同", () => {
	it.each(["official", "custom"] as const)(
		"完整聚合 %s 分页、保留名称与明确版本、禁用不可用项并脱敏",
		async (source) => {
			const calls: URL[] = [];
			const rawSource = source === "custom" ? "customer" : "official";
			const skills = Array.from({ length: 101 }, (_, index) => ({
				id: `skill_${index}`,
				name: `Skill ${index}`,
				source: rawSource,
				status: "active",
				latest_version: "2.0",
			}));
			skills[0]!.name = "资料研究 Bearer do-not-expose-name";
			setDefaultFetch(async (input, init) => {
				const url = new URL(String(input));
				calls.push(url);
				expect(init?.method ?? "GET").toBe("GET");
				if (!url.searchParams.has("page"))
					return Response.json({ data: skills.slice(0, 100), has_more: true, next_page: "next+page/=" });
				return Response.json({
					data: [
						...skills.slice(99),
						{ id: "skill_checking", name: "Checking", source: rawSource, status: "checking", latest_version: "1.0" },
						{ id: "skill_unknown", name: "", source: rawSource, status: "future", latest_version: "latest" },
						{
							id: "skill_description",
							name: "Description",
							source: rawSource,
							status: "active",
							latest_version: "1.0",
							description:
								"api_key=do-not-expose-key https://u:do-not-expose-password@docs.example.test/path?q=do-not-expose-query Authorization: Basic Zml4dHVyZTpwYXNzd29yZA==; Authorization: Bearer abc+/token==",
							attributes: { content: "do-not-expose-body" },
						},
					],
					has_more: false,
				});
			});
			const result = await gateway().listRemoteSkills(source);
			expect(result).toHaveLength(104);
			expect(result[100]).toMatchObject({
				skill_id: "skill_100",
				name: "Skill 100",
				source,
				latest_version: "2.0",
				available: true,
			});
			expect(result[0]?.name).toBe("资料研究 [redacted]");
			expect(result.find((skill) => skill.skill_id === "skill_checking")?.available).toBe(false);
			expect(result.find((skill) => skill.skill_id === "skill_unknown")).toEqual({
				skill_id: "skill_unknown",
				name: "skill_unknown",
				source,
				status: "checking",
				available: false,
			});
			expect(result.at(-1)?.description).toBe(
				"api_key=[redacted] https://docs.example.test/path Authorization=[redacted]; Authorization=[redacted]",
			);
			expect(JSON.stringify(result)).not.toMatch(/Zml4dHVyZTpwYXNzd29yZA|abc\+\/token/);
			expect(JSON.stringify(result)).not.toContain("do-not-expose");
			expect(calls.map((url) => url.searchParams.get("page"))).toEqual([null, "next+page/="]);
			for (const url of calls) {
				expect(url.pathname).toBe("/api/v1/agentstudio/skills");
				expect(url.searchParams.get("source")).toBe(rawSource);
				expect(url.searchParams.get("limit")).toBe("100");
			}
		},
	);

	it("缺失或循环游标与错误来源不能产生截断候选", async () => {
		for (const response of [
			{ data: [], has_more: true },
			{ data: [], has_more: true, next_page: "repeat" },
			{
				data: [
					{ id: "skill_bad_source", name: "Wrong source", source: "official", status: "active", latest_version: "1.0" },
				],
			},
		]) {
			setDefaultFetch(async () => Response.json(response));
			await expect(gateway().listRemoteSkills("custom")).rejects.toMatchObject({ code: "provider_error" });
		}
	});

	it("保存固定旧版本只读该版本与元数据，不回退 latest；版本名不会按数字转换", async () => {
		const calls: string[] = [];
		setDefaultFetch(async (input, init) => {
			const path = new URL(String(input)).pathname;
			calls.push(path);
			expect(init?.method ?? "GET").toBe("GET");
			if (path.endsWith("/versions/1.0-beta%2B1"))
				return Response.json({ skill_id: "skill_history", version: "1.0-beta+1", status: "active", name: "历史名称" });
			return Response.json({
				id: "skill_history",
				name: "当前名称",
				source: "customer",
				status: "active",
				latest_version: "2.0",
			});
		});
		expect(await gateway().getRemoteSkillVersion("skill_history", "1.0-beta+1")).toEqual({
			skill_id: "skill_history",
			version: "1.0-beta+1",
			name: "历史名称",
			source: "custom",
			available: true,
		});
		expect(calls.sort()).toEqual([
			"/api/v1/agentstudio/skills/skill_history",
			"/api/v1/agentstudio/skills/skill_history/versions/1.0-beta%2B1",
		]);
	});

	it("非法 ID 或浮动版本在请求前拒绝，版本不存在、未生效和响应错配不会变成可用", async () => {
		const fetcher = vi.fn(async () => Response.json({}));
		setDefaultFetch(fetcher);
		for (const [id, version] of [
			["../outside", "1.0"],
			["skill_one", "latest"],
			["skill_one", "../outside"],
			["skill_one", "1?x=y"],
		])
			await expect(gateway().getRemoteSkillVersion(id!, version!)).rejects.toMatchObject({ code: "invalid_request" });
		expect(fetcher).not.toHaveBeenCalled();
		for (const status of [undefined, "checking", "rejected", "deleted"]) {
			setDefaultFetch(async (input) =>
				new URL(String(input)).pathname.includes("/versions/")
					? Response.json({ skill_id: "skill_one", version: "1.0", status })
					: Response.json({
							id: "skill_one",
							name: "One",
							source: "official",
							status: "active",
							latest_version: "2.0",
						}),
			);
			expect((await gateway().getRemoteSkillVersion("skill_one", "1.0"))?.available).toBe(false);
		}
		setDefaultFetch(async (input) =>
			new URL(String(input)).pathname.includes("/versions/")
				? Response.json({ error: { message: "do-not-expose" } }, { status: 404 })
				: Response.json({ id: "skill_one", name: "One", source: "official", status: "active" }),
		);
		expect(await gateway().getRemoteSkillVersion("skill_one", "1.0")).toBeNull();
		setDefaultFetch(async (input) =>
			new URL(String(input)).pathname.includes("/versions/")
				? Response.json({ skill_id: "other", version: "2.0", status: "active" })
				: Response.json({ id: "skill_one", name: "One", source: "official", status: "active" }),
		);
		await expect(gateway().getRemoteSkillVersion("skill_one", "1.0")).rejects.toMatchObject({ code: "provider_error" });
	});

	it("Provider 错误仅返回固定安全提示", async () => {
		setDefaultFetch(async () =>
			Response.json({ error: { message: "Bearer do-not-expose-provider-error" } }, { status: 403 }),
		);
		await expect(gateway().listRemoteSkills("official")).rejects.toMatchObject({
			code: "provider_error",
			message: "Skill 列表查询失败，请稍后重试",
		});
		await expect(gateway().getRemoteSkillVersion("skill_one", "1.0")).rejects.toMatchObject({
			code: "provider_error",
			message: "Skill 版本查询失败，请稍后重试",
		});
	});
});
