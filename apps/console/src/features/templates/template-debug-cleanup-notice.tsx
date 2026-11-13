import { ErrorState } from "@openagentpack/kit-chat-ui";
import { Button } from "antd";
import { useSyncExternalStore } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { templateDebugCleanupQueue } from "./template-debug-cleanup.ts";
import styles from "./template-pages.module.less";

/** 挂在 App 中，离开预览或详情后仍能看到未完成的调试会话清理并手动重试。 */
export function TemplateDebugCleanupNotice() {
	const tasks = useSyncExternalStore(
		templateDebugCleanupQueue.subscribe,
		templateDebugCleanupQueue.getSnapshot,
		templateDebugCleanupQueue.getSnapshot,
	);
	const retry = useAdminMutation(() => templateDebugCleanupQueue.retryFailed());
	const failures = tasks.filter((task) => task.error !== null);
	const pending = retry.pending || tasks.some((task) => task.pending);
	const retryPending = retry.pending || failures.some((task) => task.pending);
	if (!tasks.length) return null;
	return (
		<section aria-label="调试会话清理" className={styles.noticeRoot}>
			{failures.length ? (
				<>
					<ErrorState
						message={`调试会话清理失败\n${failures.map((task) => `${task.sessionId}：${task.error}`).join("\n")}`}
					/>
					<Button disabled={retryPending} onClick={() => void retry.run().catch(() => {})}>
						重试清理
					</Button>
				</>
			) : null}
			{pending ? (
				<p role="status" className={styles.cleaningText}>
					正在清理调试会话…
				</p>
			) : null}
		</section>
	);
}
