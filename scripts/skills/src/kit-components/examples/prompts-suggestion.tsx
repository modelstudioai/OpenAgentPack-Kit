import {
	Prompts,
	Sender,
	type SenderRef,
	type SenderSelection,
	SkillGlyph,
	Suggestion,
} from "@openagentpack/kit-chat-ui";
import { useRef, useState } from "react";

const promptText: Record<string, string> = {
	summary: "Summarize the current report.",
	compare: "Compare these two alternatives.",
};

export function PromptComposer({ onSend, canSend }: { onSend: (text: string) => Promise<void>; canSend: boolean }) {
	const [draft, setDraft] = useState("");
	const [selection, setSelection] = useState<SenderSelection>({ start: 0, end: 0 });
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const sender = useRef<SenderRef>(null);
	const sending = useRef(false);

	const send = async (text: string) => {
		if (!canSend || sending.current || !text.trim()) return;
		sending.current = true;
		setSubmitting(true);
		setError(null);
		try {
			await onSend(text);
			setDraft((current) => (current === text ? "" : current));
		} catch {
			setError("Send failed. Your draft is preserved.");
		} finally {
			sending.current = false;
			setSubmitting(false);
		}
	};

	return (
		<div className="flex flex-col gap-3" data-kit-appearance="workspace">
			<Prompts
				title="Try a question"
				wrap
				items={[
					{ key: "summary", label: "Summarize", description: "Extract the main points." },
					{ key: "compare", label: "Compare", description: "Review two alternatives." },
				]}
				onItemClick={({ data }) => {
					setDraft(promptText[data.key] ?? "");
					sender.current?.focus();
				}}
			/>
			<Suggestion
				block
				items={[
					{ value: "summary", label: "Summarize the report", icon: <SkillGlyph className="size-4" /> },
					{ value: "compare", label: "Compare alternatives", icon: <SkillGlyph className="size-4" /> },
				]}
				value={draft}
				caret={selection.end}
				trigger="/"
				onSelect={(_, item, context) => {
					if (!context) return;
					sender.current?.replaceRange(context.start, context.end, promptText[item.value] ?? "");
					sender.current?.focus();
				}}
			>
				{({ onKeyDown, inputProps }) => (
					<Sender
						variant="workspace"
						ref={sender}
						value={draft}
						placeholder="Type / to choose a command"
						onChange={setDraft}
						onSelectionChange={setSelection}
						onKeyDown={onKeyDown}
						inputProps={inputProps}
						submitDisabled={!canSend || submitting}
						onSubmit={(text) => void send(text)}
						suffix={(_origin, { components }) => <components.SendButton>Send</components.SendButton>}
					/>
				)}
			</Suggestion>
			{error ? <p role="alert">{error}</p> : null}
		</div>
	);
}
