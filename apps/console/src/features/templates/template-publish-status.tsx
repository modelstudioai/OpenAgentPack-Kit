import { Alert, Button, Modal } from "antd";
import { useEffect, useRef } from "react";
import styles from "./template-pages.module.less";
import { TemplatePublicationReport } from "./template-publication-report.tsx";
import { pendingPublishDescription } from "./template-publish-resources.ts";
import type { TemplatePublish } from "./use-template-publish.ts";

export function TemplatePublishStatus({
	publish,
	onRetry,
	retryDisabled,
}: {
	publish: TemplatePublish;
	onRetry: () => void;
	retryDisabled: boolean;
}) {
	const section = useRef<HTMLElement>(null);
	useEffect(() => {
		if (publish.phase === "loading" || publish.error) section.current?.scrollIntoView({ block: "nearest" });
	}, [publish.phase, publish.error]);
	if (
		!publish.busy &&
		!publish.error &&
		!publish.resumeAvailable &&
		!publish.operation?.publication &&
		!publish.reportError
	)
		return null;
	return (
		<section ref={section} aria-label="预览前发布" className={styles.statusPanel}>
			{publish.resumeAvailable && !publish.busy && !publish.error ? (
				<div className={styles.stack2}>
					<p>有尚未完成的资源发布，可先恢复发布结果或清理，再继续配置。</p>
					<Button size="small" onClick={publish.start}>
						恢复资源发布
					</Button>
				</div>
			) : null}
			{publish.progress ? <p role="status">{publish.progress}</p> : null}
			{publish.operation && publish.busy ? (
				<p className={styles.progressNote}>发布进度：{Math.round(publish.operation.progress * 100)}%</p>
			) : null}
			{publish.warnings.length ? <p className={styles.reviewMessage}>发布提醒：{publish.warnings.join("\n")}</p> : null}
			<PublishFailure publish={publish} onRetry={onRetry} retryDisabled={retryDisabled} />
			{publish.operation?.publication ? <TemplatePublicationReport report={publish.operation.publication} /> : null}
			{publish.observationError ? (
				<div className={styles.stack2}>
					<Alert type="error" showIcon message={`发布进度暂不可用：${publish.observationError}`} />
					<Button size="small" onClick={publish.reconnect}>
						重新连接进度
					</Button>
				</div>
			) : null}
			{publish.review ? (
				<Modal
					open
					centered
					title="确认发布"
					okText="确认发布"
					okButtonProps={{ danger: publish.review.plan.destructive }}
					cancelText="取消"
					onCancel={publish.cancel}
					onOk={publish.confirm}
				>
					<p className={styles.reviewMessage}>
						{`${publish.review.verifyOnly ? "资源已存在，尚未取得本批次的完整发布凭证。确认检查并完成发布后进入预览调试。" : "有未发布的内容需要发布。\n以下是本次新建的资源，确认发布成功后进入预览调试。"}\n\n${pendingPublishDescription(publish.review.plan, publish.review.resourceNames, publish.review.verifyOnly)}${publish.warnings.length ? `\n\n发布提醒：\n${publish.warnings.join("\n")}` : ""}`}
					</p>
				</Modal>
			) : null}
		</section>
	);
}

function PublishFailure({
	publish,
	onRetry,
	retryDisabled,
}: {
	publish: TemplatePublish;
	onRetry: () => void;
	retryDisabled: boolean;
}) {
	return (
		<>
			{publish.reportError ? (
				<Alert type="warning" showIcon message={`资源发布结果明细暂不可用：${publish.reportError}`} />
			) : null}
			{publish.error ? (
				<>
					<Alert type="error" showIcon message={publish.error} />
					{!publish.blocked ? (
						<Button
							size="small"
							disabled={publish.busy || (!publish.resumeAvailable && retryDisabled)}
							onClick={publish.resumeAvailable ? publish.start : onRetry}
						>
							重新准备发布
						</Button>
					) : null}
					{publish.recovery ? (
						<Button size="small" disabled={publish.busy} onClick={publish.retryRecovery}>
							{publish.recovery === "finalize" ? "重试清理" : "重新读取发布结果"}
						</Button>
					) : null}
				</>
			) : null}
		</>
	);
}
