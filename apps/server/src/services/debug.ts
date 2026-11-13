import { randomUUID } from "node:crypto";
import {
	type ApplyRequest,
	type CreateTemplateDebugSessionRequest,
	type DebugSessionDetail,
	KitError,
	type PlanResponse,
	type SendMessageRequest,
	type ToolApprovalDecision,
} from "@openagentpack/kit-sdk/protocol";
import type { ProviderGateway } from "../gateway/types.ts";
import type { AuditLog } from "../store/audit.ts";
import type { SessionIndex } from "../store/sessions.ts";
import { prepareCatalogResources } from "./catalog-resources.ts";
import type { ConfirmGate } from "./confirm-gate.ts";
import type { FileService } from "./files.ts";
import type { SessionService } from "./sessions.ts";

/** 管理员调试只增加用途与目标归属；执行、事件、审批和文件仍走共享服务。 */
export function createDebugService(deps: {
	sessions: SessionService;
	sessionIndex: SessionIndex;
	files: FileService;
	gateway: ProviderGateway;
	gate: ConfirmGate;
	audit: AuditLog;
}) {
	const { sessions, sessionIndex, gateway, gate, audit } = deps;
	function requireSession(subject: string, sessionId: string) {
		const row = sessionIndex.getDebugForSubject(sessionId, subject);
		if (!row) throw new KitError("not_found", "调试会话不存在");
		return row;
	}
	return {
		requireSession,
		async createTemplate(subject: string, input: CreateTemplateDebugSessionRequest): Promise<DebugSessionDetail> {
			const [agents, environments] = await Promise.all([
				gateway.listRemoteAgents(),
				input.remote_environment_id ? gateway.listRemoteEnvironments() : Promise.resolve([]),
			]);
			if (!agents.some((agent) => agent.agent_id === input.remote_agent_id))
				throw new KitError("invalid_request", "所选智能体不存在，请返回选择配置重新选择");
			if (
				input.remote_environment_id &&
				!environments.some((environment) => environment.environment_id === input.remote_environment_id)
			)
				throw new KitError("invalid_request", "所选环境不存在，请返回选择配置重新选择");
			// 这里选择管理员可见的远端资源，并不改变上传归属或授予直接下载权限。
			const resources = await prepareCatalogResources(gateway, input);
			const info = await sessions.create({
				subjectId: subject,
				purpose: "admin_debug",
				debug: {
					source: "template",
					remote_agent_id: input.remote_agent_id,
					agent_version: input.agent_version,
					...(input.remote_environment_id ? { remote_environment_id: input.remote_environment_id } : {}),
					memory_stores: resources.memory_stores,
					vault_ids: resources.vault_ids,
				},
				title: input.title,
				files: resources.files,
			});
			const row = requireSession(subject, info.session_id);
			audit.append({ subject, action: "debug.session.create", target: info.session_id, detail: row.summary });
			return { ...row.summary, files: row.files, ...row.runtime };
		},
		async detail(subject: string, sessionId: string): Promise<DebugSessionDetail> {
			const row = requireSession(subject, sessionId);
			const remote = await gateway.getSession(sessionId);
			return {
				...row.summary,
				files: row.files,
				...row.runtime,
				...(remote?.status ? { remote_status: remote.status } : {}),
			};
		},
		async send(subject: string, sessionId: string, input: SendMessageRequest) {
			requireSession(subject, sessionId);
			if (input.attachments?.length)
				throw new KitError("invalid_request", "附件只能在新建调试会话时挂载，请先上传文件，再新建会话");
			// 管理员调试不调用员工 quota.chargeTurn；共享服务仍等待订阅就绪并拒绝未处理审批。
			const result = await sessions.send(sessionId, {
				text: input.text,
				clientMessageId: input.client_message_id,
				...(input.skills?.length ? { skills: input.skills } : {}),
			});
			audit.append({ subject, action: "debug.session.send", target: sessionId });
			return { session_id: sessionId, accepted: true as const, event_ids: result.event_ids };
		},
		async interrupt(subject: string, sessionId: string) {
			requireSession(subject, sessionId);
			await sessions.interrupt(sessionId);
			audit.append({ subject, action: "debug.session.interrupt", target: sessionId });
			return { interrupted: true };
		},
		approvals(subject: string, sessionId: string) {
			requireSession(subject, sessionId);
			return sessions.toolApprovals(sessionId);
		},
		async approve(subject: string, sessionId: string, input: ToolApprovalDecision) {
			requireSession(subject, sessionId);
			const result = await sessions.respondToolApproval(sessionId, input);
			audit.append({
				subject,
				action: "debug.session.tool_approval",
				target: sessionId,
				detail: { batch_id: input.batch_id, call_id: input.call_id, result: input.result },
			});
			return { session_id: sessionId, accepted: true as const, event_ids: result.event_ids };
		},
		async planDelete(subject: string, sessionId: string): Promise<PlanResponse> {
			requireSession(subject, sessionId);
			const planId = `debug_delete_${randomUUID()}`;
			const issued = await gate.issue({ planId, subject, action: `debug.session.delete:${sessionId}` });
			return {
				plan_id: planId,
				confirm_token: issued.confirmToken,
				expires_at: issued.expiresAt,
				destructive: true,
				diff: [
					{
						resource: `session:${sessionId}`,
						action: "delete",
						destructive: true,
						summary: "删除此调试会话及其本地索引，不修改 Agent 或上架目录",
					},
				],
			};
		},
		async remove(subject: string, sessionId: string, confirmation: ApplyRequest) {
			requireSession(subject, sessionId);
			await gate.consume({
				planId: confirmation.plan_id,
				token: confirmation.confirm_token,
				subject,
				action: `debug.session.delete:${sessionId}`,
			});
			await gateway.deleteSession(sessionId);
			sessionIndex.remove(sessionId);
			audit.append({ subject, action: "debug.session.delete", target: sessionId });
			return { deleted: true };
		},
	};
}

export type DebugService = ReturnType<typeof createDebugService>;
