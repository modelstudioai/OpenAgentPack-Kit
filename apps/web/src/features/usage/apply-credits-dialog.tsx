import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";

export interface ApplyCreditsValues {
	requestedCredits: number;
	reason: string;
}

/**
 * 提额申请弹窗（非破坏性动作，复用已有 Radix Dialog 管理焦点与关闭交互）。
 *
 * `onSubmit` 返回 `string | null`（null=成功），错误文案原样显示在弹窗内——
 * 服务端对「已有 pending 申请」返回 409 `request_pending`，那句话必须给用户看到，不能被 toast 吞掉。
 */
export function ApplyCreditsDialog({
	onClose,
	onSubmit,
}: {
	onClose: () => void;
	onSubmit: (values: ApplyCreditsValues) => Promise<string | null>;
}) {
	const [credits, setCredits] = useState("");
	const [reason, setReason] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const returnFocus = useRef<HTMLElement | null>(null);
	const completed = useRef(false);

	const requested = Number.parseInt(credits, 10);
	// 服务端 schema：requested_credits 为 ≥1 的整数（上限 100 万）
	const valid = Number.isInteger(requested) && requested >= 1;

	const submit = async () => {
		if (!valid || submitting) return;
		setSubmitting(true);
		setFormError(null);
		const failure = await onSubmit({ requestedCredits: requested, reason: reason.trim() });
		setSubmitting(false);
		if (failure) {
			setFormError(failure);
			return;
		}
		completed.current = true;
		onClose();
	};

	return (
		<Dialog.Root open onOpenChange={(open) => !open && !submitting && onClose()}>
			<div ref={setContainer} />
			{container ? (
				<Dialog.Portal container={container}>
					<Dialog.Overlay className="fixed inset-x-0 top-0 z-50 grid h-[var(--kit-viewport-height,100dvh)] place-items-center bg-[var(--kit-overlay)] p-4">
						<Dialog.Content
							asChild
							onEscapeKeyDown={(event) => submitting && event.preventDefault()}
							onInteractOutside={(event) => submitting && event.preventDefault()}
							onOpenAutoFocus={() => {
								returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
							}}
							onCloseAutoFocus={(event) => {
								event.preventDefault();
								const opener = returnFocus.current;
								// 申请成功后入口会禁用，焦点回到同一额度卡；取消则回到申请按钮。
								const target =
									completed.current || opener?.matches(":disabled")
										? opener?.closest<HTMLElement>('[tabindex="-1"]')
										: opener;
								target?.focus();
							}}
						>
							<form
								data-testid="usage-apply-dialog"
								onSubmit={(e) => {
									e.preventDefault();
									void submit();
								}}
								className="relative max-h-[calc(var(--kit-viewport-height,100dvh)-var(--kit-space-4)*2)] w-full min-w-0 max-w-md overflow-y-auto overscroll-contain rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-5 shadow-[var(--kit-shadow)] [overflow-wrap:anywhere] md:p-6"
							>
								<div className="flex items-center justify-between gap-3">
									<Dialog.Title className="text-[length:var(--kit-text-heading)] font-semibold">
										申请 Credits
									</Dialog.Title>
									<Dialog.Close asChild>
										<button
											type="button"
											aria-label="关闭申请弹窗"
											disabled={submitting}
											className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--kit-radius-sm)] text-[var(--kit-fg-muted)] transition-colors hover:bg-[var(--kit-bg-subtle)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed disabled:opacity-50"
										>
											<svg
												aria-hidden="true"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="1.5"
												className="h-4 w-4"
											>
												<path strokeLinecap="round" d="m6 6 12 12M6 18 18 6" />
											</svg>
										</button>
									</Dialog.Close>
								</div>
								<Dialog.Description className="mt-2 text-[length:var(--kit-text-caption)] leading-relaxed text-[var(--kit-fg-muted)]">
									提交后由管理员审批：通过后会提高长期月度上限，或发放当月加油包（月底失效）。
								</Dialog.Description>
								<label className="mt-4 block">
									<span className="mb-1 block text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
										期望额度（Credits）
									</span>
									<input
										type="number"
										min={1}
										step={1}
										value={credits}
										onChange={(e) => setCredits(e.target.value)}
										placeholder="例如 200"
										aria-label="期望额度"
										data-testid="usage-apply-credits"
										className="min-h-11 w-full min-w-0 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] px-3 py-2 text-[length:var(--kit-text-heading)] placeholder:text-[var(--kit-fg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] md:text-[length:var(--kit-text-label)]"
									/>
								</label>
								<label className="mt-3 block">
									<span className="mb-1 block text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
										理由（可选，最多 400 字）
									</span>
									<textarea
										rows={3}
										maxLength={400}
										value={reason}
										onChange={(e) => setReason(e.target.value)}
										placeholder="说明用途，便于审批"
										aria-label="申请理由"
										data-testid="usage-apply-reason"
										className="w-full min-w-0 resize-none rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] px-3 py-2 text-[length:var(--kit-text-heading)] placeholder:text-[var(--kit-fg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] md:text-[length:var(--kit-text-label)]"
									/>
								</label>
								{formError ? (
									<p
										role="alert"
										data-testid="usage-apply-error"
										className="mt-3 text-[length:var(--kit-text-caption)] text-[var(--kit-danger)]"
									>
										{formError}
									</p>
								) : null}
								<div className="mt-5 flex flex-wrap justify-end gap-2">
									<Dialog.Close asChild>
										<button
											type="button"
											disabled={submitting}
											className="min-h-10 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] px-4 py-2 text-[length:var(--kit-text-label)] font-medium transition-colors hover:bg-[var(--kit-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed disabled:opacity-50"
										>
											取消
										</button>
									</Dialog.Close>
									<button
										type="submit"
										data-testid="usage-apply-submit"
										disabled={!valid || submitting}
										className="min-h-10 rounded-[var(--kit-radius-sm)] bg-[var(--kit-accent)] px-4 py-2 text-[length:var(--kit-text-label)] font-medium text-[var(--kit-accent-fg)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed disabled:opacity-50"
									>
										{submitting ? "提交中…" : "提交申请"}
									</button>
								</div>
							</form>
						</Dialog.Content>
					</Dialog.Overlay>
				</Dialog.Portal>
			) : null}
		</Dialog.Root>
	);
}
