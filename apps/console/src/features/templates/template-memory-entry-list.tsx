import type { ReactNode } from "react";
import type { TemplateMemoryEntry } from "./template-memory-draft.ts";
import styles from "./template-resources.module.less";

/** 创建与详情共用条目路径/正文展示，详情不传编辑操作。 */
export function TemplateMemoryEntryList({
	value,
	actions,
}: {
	value: TemplateMemoryEntry[];
	actions?: (entry: TemplateMemoryEntry) => ReactNode;
}) {
	if (!value.length) return <p className={styles.mutedOnly}>暂无记忆条目</p>;
	return (
		<ul aria-label="记忆条目列表" className={styles.entryList}>
			{value.map((entry) => (
				<li key={entry.id} className={styles.entryItem}>
					<div className={styles.entryHead}>
						<span className={styles.entryKey}>{entry.key}</span>
						{actions ? <div className={styles.entryActions}>{actions(entry)}</div> : null}
					</div>
					<pre className={styles.entryBody}>{entry.content || "（空正文）"}</pre>
				</li>
			))}
		</ul>
	);
}
