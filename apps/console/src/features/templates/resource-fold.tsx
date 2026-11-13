import { RightOutlined } from "@ant-design/icons";
import { type ReactNode, useState } from "react";

import styles from "./template-resources.module.less";

/** 折叠只做显隐和高度过渡，内容保持挂载，搜索与草稿状态不丢。 */
export function ResourceFold({
	title,
	status,
	defaultOpen = false,
	children,
}: {
	title: string;
	status?: ReactNode;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<section aria-label={title} className={styles.foldRoot}>
			<h3 className={styles.foldHeading}>
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
					className={styles.foldTrigger}
				>
					<RightOutlined
						aria-hidden="true"
						className={open ? `${styles.foldChevron} ${styles.foldChevronOpen}` : styles.foldChevron}
					/>
					<span className={styles.foldTitle}>{title}</span>
					{status ? <span className={styles.foldStatus}>{status}</span> : null}
				</button>
			</h3>
			<div className={open ? `${styles.foldPanel} ${styles.foldPanelOpen}` : styles.foldPanel}>
				<div className={styles.foldInner} inert={open ? undefined : true}>
					<div className={styles.foldContent}>{children}</div>
				</div>
			</div>
		</section>
	);
}
