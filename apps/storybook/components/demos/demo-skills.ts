import type { SenderSkill } from "@openagentpack/kit-chat-ui";

/** 本地候选用于演示编辑与载荷；不代表预览实际执行了技能。 */
export const DEMO_SKILLS: SenderSkill[] = [
	{ name: "summarize", description: "归纳资料中的重点与下一步行动" },
	{ name: "writing", description: "整理文案、改写与写作提纲" },
];
