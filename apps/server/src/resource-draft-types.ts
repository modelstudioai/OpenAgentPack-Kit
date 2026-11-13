import type { ProjectResourceBinding } from "@openagentpack/kit-sdk/protocol";

/** 发布凭证保留依赖 Skill，公开运行时选择仍使用原五类 DTO。 */
export type ResourceDraftPublishedBinding =
	| ProjectResourceBinding
	| {
			type: "skill";
			id: string;
			remote_id: string;
			version?: string;
	  };
