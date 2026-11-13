import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { ghostButtonClass } from "../../lib/styles.ts";
import styles from "./template-resources.module.less";
import { TemplateVersionHistory } from "./template-version-history.tsx";

export function TemplateVersionDrawer({
	templateId,
	selectedVersion,
	disabled = false,
	onSelect,
}: {
	templateId: string;
	selectedVersion?: number;
	disabled?: boolean;
	onSelect: (version: number) => void;
}) {
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const [open, setOpen] = useState(false);
	return (
		<div ref={setContainer} className={styles.contents}>
			<Dialog.Root open={open} onOpenChange={setOpen}>
				<Dialog.Trigger asChild>
					<button type="button" className={ghostButtonClass} disabled={disabled}>
						版本管理
					</button>
				</Dialog.Trigger>
				{container ? (
					<Dialog.Portal container={container}>
						<Dialog.Overlay className={styles.overlay} />
						<Dialog.Content aria-describedby={undefined} className={styles.panel}>
							<header className={styles.panelHeader}>
								<Dialog.Title className={styles.panelTitle}>版本管理</Dialog.Title>
								<Dialog.Close asChild>
									<button type="button" aria-label="关闭版本管理" className={ghostButtonClass}>
										关闭
									</button>
								</Dialog.Close>
							</header>
							<div className={styles.panelBody}>
								{open ? (
									<TemplateVersionHistory
										key={templateId}
										templateId={templateId}
										selectedVersion={selectedVersion}
										onSelect={(version) => {
											onSelect(version);
											setOpen(false);
										}}
									/>
								) : null}
							</div>
						</Dialog.Content>
					</Dialog.Portal>
				) : null}
			</Dialog.Root>
		</div>
	);
}
