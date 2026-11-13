import { describe, expect, it } from "vitest";
import { brandingFromConfig } from "./branding.ts";

describe("brandingFromConfig", () => {
	it("uses the default product name when the server has no branding", () => {
		expect(brandingFromConfig()).toEqual({ productName: "OpenAgentPack Kit" });
	});

	it("reads a local logo path and an online logo URL", () => {
		expect(
			brandingFromConfig({ productName: "  Acme Assistant  ", logoUrl: "/brand/logo.svg" }, "https://api.example.test"),
		).toEqual({
			productName: "Acme Assistant",
			logoUrl: "/brand/logo.svg",
		});
		expect(brandingFromConfig({ logoUrl: "/api/branding/logo?v=abc" }, "https://api.example.test")).toEqual({
			productName: "OpenAgentPack Kit",
			logoUrl: "https://api.example.test/api/branding/logo?v=abc",
		});
		expect(brandingFromConfig({ logoUrl: "https://cdn.example.com/logo.svg" })).toEqual({
			productName: "OpenAgentPack Kit",
			logoUrl: "https://cdn.example.com/logo.svg",
		});
	});

	it.each(["https://api.example.test/prefix", "https://api.example.test/prefix/"])(
		"preserves the API path prefix for an uploaded logo: %s",
		(baseUrl) => {
			expect(brandingFromConfig({ logoUrl: "/api/branding/logo?v=abc" }, baseUrl).logoUrl).toBe(
				"https://api.example.test/prefix/api/branding/logo?v=abc",
			);
		},
	);

	it("trims empty values", () => {
		expect(brandingFromConfig({ productName: "   ", logoUrl: "   " })).toEqual({
			productName: "OpenAgentPack Kit",
		});
	});
});
