import { describe, expect, it } from "vitest";
import { createConfirmationSigner } from "./confirm-token.ts";

const expected = { planId: "plan_1", action: "apply", subject: "sub_1" };

describe("确认令牌", () => {
	it("签发后可校验", async () => {
		const signer = createConfirmationSigner("secret");
		const { token } = await signer.sign(expected);
		expect((await signer.verify(token, expected)).ok).toBe(true);
	});

	it("换 secret / 换 action / 换 subject 都失败", async () => {
		const signer = createConfirmationSigner("secret");
		const { token } = await signer.sign(expected);
		expect((await createConfirmationSigner("other").verify(token, expected)).reason).toBe("bad_signature");
		expect((await signer.verify(token, { ...expected, action: "destroy" })).reason).toBe("mismatch");
		expect((await signer.verify(token, { ...expected, subject: "sub_2" })).reason).toBe("mismatch");
	});

	it("过期失败", async () => {
		const signer = createConfirmationSigner("secret");
		const { token } = await signer.sign(expected, -1);
		expect((await signer.verify(token, expected)).reason).toBe("expired");
	});

	it("畸形令牌失败", async () => {
		const signer = createConfirmationSigner("secret");
		expect((await signer.verify("no-dot-here", expected)).reason).toBe("malformed");
		expect((await signer.verify("a.!!!", expected)).reason).toBe("malformed");
	});
});
