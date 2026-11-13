import { EmptyState, ErrorState } from "@openagentpack/kit-chat-ui";
import type { RemoteVaultDetail, ResourceDraftDeclaration } from "@openagentpack/kit-sdk/protocol";
import { Drawer } from "antd";
import { useMemo } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import type { TemplateVaultSelectionValue } from "./template-local-resources.tsx";
import styles from "./template-resources.module.less";

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** 本地声明接口已脱敏，视图仍只投影三项展示字段，不读取或渲染 secret_value。 */
function localDetail(vault: TemplateVaultSelectionValue, source: ResourceDraftDeclaration): RemoteVaultDetail {
	const declaration = source.declaration;
	const credentials = Array.isArray(declaration.credentials) ? declaration.credentials : [];
	return {
		vault_id: vault.local?.id ?? vault.vault_id,
		name: vault.name,
		credentials: credentials.flatMap((raw) => {
			const item = object(raw);
			if (typeof item.name !== "string") return [];
			const hosts = object(item.networking).allowed_hosts;
			return [
				{
					credential_id: item.name,
					name: item.name,
					secret_name: typeof item.secret_name === "string" ? item.secret_name : "",
					allowed_hosts: Array.isArray(hosts) ? hosts.filter((host): host is string => typeof host === "string") : [],
				},
			];
		}),
	};
}

export function useTemplateVaultDetail(vault: TemplateVaultSelectionValue, enabled = true) {
	const client = useMemo(getAdminClient, []);
	return useAdminQuery(
		`templates:vault-detail:${vault.vault_id}`,
		async (signal) =>
			vault.local
				? localDetail(
						vault,
						await client.draftResources.declaration(vault.local.projectName, "vault", vault.local.id, signal),
					)
				: client.remoteVault(vault.vault_id, signal),
		{ enabled },
	);
}

/** 选择列表保留只读详情抽屉；主表单复用同一查询加载编辑基线。 */
export function TemplateVaultDetail({ vault }: { vault: TemplateVaultSelectionValue }) {
	const detail = useTemplateVaultDetail(vault);
	if (detail.error)
		return (
			<div className={styles.blockStack}>
				<p className={styles.monoId}>{vault.vault_id}</p>
				<ErrorState message={detail.error} onRetry={() => void detail.refresh()} />
			</div>
		);
	if (detail.loading || !detail.data)
		return (
			<div className={styles.blockStack}>
				<p className={styles.monoId}>{vault.vault_id}</p>
				<EmptyState loading title="正在加载密钥库详情…" />
			</div>
		);
	return <TemplateVaultDetailView detail={detail.data} local={Boolean(vault.local)} />;
}

/** 创建页与运行时资源选择共用安全元数据视图，不展示密钥值。 */
export function TemplateVaultDetailView({ detail, local = false }: { detail: RemoteVaultDetail; local?: boolean }) {
	const { name, vault_id, credentials } = detail;
	return (
		<div className={styles.detailRoot}>
			<div className={styles.stack2}>
				<h3 className={styles.detailName}>{name || vault_id}</h3>
				<p className={styles.monoMetaAnywhere}>{vault_id}</p>
				{local ? <p className={styles.metaText}>待发布</p> : null}
			</div>
			<section aria-label="密钥列表" className={styles.blockStack}>
				<h3 className={styles.sectionLabel}>密钥（{credentials.length}）</h3>
				{credentials.length ? (
					<table className={styles.credentialTable}>
						<caption className={styles.srOnly}>密钥名称、变量名和生效域名</caption>
						<thead className={styles.credentialHead}>
							<tr>
								{["密钥名称", " 变量名", "生效域名"].map((label) => (
									<th key={label} scope="col" className={styles.credentialTh}>
										{label}
									</th>
								))}
							</tr>
						</thead>
						<tbody className={styles.credentialBody}>
							{credentials.map((credential) => (
								<tr key={credential.credential_id}>
									<td className={styles.credentialTd}>{credential.name || "—"}</td>
									<td className={styles.credentialTdMono}>{credential.secret_name || "—"}</td>
									<td className={styles.credentialTd}>
										{credential.allowed_hosts.length ? (
											<ul className={styles.fieldStack}>
												{[...new Set(credential.allowed_hosts)].map((host) => (
													<li key={host}>{host}</li>
												))}
											</ul>
										) : (
											"—"
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<EmptyState title="暂无密钥" />
				)}
			</section>
		</div>
	);
}

/** 查看不触发选中；抽屉打开才查询，关闭释放请求与详情。 */
export function TemplateVaultDetailDrawer({
	vault,
	open,
	onClose,
}: {
	vault: TemplateVaultSelectionValue;
	open: boolean;
	onClose: () => void;
}) {
	return (
		<Drawer
			open={open}
			onClose={onClose}
			destroyOnHidden
			width={672}
			title={<div className={styles.drawerTitle}>密钥库详情</div>}
		>
			<TemplateVaultDetail key={vault.vault_id} vault={vault} />
		</Drawer>
	);
}
