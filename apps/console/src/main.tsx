import { ErrorState } from "@openagentpack/kit-chat-ui";
import { createRoot } from "react-dom/client";
import styles from "./app.module.less";
import { App } from "./app.tsx";
import { bootstrapAdmin } from "./lib/kit.ts";
import "./styles.css";
// 加载顺序约定（console AGENTS.md「UI 组件栈」）：Tailwind preflight 在前，antd 在后；
// antd 的 reset.css 不引入，全局重置统一归 Tailwind preflight。
import "antd/dist/antd.css";

const root = createRoot(document.getElementById("root") as HTMLElement);
try {
	await bootstrapAdmin();
	root.render(<App />);
} catch (error) {
	root.render(
		<main className={styles.bootstrapMain}>
			<ErrorState
				message={error instanceof Error ? error.message : "无法读取服务配置"}
				onRetry={() => window.location.reload()}
			/>
		</main>,
	);
}
