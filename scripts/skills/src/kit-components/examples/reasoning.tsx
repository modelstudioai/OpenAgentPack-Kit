import { ReasoningBlock } from "@openagentpack/kit-chat-ui";
import { useState } from "react";

// Real chat messages supply each reasoning part's status through the Provider.
// These controls demonstrate one stable component across lifecycle transitions.
export function ReasoningLifecycle() {
	const [status, setStatus] = useState<"streaming" | "done" | "failed" | "interrupted">("done");
	return (
		<div className="flex flex-col gap-3" data-kit-appearance="workspace">
			<fieldset className="flex flex-wrap gap-3">
				<legend className="sr-only">Reasoning lifecycle controls</legend>
				<button type="button" onClick={() => setStatus("streaming")}>
					Start reasoning
				</button>
				<button type="button" onClick={() => setStatus("done")}>
					Complete
				</button>
				<button type="button" onClick={() => setStatus("interrupted")}>
					Interrupt
				</button>
				<button type="button" onClick={() => setStatus("failed")}>
					Fail
				</button>
			</fieldset>
			<ReasoningBlock text="Compare the evidence before answering." status={status} />
		</div>
	);
}
