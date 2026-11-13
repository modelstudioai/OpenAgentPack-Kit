import { ErrorState } from "@openagentpack/kit-chat-ui";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { bootstrapClient } from "./lib/kit.ts";
import "./styles.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
try {
	const { controller } = await bootstrapClient();
	root.render(<App controller={controller} />);
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
