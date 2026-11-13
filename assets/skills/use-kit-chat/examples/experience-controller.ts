import { createComposer, deriveTitle } from "@openagentpack/kit-sdk/chat";
import {
	type ArtifactHost,
	createArtifactActions,
	createAttachments,
	previewableArtifactType,
	resolveArtifactType,
} from "@openagentpack/kit-sdk/files";
import type { MemberUsageLimitView } from "@openagentpack/kit-sdk/protocol";
import type { KitClient } from "@openagentpack/kit-sdk/providers/kit";
import {
	createSessionActions,
	createSessionDetails,
	createSessionDirectory,
	createSessionSearch,
} from "@openagentpack/kit-sdk/sessions";
import { createQuotaRecovery, readQuotaExceeded, usageLimitsAllowSending } from "@openagentpack/kit-sdk/usage";

// Non-React hosts own subscriptions and disposal. Each controller is a separate capability.
export function createExperienceControllers(client: KitClient, host: ArtifactHost) {
	const directory = createSessionDirectory(client);
	const search = createSessionSearch(client);
	const details = createSessionDetails(client, null);
	const actions = createSessionActions(client, () => directory.reload());
	const attachments = createAttachments(client);
	const composer = createComposer(client);
	const artifacts = createArtifactActions(client, host);
	const quota = createQuotaRecovery(client);
	directory.start();
	return {
		directory,
		search,
		details,
		actions,
		attachments,
		composer,
		artifacts,
		quota,
		dispose() {
			for (const controller of [directory, search, details, actions, attachments, composer, artifacts, quota])
				controller.dispose();
		},
	};
}
export function presentationHelpers(error: unknown, limits: MemberUsageLimitView) {
	return {
		title: deriveTitle("First message"),
		quotaError: readQuotaExceeded(error),
		canRecover: usageLimitsAllowSending(limits),
		type: resolveArtifactType(undefined, "report.pdf", "application/octet-stream"),
		canPreview: previewableArtifactType("application/pdf"),
	};
}
