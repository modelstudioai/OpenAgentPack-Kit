/**
 * 沙箱产物真回收：turn 收敛后在同一 session 里发一条 harness 指令，让 agent 用 bash
 * 把产物文件带标记 cat 出来；解析标记写进 run 的 outputs/。
 * 回收轮的事件**不进入**评分 transcript（评分只用回收前的事件边界）。
 */
export const RECOVERY_PROMPT =
	"EVAL-HARNESS 产物回收（忽略此前任务语境）：请用 bash 执行以下命令并把完整输出作为回复：" +
	"for f in $(find /workspace /root/workspace /mnt/session/outputs -type f 2>/dev/null | head -20); do " +
	'echo "<!--KIT-ARTIFACT:$f-->"; head -c 200000 "$f"; echo "<!--/KIT-ARTIFACT-->"; done';

export interface RecoveredArtifact {
	path: string;
	content: string;
}

const MARKER = /<!--KIT-ARTIFACT:(.+?)-->([\s\S]*?)<!--\/KIT-ARTIFACT-->/g;

/** 从回收轮文本（bash tool_result 或 assistant 消息）里解析带标记产物。 */
export function parseArtifacts(text: string): RecoveredArtifact[] {
	const out: RecoveredArtifact[] = [];
	for (const m of text.matchAll(MARKER)) {
		const path = (m[1] ?? "").trim();
		if (!path || path.includes("..")) continue;
		out.push({ path, content: m[2] ?? "" });
	}
	return out;
}

/** 落盘安全名：/workspace/docs/prd.md → workspace-docs-prd.md */
export function safeArtifactName(path: string): string {
	return (
		path
			.replace(/^\/+/, "")
			.replace(/[^a-zA-Z0-9._-]+/g, "-")
			.slice(0, 120) || "artifact.txt"
	);
}
