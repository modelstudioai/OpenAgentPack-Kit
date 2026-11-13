import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHostCapabilities } from "./host.ts";

describe("体验页宿主能力", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("没有壳注入时使用完整浏览器降级", () => {
		vi.stubGlobal("window", {});
		const host = resolveHostCapabilities();
		expect(host.pickFiles).toBeTypeOf("function");
		expect(host.saveFile).toBeTypeOf("function");
		expect(host.copyText).toBeTypeOf("function");
		expect(host.preferredColorScheme).toBeTypeOf("function");
	});

	it("壳只覆盖已实现能力，缺失的复制仍走浏览器剪贴板", async () => {
		const saveFile = vi.fn(async () => true);
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal("window", { __OPENAGENTPACK_KIT_BRIDGE__: { saveFile } });
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		const host = resolveHostCapabilities();

		expect(host.saveFile).toBe(saveFile);
		await expect(host.copyText?.("复制正文")).resolves.toBe(true);
		expect(writeText).toHaveBeenCalledWith("复制正文");
	});
});
