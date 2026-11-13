import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { KitError } from "@openagentpack/kit-sdk/protocol";
import { type ResourceDraftProof, ResourceDraftProofSchema } from "./resource-draft-proof.ts";
import { initialDraftYaml } from "./yaml-draft-document.ts";

/** 声明与成功证明只存在数据库中；此适配仅清理本批受控上传暂存。 */
export function createResourceDraftYamlFiles(
	dataDir: string,
	storage: {
		read(id: string): { proof_json: string | null } | undefined;
		initialize(id: string, yaml: string): void;
		proof(id: string, proof: string): void;
		clear(id: string): void;
		release(id: string): void;
	},
) {
	function assets(id: string) {
		if (!/^draft_[a-f0-9]{32}$/.test(id)) throw new KitError("not_found", "资源发布批次不存在");
		return join(dataDir, "resource-draft-uploads", id);
	}
	async function assertSafe(id: string) {
		for (const path of [join(dataDir, "resource-draft-uploads"), assets(id)]) {
			const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return undefined;
				throw error;
			});
			if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new KitError("conflict", "上传暂存目录不安全");
		}
	}
	return {
		exists: async (id: string) => Boolean(storage.read(id)),
		assertSafe,
		async initialize(id: string) {
			await assertSafe(id);
			storage.initialize(id, initialDraftYaml);
		},
		async writeProof(proof: ResourceDraftProof) {
			storage.proof(proof.draft_id, JSON.stringify(ResourceDraftProofSchema.parse(proof)));
		},
		async readProof(id: string, owner: string): Promise<ResourceDraftProof | null> {
			const text = storage.read(id)?.proof_json;
			if (!text) return null;
			const result = ResourceDraftProofSchema.safeParse(JSON.parse(text));
			if (!result.success || result.data.draft_id !== id || result.data.owner !== owner)
				throw new KitError("conflict", "发布成功证明无效");
			return result.data;
		},
		async cleanup(id: string, beforeRemove?: () => Promise<void>) {
			await assertSafe(id);
			await beforeRemove?.();
			await rm(assets(id), { recursive: true, force: true });
			storage.clear(id);
			storage.release(id);
		},
	};
}
