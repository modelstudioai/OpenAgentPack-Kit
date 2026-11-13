import { ErrorState } from "@openagentpack/kit-chat-ui";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { brandingFromConfig } from "./lib/branding.ts";
import { bootstrapClient } from "./lib/kit.ts";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
try {
	const { controller, config, baseUrl } = await bootstrapClient();
	root.render(<App controller={controller} branding={brandingFromConfig(config.branding, baseUrl)} />);
} catch (error) {
	root.render(
		<main className="p-6">
			<ErrorState
				message={error instanceof Error ? error.message : "无法读取服务配置"}
				onRetry={() => window.location.reload()}
			/>
		</main>,
	);
}
