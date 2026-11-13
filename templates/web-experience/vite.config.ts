import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * kit 包未发布期间：别名直连 kit 仓库的 dist 产物（kit.repo.json 由 pnpm kit:create 写入；
 * 使用前需在 kit 仓库跑 `pnpm build`）。开源发包后改为 npm 依赖并删除本段别名。
 */
function resolveKitRepo(): string | null {
	// 1) 生成的独立项目：cmdCreate 写入的 kit.repo.json
	try {
		const { path: kitRepo } = JSON.parse(readFileSync(resolve(here, "kit.repo.json"), "utf8")) as { path: string };
		if (kitRepo) return kitRepo;
	} catch {
		/* 不在生成项目里 */
	}
	// 2) 模板还在 kit monorepo 内（本仓 CI / `pnpm build`）：回落到上两级的仓库根
	const monorepoRoot = resolve(here, "../..");
	return existsSync(join(monorepoRoot, "packages", "chat-ui", "package.json")) ? monorepoRoot : null;
}

function kitAliases(): Record<string, string> {
	const kitRepo = resolveKitRepo();
	if (!kitRepo) return {};
	const sdkDir = join(kitRepo, "packages", "sdk");
	const sdk = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")) as {
		exports: Record<string, { import: string }>;
	};
	const aliases: Record<string, string> = {
		...Object.fromEntries(
			Object.entries(sdk.exports)
				.sort(([a], [b]) => b.length - a.length)
				.map(([entry, output]) => [`@openagentpack/kit-sdk/${entry.slice(2)}`, join(sdkDir, output.import)]),
		),
		"@openagentpack/kit-chat-ui/theme.css": join(kitRepo, "packages", "chat-ui", "src", "theme.css"),
		"@openagentpack/kit-chat-ui": join(kitRepo, "packages", "chat-ui", "dist"),
	};
	return aliases;
}

export default defineConfig({
	plugins: [react(), tailwindcss()],
	// Kit dist 位于仓库外时仍使用生成项目的同一份 React，避免登录 Hook 读到另一份 dispatcher。
	resolve: { alias: kitAliases(), dedupe: ["react", "react-dom"] },
	server: { port: 5199, proxy: { "/api": process.env.KIT_API_BASE ?? "http://localhost:8787" } },
});
