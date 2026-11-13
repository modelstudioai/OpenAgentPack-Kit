import { LeftOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

import styles from "./inner-layout.module.less";

/**
 * 内容区页头布局，迁移自 bailian-web packages/bfal-components 的 InnerLayout 标题区：
 * 返回箭头 + 大标题 + 右侧操作区，桌面 64px header / 28px 标题，移动端降级 44px / 16px。
 * 仅迁移本仓库用到的子集（title/onBack/right），tabs、banner、sticky 筛选、滚动阴影未迁移；
 * 返回语义由调用方注入，组件不依赖路由与 i18n。
 */
export function InnerLayout({
	title,
	titleId,
	description,
	onBack,
	backLabel = "返回",
	right,
	children,
}: {
	title: ReactNode;
	/** 透传给标题 h1，供页面 section 的 aria-labelledby 引用 */
	titleId?: string;
	/** 标题下方的描述行（上游 InnerLayout 同名能力，随宿主布局提供间距，自身不加 margin） */
	description?: ReactNode;
	onBack?: () => void;
	/** 返回箭头的无障碍名，随返回去向变化（如「返回用量列表」） */
	backLabel?: string;
	right?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className={styles.layout}>
			<header className={styles.header}>
				<div className={styles.left}>
					<div className={styles.titleHeader}>
						<div className={styles.titleRow}>
							{onBack ? (
								<button type="button" aria-label={backLabel} className={styles.backIcon} onClick={onBack}>
									<LeftOutlined />
								</button>
							) : null}
							<h1 id={titleId} className={styles.title}>
								{title}
							</h1>
						</div>
						{description ? <div className={styles.description}>{description}</div> : null}
					</div>
				</div>
				{right ? <div className={styles.right}>{right}</div> : null}
			</header>
			{children ? <div className={styles.content}>{children}</div> : null}
		</div>
	);
}
