import type { RemoteEnvironmentDetail } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it } from "vitest";
import {
	createEnvironmentDraft,
	environmentCopyIssues,
	environmentDraftFingerprint,
	environmentFormDeclaration,
	environmentFormInput,
} from "./template-environment-form-draft.ts";

const detail: RemoteEnvironmentDetail = {
	environment_id: "env-source",
	name: "分析环境",
	description: "用于分析",
	configuration: { type: "cloud", packages: { pip: ["pandas", "numpy"] } },
	metadata: { owner: "analytics" },
};

describe("环境表单声明与复用边界", () => {
	it("空行和行序不算修改；实际修改后还原可复用原环境", () => {
		const initial = createEnvironmentDraft(detail);
		const draft = createEnvironmentDraft(detail);
		draft.packages.reverse();
		draft.metadata.push({ id: "empty", key: " ", value: "" });
		expect(environmentDraftFingerprint(draft)).toBe(environmentDraftFingerprint(initial));
		draft.description = "新说明";
		expect(environmentDraftFingerprint(draft)).not.toBe(environmentDraftFingerprint(initial));
		draft.description = detail.description!;
		expect(environmentDraftFingerprint(draft)).toBe(environmentDraftFingerprint(initial));
	});
	it("按管理器合并包名，仅输出本地声明输入并拒绝重复元数据", () => {
		const draft = createEnvironmentDraft();
		draft.name = "  新环境  ";
		draft.packages = [
			{ id: "one", manager: "pip", value: "pandas  numpy" },
			{ id: "two", manager: "pip", value: "scipy" },
		];
		draft.metadata = [{ id: "owner", key: "owner", value: " analytics " }];
		expect(environmentFormInput(draft, "revision")).toEqual({
			base_revision: "revision",
			name: "新环境",
			packages: { pip: ["pandas", "numpy", "scipy"] },
			metadata: { owner: "analytics" },
		});
		draft.metadata.push({ id: "duplicate", key: " owner ", value: "other" });
		expect(() => environmentFormInput(draft, "revision")).toThrow("元数据键不可重复");
	});
	it("编辑本地声明保持 ID，删除已清空的描述、包和元数据", () => {
		const input = environmentFormInput({ ...createEnvironmentDraft(), name: "改名环境" }, "revision");
		expect(
			environmentFormDeclaration(input, {
				id: "env-local",
				name: "旧名称",
				description: "旧描述",
				metadata: { owner: "old" },
				config: { type: "cloud", packages: { apt: ["git"] } },
			}),
		).toEqual({ id: "env-local", name: "改名环境", config: { type: "cloud" } });
	});
	it("导入正常网络策略后可编辑，另存及本地更新保留原策略，不提交作用域", () => {
		for (const networking of [
			{ type: "unrestricted" as const },
			{
				type: "limited" as const,
				allow_mcp_servers: false,
				allow_package_managers: true,
				allowed_hosts: ["packages.example.test"],
			},
		]) {
			const source = {
				...detail,
				description: undefined,
				scope: "organization",
				configuration: { ...detail.configuration, networking },
			};
			expect(environmentCopyIssues(source)).toEqual([]);
			const draft = createEnvironmentDraft(source);
			draft.description = "编辑后的描述";
			const input = environmentFormInput(draft, "revision");
			expect(input.networking).toEqual(networking);
			expect(input).not.toHaveProperty("scope");
			expect(environmentFormDeclaration(input, { id: "env-local" })).toMatchObject({
				id: "env-local",
				description: "编辑后的描述",
				config: { networking },
			});
		}
	});
	it("编辑网络开关及多行主机列表进入保存输入，还原后继续复用原环境", () => {
		const source = {
			...detail,
			configuration: { networking: { type: "limited" as const, allowed_hosts: ["a.example.test", "b.example.test"] } },
		};
		const initial = createEnvironmentDraft(source);
		const draft = createEnvironmentDraft(source);
		draft.networking = { ...draft.networking!, allow_mcp_servers: false, allow_package_managers: true };
		draft.networkingHosts = " c.example.test, d.example.test\n\n";
		expect(environmentFormInput(draft, "revision").networking).toEqual({
			type: "limited",
			allow_mcp_servers: false,
			allow_package_managers: true,
			allowed_hosts: ["c.example.test", "d.example.test"],
		});
		expect(environmentDraftFingerprint(draft)).not.toBe(environmentDraftFingerprint(initial));
		delete draft.networking.allow_mcp_servers;
		delete draft.networking.allow_package_managers;
		draft.networkingHosts = " a.example.test\n b.example.test \n";
		expect(environmentDraftFingerprint(draft)).toBe(environmentDraftFingerprint(initial));
		draft.networkingHosts = "";
		expect(environmentFormInput(draft, "revision").networking?.allowed_hosts).toEqual([]);
		draft.networking = undefined;
		draft.networkingHosts = undefined;
		expect(environmentFormInput(draft, "revision")).not.toHaveProperty("networking");
	});
	it("无占位符的有损投影也禁止复制；变量、脚本与脱敏网络/元数据列出字段", () => {
		expect(environmentCopyIssues({ ...detail, copy_restricted_fields: ["description"] })).toEqual(["description"]);
		expect(
			environmentCopyIssues({
				...detail,
				metadata: { token: "[redacted]" },
				configuration: {
					type: "self_hosted",
					networking: { type: "limited", allowed_hosts: ["[redacted]"] },
					environment_variables: { KEY: "[redacted]" },
					setup_script: "[redacted]",
				},
			}),
		).toEqual(
			expect.arrayContaining([
				"configuration.type",
				"configuration.networking",
				"configuration.environment_variables",
				"configuration.setup_script",
				"metadata",
			]),
		);
	});
});
