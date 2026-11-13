import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KitError } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { createConfirmGate } from "../src/services/confirm-gate.ts";

function gate() {
	const config = loadConfig({
		KIT_GATEWAY: "mock",
		KIT_DATA_DIR: mkdtempSync(join(tmpdir(), "kit-gate-")),
		ADMIN_TOKEN: "x",
	});
	return createConfirmGate(config);
}

describe("确认令牌闸门", () => {
	it("签发 → 消费成功；重复消费被拒", async () => {
		const g = gate();
		const { confirmToken } = await g.issue({ planId: "p1", action: "project.apply", subject: "admin" });
		await g.consume({ planId: "p1", action: "project.apply", subject: "admin", token: confirmToken });
		await expect(
			g.consume({ planId: "p1", action: "project.apply", subject: "admin", token: confirmToken }),
		).rejects.toMatchObject({
			code: "confirmation_required",
		});
	});

	it("缺令牌 / 错 action 均 confirmation_required", async () => {
		const g = gate();
		const { confirmToken } = await g.issue({ planId: "p1", action: "project.apply", subject: "admin" });
		await expect(
			g.consume({ planId: "p1", action: "project.apply", subject: "admin", token: "" }),
		).rejects.toBeInstanceOf(KitError);
		await expect(
			g.consume({ planId: "p1", action: "project.destroy", subject: "admin", token: confirmToken }),
		).rejects.toMatchObject({
			code: "confirmation_required",
		});
	});
});
