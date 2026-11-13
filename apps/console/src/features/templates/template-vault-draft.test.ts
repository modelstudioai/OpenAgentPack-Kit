import { describe, expect, it, vi } from "vitest";
import {
	emptyTemplateVault,
	hasPendingVaults,
	importedTemplateVault,
	mergeImportedVaults,
	prepareTemplateVaults,
	type TemplateVaultDraft,
	validateTemplateVaults,
	vaultCreateInput,
} from "./template-vault-draft.ts";

const cloud: TemplateVaultDraft = { vault_id: "vault-cloud", name: "已有密钥库" };
const newVault = (name: string): TemplateVaultDraft => ({ ...emptyTemplateVault(), name });

describe("密钥库默认表单与导入", () => {
	it("导入和还原原配置都复用原库，修改后完整填写密钥才创建副本", async () => {
		const imported = importedTemplateVault(cloud, {
			...cloud,
			credentials: [
				{
					credential_id: "credential-one",
					name: "第一个密钥",
					secret_name: "FIRST_VALUE",
					allowed_hosts: ["example.com"],
				},
				{
					credential_id: "credential-two",
					name: "第二个密钥",
					secret_name: "SECOND_VALUE",
					allowed_hosts: ["api.example.com"],
				},
			],
		});
		const create = vi.fn(async () => ({ vault_id: "vault-copy", name: "修改后的名称" }));
		const existing = [imported];
		expect(hasPendingVaults(existing)).toBe(false);
		expect(validateTemplateVaults(existing)).toBeNull();
		expect(await prepareTemplateVaults(existing, create, vi.fn())).toBe(existing);
		expect(create).not.toHaveBeenCalled();
		const renamed = { ...imported, name: "修改后的名称" };
		expect(hasPendingVaults([renamed])).toBe(true);
		expect(validateTemplateVaults([renamed])).toBe("修改密钥库后，请重新填写保留密钥的变量值。");
		await expect(prepareTemplateVaults([renamed], create, vi.fn())).rejects.toThrow("重新填写");
		expect(create).not.toHaveBeenCalled();
		expect(hasPendingVaults([{ ...renamed, name: `  ${cloud.name}  ` }])).toBe(false);
		const ready = {
			...renamed,
			configuration: {
				...renamed.configuration!,
				credentials: renamed.configuration!.credentials.map((item) => ({
					...item,
					input: { ...item.input, secret_value: "synthetic-value", acknowledged: true },
				})),
			},
		};
		expect(validateTemplateVaults([ready])).toBeNull();
		expect(vaultCreateInput(ready, "revision").credentials).toHaveLength(2);
		const saved = await prepareTemplateVaults([ready], create, vi.fn());
		expect(create).toHaveBeenCalledTimes(1);
		expect(saved).toEqual([{ vault_id: "vault-copy", name: "修改后的名称" }]);
		expect(imported.vault_id).toBe(cloud.vault_id);
		expect(imported.configuration!.credentials.every((item) => !item.input.secret_value)).toBe(true);
	});
	it("导入保留已修改配置，删除全部密钥可明确创建空副本", () => {
		const imported = importedTemplateVault(cloud, {
			...cloud,
			credentials: [
				{ credential_id: "credential", name: "密钥", secret_name: "MY_VALUE", allowed_hosts: ["example.com"] },
			],
		});
		const removed = { ...imported, configuration: { ...imported.configuration!, credentials: [] } };
		expect(mergeImportedVaults([removed], [cloud])).toEqual([removed]);
		expect(hasPendingVaults([removed])).toBe(true);
		expect(vaultCreateInput(removed, "revision")).toEqual({ base_revision: "revision", display_name: cloud.name });
	});
	it("空配置可跳过，填写后校验名称和密钥，导入保留未保存草稿", () => {
		expect(validateTemplateVaults([])).toBeNull();
		expect(validateTemplateVaults([emptyTemplateVault()])).toBe("请输入密钥库名称");
		const pending = newVault("  待创建  ");
		expect(vaultCreateInput(pending, "revision")).toEqual({ base_revision: "revision", display_name: "待创建" });
		expect(mergeImportedVaults([cloud, pending], [cloud, cloud])).toEqual([cloud, pending]);
		expect(mergeImportedVaults([cloud, pending], [])).toEqual([pending]);
		expect(validateTemplateVaults(Array.from({ length: 11 }, () => newVault("新库")))).toBe("最多选择 10 个密钥库");
	});
	it("纯已有引用不创建资源，部分成功后重试只处理剩余新库，引用不含密钥输入", async () => {
		const create = vi.fn(async (row: TemplateVaultDraft) => ({ vault_id: `saved-${row.name}`, name: row.name }));
		const existing = [cloud];
		expect(await prepareTemplateVaults(existing, create, vi.fn())).toBe(existing);
		expect(create).not.toHaveBeenCalled();
		const first = newVault("第一个");
		first.creation!.credentials = [
			{
				id: "synthetic-credential",
				input: {
					name: "测试密钥",
					secret_name: "TEST_VALUE",
					secret_value: "synthetic-value",
					allowed_hosts: ["example.com"],
					acknowledged: true,
				},
			},
		];
		const second = newVault("第二个");
		let current = [cloud, first, second];
		create
			.mockResolvedValueOnce({ vault_id: "vault-first", name: "第一个" })
			.mockRejectedValueOnce(new Error("创建失败"));
		await expect(
			prepareTemplateVaults(current, create, (rows) => {
				current = rows;
			}),
		).rejects.toThrow("创建失败");
		expect(current[1]).toEqual({ vault_id: "vault-first", name: "第一个" });
		expect(hasPendingVaults(current)).toBe(true);
		const result = await prepareTemplateVaults(current, create, (rows) => {
			current = rows;
		});
		expect(create.mock.calls.map(([row]) => row.name)).toEqual(["第一个", "第二个", "第二个"]);
		expect(hasPendingVaults(result)).toBe(false);
		expect(JSON.stringify(result)).not.toContain("synthetic-value");
		expect(result[0]).toBe(cloud);
	});
});
