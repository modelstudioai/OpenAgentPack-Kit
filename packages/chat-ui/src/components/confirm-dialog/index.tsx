import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useRef, useState } from "react";

/** 破坏性/不可逆操作的确认弹窗（AlertDialog 语义，AGENTS.md UI 规范 3）。 */
export function ConfirmDialog({
	title,
	body,
	confirmLabel = "确认",
	cancelLabel = "取消",
	danger = true,
	busy = false,
	onConfirm,
	onCancel,
}: {
	title: string;
	body: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
	busy?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const opener = useRef<HTMLElement | null>(null);
	return (
		<div ref={setContainer} className="contents">
			<AlertDialog.Root open onOpenChange={(open) => !open && !busy && onCancel()}>
				{/* 保留调用方的主题作用域，也让嵌套确认层属于外层表单弹窗。 */}
				{container ? (
					<AlertDialog.Portal container={container}>
						<AlertDialog.Overlay className="fixed inset-0 z-50 grid place-items-center bg-[var(--kit-overlay)] p-4">
							<AlertDialog.Content
								className="flex max-h-[85vh] w-full max-w-md flex-col rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-5 text-[var(--kit-fg)] shadow-[var(--kit-shadow)]"
								onEscapeKeyDown={(event) => event.preventDefault()}
								onKeyDown={(event) => {
									if (event.key !== "Escape") return;
									// 焦点可能先于 Radix 的 document 监听就绪；同步处理，避免嵌套层漏接 Escape。
									event.preventDefault();
									event.stopPropagation();
									if (!busy) onCancel();
								}}
								onOpenAutoFocus={() => {
									const focused = container.ownerDocument.activeElement;
									opener.current = focused instanceof HTMLElement ? focused : null;
								}}
								onCloseAutoFocus={(event) => {
									// 兼容条件渲染的既有调用方：没有 Radix Trigger，需自行还原焦点。
									event.preventDefault();
									if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
								}}
							>
								<AlertDialog.Title className="shrink-0 text-[length:var(--kit-text-heading)] font-semibold">
									{title}
								</AlertDialog.Title>
								<AlertDialog.Description className="mt-2 min-h-0 overflow-y-auto whitespace-pre-wrap text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)] [overflow-wrap:anywhere]">
									{body}
								</AlertDialog.Description>
								<div className="mt-4 flex shrink-0 justify-end gap-2">
									<AlertDialog.Cancel asChild>
										<button
											type="button"
											disabled={busy}
											className="rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] px-3 py-1.5 text-[length:var(--kit-text-label)]"
										>
											{cancelLabel}
										</button>
									</AlertDialog.Cancel>
									<button
										type="button"
										disabled={busy}
										aria-busy={busy}
										onClick={onConfirm}
										className={`rounded-[var(--kit-radius-sm)] px-3 py-1.5 text-[length:var(--kit-text-label)] font-semibold ${
											danger
												? "bg-[var(--kit-danger)] text-[var(--kit-danger-fg)]"
												: "bg-[var(--kit-accent)] text-[var(--kit-accent-fg)]"
										}`}
									>
										{confirmLabel}
									</button>
								</div>
							</AlertDialog.Content>
						</AlertDialog.Overlay>
					</AlertDialog.Portal>
				) : null}
			</AlertDialog.Root>
		</div>
	);
}
