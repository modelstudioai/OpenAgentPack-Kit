import { setDefaultFetch } from "@openagentpack/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { createSdkGateway } from "../src/gateway/sdk.ts";

const gateway = () =>
	createSdkGateway({ apiKey: "sk-unit-test-credential", baseUrl: "https://provider.example.test/api/v1/agentstudio" });
afterEach(() => setDefaultFetch(fetch));

describe("上架已上传文件的 SDK HTTP 合同", () => {
	it("逐页读取完整列表，区分普通上传、内部副本与输出，保留扫描状态而不泄露原始字段", async () => {
		const uploads = Array.from({ length: 101 }, (_, index) => ({
			id: `file-${index}`,
			filename: `${index}.txt`,
			size_bytes: 8,
			downloadable: false,
			status: "available",
		}));
		const calls: URL[] = [];
		setDefaultFetch(async (input) => {
			const url = new URL(String(input));
			calls.push(url);
			return Response.json(
				url.searchParams.has("page")
					? {
							data: [
								...uploads.slice(99),
								{ id: "file-checking", filename: "checking.txt", downloadable: false, status: "checking" },
								{ id: "file-rejected", filename: "rejected.txt", downloadable: false, status: "rejected" },
								{ id: "file-unknown-status", filename: "unknown.txt", downloadable: false },
								{ id: "file-explicit-upload", filename: "upload.txt", origin: "user_upload", status: "available" },
								{
									id: "file-session-copy",
									filename: "copy.txt",
									scope: { type: "session", id: "session-other" },
									downloadable: false,
									status: "available",
								},
								{ id: "file-output", filename: "output.txt", downloadable: true, status: "available" },
								{ id: "file-explicit-output", origin: "session_output", downloadable: false, status: "available" },
								{ id: "file-unknown-origin", origin: "unknown", downloadable: false, status: "available" },
								{ id: "file-unknown", filename: "unknown-origin.txt", status: "available" },
							],
							has_more: false,
						}
					: { data: uploads.slice(0, 100), has_more: true, next_page: "opaque+files/page=" },
			);
		});
		const files = await gateway().listRemoteFiles();
		expect(files).toHaveLength(105);
		expect(files[100]).toEqual({
			file_id: "file-100",
			filename: "100.txt",
			size: 8,
			status: "available",
			available: true,
		});
		expect(files.slice(101)).toEqual([
			{ file_id: "file-checking", filename: "checking.txt", status: "checking", available: false },
			{ file_id: "file-rejected", filename: "rejected.txt", status: "rejected", available: false },
			{ file_id: "file-unknown-status", filename: "unknown.txt", available: false },
			{ file_id: "file-explicit-upload", filename: "upload.txt", status: "available", available: true },
		]);
		expect(calls.map((url) => url.searchParams.get("page"))).toEqual([null, "opaque+files/page="]);
		expect(
			calls.every((url) => url.pathname === "/api/v1/agentstudio/files" && url.searchParams.get("limit") === "100"),
		).toBe(true);
	});

	it.each([undefined, "repeated-cursor"])("异常文件分页拒绝静默截断：%s", async (next_page) => {
		setDefaultFetch(async () => Response.json({ data: [], has_more: true, next_page }));
		await expect(gateway().listRemoteFiles()).rejects.toMatchObject({ code: "provider_error" });
	});

	it("详情重新校验来源与扫描状态；不存在返回null，查询失败不放行", async () => {
		setDefaultFetch(async (input) => {
			const id = new URL(String(input)).pathname.split("/").pop();
			if (id === "missing") return Response.json({ code: "NotFound", message: "not found" }, { status: 404 });
			if (id === "failed") return Response.json({ message: "sk-unit-test-credential" }, { status: 500 });
			return Response.json({
				id,
				filename: "safe.txt",
				downloadable: id === "output",
				status: id === "pending" ? "checking" : "available",
			});
		});
		const sdk = gateway();
		expect(await sdk.getRemoteFile("uploaded")).toMatchObject({ file_id: "uploaded", available: true });
		expect(await sdk.getRemoteFile("pending")).toMatchObject({ available: false, status: "checking" });
		expect(await sdk.getRemoteFile("output")).toBeNull();
		expect(await sdk.getRemoteFile("missing")).toBeNull();
		await expect(sdk.getRemoteFile("failed")).rejects.toMatchObject({
			code: "provider_error",
			message: "文件信息查询失败，请稍后重试",
		});
	});

	it("上传被 Provider 拒绝时映射协议错误：415 带原因归 invalid_request，5xx 可重试", async () => {
		setDefaultFetch(async () =>
			Response.json(
				{ error: { code: "11900014", message: "文件类型不被允许" }, request_id: "req-415", type: "error" },
				{ status: 415 },
			),
		);
		await expect(
			gateway().uploadFile({ filename: "stylelint.config.mjs", bytes: new Uint8Array([1]) }),
		).rejects.toMatchObject({
			code: "invalid_request",
			message: "文件不被接受：文件类型不被允许",
			status: 400,
			retryable: false,
		});
		setDefaultFetch(async () => Response.json({ error: { message: "upstream boom" } }, { status: 502 }));
		await expect(gateway().uploadFile({ filename: "a.txt", bytes: new Uint8Array([1]) })).rejects.toMatchObject({
			code: "provider_error",
			retryable: true,
		});
	});
});
