import { describe, expect, it } from "vitest";
import { DEFAULT_MOUNT_PREFIX, resolveMounts } from "../src/services/attachments.ts";

describe("附件挂载路径解析", () => {
	it("省略 mount_path 时用默认目录 + 安全文件名", () => {
		const resolved = resolveMounts([{ file_id: "f1", filename: "报告 v1.pdf" }]);
		expect(resolved[0]?.mount_path).toBe(`${DEFAULT_MOUNT_PREFIX}/报告_v1.pdf`);
	});

	it("路径穿越被中和（只取 basename），隐藏文件与空名回退 file_N", () => {
		expect(resolveMounts([{ file_id: "f1", filename: "../../etc/passwd" }])[0]?.mount_path).toBe(
			`${DEFAULT_MOUNT_PREFIX}/passwd`,
		);
		// 前导点被剥掉：sandbox 内隐藏文件容易被 agent 漏看
		expect(resolveMounts([{ file_id: "f1", filename: ".env" }])[0]?.mount_path).toBe(`${DEFAULT_MOUNT_PREFIX}/env`);
		expect(resolveMounts([{ file_id: "f1" }])[0]?.mount_path).toBe(`${DEFAULT_MOUNT_PREFIX}/file_1`);
	});

	it("同会话内路径唯一：重名自动加 -2 后缀（保留扩展名）", () => {
		const resolved = resolveMounts([
			{ file_id: "f1", filename: "a.csv" },
			{ file_id: "f2", filename: "a.csv" },
			{ file_id: "f3", filename: "a.csv" },
		]);
		expect(resolved.map((f) => f.mount_path)).toEqual([
			`${DEFAULT_MOUNT_PREFIX}/a.csv`,
			`${DEFAULT_MOUNT_PREFIX}/a-2.csv`,
			`${DEFAULT_MOUNT_PREFIX}/a-3.csv`,
		]);
	});

	it("显式 mount_path 必须是绝对路径，否则回退默认目录", () => {
		expect(resolveMounts([{ file_id: "f1", filename: "a.txt", mount_path: "/mnt/custom/a.txt" }])[0]?.mount_path).toBe(
			"/mnt/custom/a.txt",
		);
		expect(resolveMounts([{ file_id: "f1", filename: "a.txt", mount_path: "relative/a.txt" }])[0]?.mount_path).toBe(
			`${DEFAULT_MOUNT_PREFIX}/a.txt`,
		);
	});

	it("空列表 → 空列表（不产生默认挂载）", () => {
		expect(resolveMounts([])).toEqual([]);
	});

	it("taken 集合参与去重：运行时挂载不覆盖会话已有同路径文件", () => {
		const existing = `${DEFAULT_MOUNT_PREFIX}/a.csv`;
		const resolved = resolveMounts([{ file_id: "f1", filename: "a.csv" }], DEFAULT_MOUNT_PREFIX, [existing]);
		expect(resolved[0]?.mount_path).toBe(`${DEFAULT_MOUNT_PREFIX}/a-2.csv`);
		expect(resolveMounts([{ file_id: "f1", filename: "a.csv" }], DEFAULT_MOUNT_PREFIX, [])).toEqual([
			{ file_id: "f1", filename: "a.csv", mount_path: existing },
		]);
	});
});
