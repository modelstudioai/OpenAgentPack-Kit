import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createKitServices } from "./services/index.ts";

const config = loadConfig({ ...process.env, KIT_GATEWAY: "mock", KIT_DATA_DIR: join(process.cwd(), ".data-openapi") });
const app = createApp(createKitServices(config));
const response = await app.request("/openapi.json");
const document = await response.json();
writeFileSync(join(process.cwd(), "openapi.json"), `${JSON.stringify(document, null, 2)}\n`);
console.warn(
	`openapi.json written (${Object.keys((document as { paths: Record<string, unknown> }).paths ?? {}).length} paths)`,
);
