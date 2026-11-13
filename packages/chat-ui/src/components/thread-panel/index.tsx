import type { ChatMessage } from "@openagentpack/kit-sdk/messages";
import { Message } from "../message/index.tsx";

export function ThreadPanel({
	threads,
	onArtifactDownload,
	onCopy,
}: {
	threads: Record<string, ChatMessage[]>;
	onArtifactDownload?: (fileId: string) => void;
	onCopy?: (text: string) => void | Promise<void>;
}) {
	const ids = Object.keys(threads);
	if (ids.length === 0) return null;
	return (
		<div className="rounded-[var(--kit-radius)] border border-[var(--kit-border)] bg-[var(--kit-bg-subtle)] p-3">
			<strong className="text-[length:var(--kit-text-label)]">子线程（{ids.length}）</strong>
			{ids.map((id) => (
				<details key={id} className="mt-1.5 text-[length:var(--kit-text-label)] text-[var(--kit-fg-muted)]">
					<summary className="cursor-pointer">{id}</summary>
					<div className="pt-1.5">
						{(threads[id] ?? []).map((message) => (
							<Message key={message.id} message={message} onArtifactDownload={onArtifactDownload} onCopy={onCopy} />
						))}
					</div>
				</details>
			))}
		</div>
	);
}
