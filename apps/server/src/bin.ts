import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createKitServices } from "./services/index.ts";

const config = loadConfig();
const services = createKitServices(config);
const app = createApp(services);

serve({ fetch: app.fetch, port: config.port }, (info) => {
	console.warn(`[kit-server] http://localhost:${info.port} gateway=${config.resolvedGateway} data=${config.dataDir}`);
});
