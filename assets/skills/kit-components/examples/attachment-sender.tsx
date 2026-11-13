import {
	type AttachmentItem,
	Attachments,
	type AttachmentsRef,
	Sender,
	type SenderRef,
	type SenderSelection,
	type SenderSkill,
	SkillGlyph,
	Suggestion,
} from "@openagentpack/kit-chat-ui";
import { skillInputTokens } from "@openagentpack/kit-sdk/protocol";
import { useEffect, useRef, useState } from "react";

interface UploadedAttachment extends AttachmentItem {
	fileId?: string;
}

export interface AttachmentSenderProps {
	uploadFile: (file: File) => Promise<{ file_id: string }>;
	// Application callback: upload does not itself mount files into a session.
	onSubmit: (text: string, fileIds: string[], skills?: string[]) => Promise<void>;
	skills?: SenderSkill[];
	onStop: () => void;
	canSend: boolean;
	turnRunning: boolean;
}

const maxCount = 8;

export function AttachmentSender({
	uploadFile,
	onSubmit,
	onStop,
	canSend,
	turnRunning,
	skills,
}: AttachmentSenderProps) {
	const [draft, setDraft] = useState("");
	const [selection, setSelection] = useState<SenderSelection>({ start: 0, end: 0 });
	const sender = useRef<SenderRef>(null);
	const [files, setFiles] = useState<UploadedAttachment[]>([]);
	const [open, setOpen] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const attachments = useRef<AttachmentsRef>(null);
	const currentFiles = useRef(files);
	const mounted = useRef(false);
	const sending = useRef(false);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const updateFiles = (update: (previous: UploadedAttachment[]) => UploadedAttachment[]) => {
		if (!mounted.current) return;
		currentFiles.current = update(currentFiles.current);
		setFiles(currentFiles.current);
	};

	const selectFiles = (selected: File[]) => {
		if (turnRunning || sending.current) return;
		const accepted = selected.slice(0, Math.max(0, maxCount - currentFiles.current.length));
		const uploads = accepted.map((file) => ({
			file,
			item: {
				uid: crypto.randomUUID(),
				name: file.name,
				size: file.size,
				type: file.type,
				status: "uploading" as const,
			},
		}));
		updateFiles((previous) => [...previous, ...uploads.map(({ item }) => item)]);
		setOpen(true);
		setError(null);
		for (const { file, item } of uploads) {
			// Wrapping also handles a synchronous exception in a supplied uploader.
			void Promise.resolve()
				.then(() => uploadFile(file))
				.then(
					(result) =>
						updateFiles((previous) =>
							previous.map((entry) =>
								entry.uid === item.uid
									? { ...entry, fileId: result.file_id, status: "done", description: "Ready" }
									: entry,
							),
						),
					() =>
						updateFiles((previous) =>
							previous.map((entry) =>
								entry.uid === item.uid
									? { ...entry, status: "error", description: "Upload failed. Remove and select again." }
									: entry,
							),
						),
				);
		}
	};

	const submit = async (text: string, selectedSkills?: string[]) => {
		const selected = currentFiles.current;
		if (
			!canSend ||
			turnRunning ||
			sending.current ||
			!text.trim() ||
			selected.some((file) => file.status !== "done" || !file.fileId)
		) {
			return;
		}
		sending.current = true;
		setSubmitting(true);
		setError(null);
		try {
			await onSubmit(
				text.trim(),
				selected.flatMap((file) => (file.fileId ? [file.fileId] : [])),
				selectedSkills,
			);
			if (!mounted.current) return;
			setDraft((current) => (current === text ? "" : current));
			const submitted = new Set(selected.map((file) => file.uid));
			updateFiles((previous) => previous.filter((file) => !submitted.has(file.uid)));
		} catch {
			if (mounted.current) setError("Send failed. Your draft and files are preserved.");
		} finally {
			sending.current = false;
			if (mounted.current) setSubmitting(false);
		}
	};

	const filesBlocked = files.some((file) => file.status !== "done" || !file.fileId);
	const skillNames = skills?.map((skill) => skill.name) ?? [];

	return (
		<div className="flex flex-col gap-2" data-kit-appearance="workspace">
			<Suggestion
				block
				items={(skills ?? []).map((skill) => ({
					value: skill.name,
					label: skill.name,
					description: skill.description,
					icon: <SkillGlyph className="size-4" />,
				}))}
				value={draft}
				caret={selection.end}
				trigger="/"
				filter={(item, query) =>
					item.value.toLowerCase().startsWith(query.toLowerCase()) &&
					!skillInputTokens(draft, skillNames).includes(item.value)
				}
				onSelect={(_, item, context) => {
					if (!context) return;
					const end = draft[context.end] === " " ? context.end + 1 : context.end;
					sender.current?.replaceRange(context.start, end, `/${item.value} `);
				}}
			>
				{({ onKeyDown, inputProps }) => (
					<Sender
						ref={sender}
						onSelectionChange={setSelection}
						onKeyDown={onKeyDown}
						inputProps={inputProps}
						variant="workspace"
						value={draft}
						skills={skills}
						onChange={setDraft}
						placeholder="Write a message or paste files"
						loading={turnRunning}
						submitDisabled={!canSend || submitting || filesBlocked}
						onSubmit={(text, selectedSkills) => void submit(text, selectedSkills)}
						onCancel={onStop}
						onPasteFile={selectFiles}
						header={
							<Sender.Header title="Attachments" open={open} onOpenChange={setOpen}>
								<Attachments
									ref={attachments}
									items={files}
									maxCount={maxCount}
									disabled={turnRunning || submitting}
									onSelectFiles={selectFiles}
									onRemove={(item) => updateFiles((previous) => previous.filter((file) => file.uid !== item.uid))}
									placeholder={(type) => ({
										title: type === "drop" ? "Drop files to add them" : "Choose files",
										description: type === "inline" ? "Select, paste, or drag files here" : undefined,
									})}
								/>
							</Sender.Header>
						}
						prefix={
							<button
								type="button"
								disabled={turnRunning || submitting}
								onClick={() => {
									if (open) attachments.current?.select();
									else setOpen(true);
								}}
							>
								Attach files
							</button>
						}
						suffix={(_origin, { components }) =>
							turnRunning ? (
								<components.LoadingButton>Stop</components.LoadingButton>
							) : (
								<components.SendButton>{submitting ? "Sending" : "Send"}</components.SendButton>
							)
						}
						footer={({ components }) => <components.ClearButton>Clear text</components.ClearButton>}
					/>
				)}
			</Suggestion>
			{error ? <p role="alert">{error}</p> : null}
		</div>
	);
}
