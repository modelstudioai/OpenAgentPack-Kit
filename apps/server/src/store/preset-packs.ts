import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
	KitError,
	PresetPackSummarySchema,
	type PresetPacksPage,
	type PresetPacksQuery,
	type PresetPackView,
	PresetPackViewSchema,
} from "@openagentpack/kit-sdk/protocol";

const searchWhere = `(?='' OR instr(lower(json_extract(config_json, '$.remote_agent_name')),lower(?))>0
  OR instr(lower(json_extract(config_json, '$.remote_agent_id')),lower(?))>0
  OR instr(lower(preset_pack_id),lower(?))>0)`;

export function createPresetPackStore(db: DatabaseSync) {
	return {
		list(query: PresetPacksQuery): PresetPacksPage {
			const search = [query.search, query.search, query.search, query.search];
			const rows = db
				.prepare(`SELECT config_json FROM kit_preset_packs WHERE ${searchWhere}
                ORDER BY created_at DESC, preset_pack_id DESC LIMIT ? OFFSET ?`)
				.all(...search, query.limit, query.offset) as unknown as { config_json: string }[];
			const total = db
				.prepare(`SELECT count(*) AS count FROM kit_preset_packs WHERE ${searchWhere}`)
				.get(...search) as { count: number };
			return {
				data: rows.map((row) => {
					const preset = PresetPackViewSchema.parse(JSON.parse(row.config_json));
					return PresetPackSummarySchema.strip().parse({
						...preset,
						resource_count:
							Number(Boolean(preset.remote_environment_id)) +
							preset.files.length +
							preset.memory_stores.length +
							preset.vault_ids.length,
					});
				}),
				total: total.count,
			};
		},
		create(config: Omit<PresetPackView, "preset_pack_id" | "created_at">): PresetPackView {
			const preset = PresetPackViewSchema.parse({
				...config,
				preset_pack_id: `preset_${randomUUID()}`,
				created_at: new Date().toISOString(),
			});
			db.prepare("INSERT INTO kit_preset_packs (preset_pack_id, config_json, created_at) VALUES (?, ?, ?)").run(
				preset.preset_pack_id,
				JSON.stringify(preset),
				preset.created_at,
			);
			return preset;
		},
		get(id: string): PresetPackView {
			const row = db.prepare("SELECT config_json FROM kit_preset_packs WHERE preset_pack_id=?").get(id) as
				| { config_json: string }
				| undefined;
			if (!row) throw new KitError("not_found", "预设包不存在");
			return PresetPackViewSchema.parse(JSON.parse(row.config_json));
		},
	};
}
export type PresetPackStore = ReturnType<typeof createPresetPackStore>;
