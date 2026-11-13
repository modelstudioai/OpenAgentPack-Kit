import { defineConfig } from "tsup";

export default defineConfig({
	entry: { app: "src/app.ts", bin: "src/bin.ts" },
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	target: "node24",
	external: [/^node:/],
	esbuildOptions: (options) => {
		options.packages = "external";
	},
});
