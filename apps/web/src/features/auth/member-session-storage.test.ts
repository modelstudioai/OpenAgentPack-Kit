import { describe, expect, it } from "vitest";
import { createMemberSessionStorage, normalizeMemberApiBaseUrl } from "./member-session-storage.ts";

function browserStorage() {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
	};
}

describe("成员登录状态的浏览器存储边界", () => {
	// 保护跨服务接入：同域不同路径前缀也不能拿到另一个服务的成员凭据。
	it("规范化完整服务地址，保留路径前缀，并只保存恢复登录所需字段", () => {
		const storage = browserStorage();
		const first = createMemberSessionStorage("https://KIT.example.test:443/team-a///", () => storage);
		const same = createMemberSessionStorage("https://kit.example.test/team-a", () => storage);
		const other = createMemberSessionStorage("https://kit.example.test/team-b", () => storage);
		const input = {
			access_token: "kit_member_test",
			expires_at: "2030-01-01T00:00:00.000Z",
			password: "must-not-persist",
		};
		first.save(input);
		expect(same.load()).toEqual({ access_token: input.access_token, expires_at: input.expires_at });
		expect(other.load()).toBeNull();
		expect([...storage.values.values()].join()).not.toContain(input.password);
		other.save({ access_token: "kit_member_other", expires_at: input.expires_at });
		first.save(null);
		expect(same.load()).toBeNull();
		expect(other.load()?.access_token).toBe("kit_member_other");
		expect(normalizeMemberApiBaseUrl("/team-a/", "https://kit.example.test")).toBe("https://kit.example.test/team-a");
	});

	it.each(["{bad-json", '{"access_token":"test"}', '{"access_token":"test","expires_at":"not-a-date"}'])(
		"损坏的登录记录会清除并要求重新登录：%s",
		(raw) => {
			const storage = browserStorage();
			storage.values.set("kit_member_session:https://kit.example.test", raw);
			expect(createMemberSessionStorage("https://kit.example.test", () => storage).load()).toBeNull();
			expect(storage.values.size).toBe(0);
		},
	);

	it("存储故障只返回固定提示，不暴露底层异常内容", () => {
		const session = createMemberSessionStorage("https://kit.example.test", () => {
			throw new Error("private-token-content");
		});
		expect(() => session.load()).toThrow("无法读取登录状态");
		expect(() => session.save(null)).toThrow("无法保存登录状态");
	});

	it.each([
		"javascript:alert(1)",
		"https://user:password@kit.example.test",
		"https://kit.example.test?token=secret",
		"https://kit.example.test#secret",
	])("拒绝会混淆凭据归属的服务地址：%s", (baseUrl) => {
		expect(() => normalizeMemberApiBaseUrl(baseUrl, "https://kit.example.test")).toThrow("服务地址须为");
	});
});
