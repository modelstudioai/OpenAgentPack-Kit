import { useSessionDirectory as usePublicDirectory } from "@openagentpack/kit-sdk/sessions/hooks";
import { useCallback, useState } from "react";

export type SessionDirectorySection = "groups" | "recent";
export type SessionDirectory = ReturnType<typeof useSessionDirectory>;

/** Route selection is UI state; all backend workflows use the documented SDK. */
export function useSessionDirectory(options: { activeSessionId: string | null; onActiveExecuted: () => void }) {
	const directory = usePublicDirectory({
		onExecuted: (id) => {
			if (id === options.activeSessionId) options.onActiveExecuted();
		},
	});
	const [selectedFrom, setSelectedFrom] = useState<{ sessionId: string; section: SessionDirectorySection } | null>(
		null,
	);
	const selectFrom = useCallback(
		(sessionId: string, section: SessionDirectorySection) => setSelectedFrom({ sessionId, section }),
		[],
	);
	return { ...directory, selectedFrom, selectFrom };
}
