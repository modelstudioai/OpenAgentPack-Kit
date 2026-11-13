import type { AdminMemberView, MemberView } from "@openagentpack/kit-sdk/protocol";
import type { TableColumnsType } from "antd";
import { Button, Empty, Input, Result, Spin, Table, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { createAdminClient } from "../../lib/admin/index.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminRequest } from "../../lib/kit.ts";
import { useConsoleRoute } from "../navigation/console-router.tsx";
import { CreateMemberPage } from "./create-member-page.tsx";
import { MemberUsageRoute } from "./member-usage-route.tsx";
import styles from "./members.module.less";
import { UsageCollectionStatus } from "./usage-collection-status.tsx";
import { usageValue } from "./usage-metrics.tsx";
import { useMembers } from "./use-members.ts";

function MembersContent({
	members,
	onCreate,
	onUsage,
	canWrite,
}: {
	members: ReturnType<typeof useMembers>;
	onCreate: () => void;
	onUsage: (member: MemberView) => void;
	canWrite: boolean;
}) {
	const columns: TableColumnsType<AdminMemberView> = [
		{
			title: "显示名",
			dataIndex: "display_name",
			width: 140,
			fixed: "left",
			render: (value: string) => <span className={styles.nameText}>{value}</span>,
		},
		{
			title: "用户名",
			dataIndex: "username",
			width: 130,
			render: (value: string) => <span className={styles.monoText}>{value}</span>,
		},
		{
			title: "邮箱",
			dataIndex: "email",
			width: 170,
			render: (value: string | undefined) => <span className={styles.mutedText}>{value ?? "—"}</span>,
		},
		{ title: "认证方式", width: 90, render: () => "本地账号" },
		{ title: "账号状态", width: 90, render: () => <Tag color="success">启用</Tag> },
		{
			title: "会话数",
			width: 90,
			render: (_, member) => (
				<span className={styles.tabularNum}>{member.usage_summary?.session_count ?? "待获取"}</span>
			),
		},
		{
			title: "输入 Token",
			width: 110,
			render: (_, member) => (
				<span className={styles.tabularNum}>{usageValue(member.usage_summary, "input_tokens")}</span>
			),
		},
		{
			title: "输出 Token",
			width: 110,
			render: (_, member) => (
				<span className={styles.tabularNum}>{usageValue(member.usage_summary, "output_tokens")}</span>
			),
		},
		{ title: "用量采集", width: 200, render: (_, member) => <UsageCollectionStatus summary={member.usage_summary} /> },
		{
			title: "创建时间",
			width: 170,
			render: (_, member) => (
				<span className={styles.nowrapMuted}>
					<time dateTime={member.created_at}>
						{new Date(member.created_at).toLocaleString("zh-CN", { hour12: false })}
					</time>
				</span>
			),
		},
		{
			title: "成员 ID",
			width: 230,
			render: (_, member) => (
				<Typography.Text copyable={{ text: member.member_id }} className={styles.monoSmall}>
					{member.member_id}
				</Typography.Text>
			),
		},
		{
			title: "操作",
			width: 100,
			fixed: "right",
			render: (_, member) => (
				<Button type="link" size="small" onClick={() => onUsage(member)}>
					查看用量
				</Button>
			),
		},
	];
	if (members.error)
		return (
			<Result
				status="error"
				title="成员列表加载失败"
				subTitle={members.error}
				extra={<Button onClick={members.refresh}>重试</Button>}
			/>
		);
	return (
		<Table
			rowKey="member_id"
			columns={columns}
			dataSource={members.rows}
			loading={members.loading}
			pagination={false}
			scroll={{ x: "max-content" }}
			sticky
			size="middle"
			locale={{
				emptyText: (
					<div className={styles.emptyWrap}>
						<Empty
							image={Empty.PRESENTED_IMAGE_SIMPLE}
							description={
								<div>
									<p>{members.search ? "未找到匹配的用户" : "暂无用户"}</p>
									<p className={styles.emptyHint}>
										{members.search ? "试试其他用户名或显示名。" : "创建第一位成员，统一管理本地账号。"}
									</p>
								</div>
							}
						/>
						{!members.search && canWrite && (
							<Button type="primary" onClick={onCreate}>
								创建用户
							</Button>
						)}
					</div>
				),
			}}
		/>
	);
}

function MembersList({
	onCreate,
	onUsage,
	canWrite,
}: {
	onCreate: () => void;
	onUsage: (member: MemberView) => void;
	canWrite: boolean;
}) {
	const members = useMembers();
	const [search, setSearch] = useState("");
	return (
		<div className={styles.stack}>
			<div className={styles.controlsRow}>
				<form
					className={styles.searchForm}
					onSubmit={(event) => {
						event.preventDefault();
						members.searchFor(search);
					}}
				>
					<Input
						aria-label="用户名或显示名搜索"
						placeholder="用户名或显示名搜索"
						maxLength={254}
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className={styles.searchInput}
					/>
					<Button htmlType="submit" className={styles.searchSubmit}>
						搜索
					</Button>
				</form>
				<Button disabled={members.loading} onClick={members.refresh}>
					刷新
				</Button>
			</div>
			<MembersContent members={members} onCreate={onCreate} onUsage={onUsage} canWrite={canWrite} />
			{!members.error && (members.page > 1 || members.hasNext) && (
				<nav aria-label="成员列表分页" className={styles.pager}>
					<Button size="small" disabled={members.loading || members.page === 1} onClick={members.previous}>
						上一页
					</Button>
					<span>第 {members.page} 页</span>
					<Button size="small" disabled={members.loading || !members.hasNext} onClick={members.next}>
						下一页
					</Button>
				</nav>
			)}
		</div>
	);
}

function IdentityPending({ error, role, onRetry }: { error: string | null; role?: string; onRetry: () => void }) {
	if (error)
		return (
			<Result status="error" title="身份确认失败" subTitle={error} extra={<Button onClick={onRetry}>重试</Button>} />
		);
	if (role === "auditor") return <p>当前身份只读，不能创建用户。</p>;
	return (
		<div className={styles.pendingRow}>
			<Spin size="small" />
			正在确认管理员身份…
		</div>
	);
}

export function MembersPage({ onPendingChange }: { onPendingChange: (pending: boolean) => void }) {
	const { route, navigate } = useConsoleRoute();
	const creating = route.page === "member-create";
	const client = useMemo(() => createAdminClient({ request: adminRequest() }), []);
	const identity = useAdminQuery("members:identity", (signal) => client.identity(signal));
	const canWrite = identity.data?.role === "admin";
	if (route.page === "member-usage" && route.id) return <MemberUsageRoute key={route.id} id={route.id} />;
	if (creating) {
		if (canWrite)
			return <CreateMemberPage onBack={() => navigate({ page: "members" })} onPendingChange={onPendingChange} />;
		return (
			<section className={styles.stack}>
				<Button onClick={() => navigate({ page: "members" })}>返回成员列表</Button>
				<IdentityPending error={identity.error} role={identity.data?.role} onRetry={() => void identity.refresh()} />
			</section>
		);
	}
	return (
		<section aria-labelledby="members-heading" className={styles.stack}>
			<header className={styles.pageHeader}>
				<div>
					<h2 id="members-heading" className={styles.pageTitle}>
						成员管理
					</h2>
					<p className={styles.pageSub}>管理本地成员账号，成员可使用用户名和密码登录体验页。</p>
				</div>
				{canWrite && (
					<Button type="primary" onClick={() => navigate({ page: "member-create" })}>
						创建用户
					</Button>
				)}
			</header>
			{identity.error && (
				<Result
					status="error"
					title="身份确认失败"
					subTitle={identity.error}
					extra={<Button onClick={() => void identity.refresh()}>重试</Button>}
				/>
			)}
			{identity.data?.role === "auditor" && <p className={styles.mutedNote}>当前身份只读。</p>}
			<MembersList
				onCreate={() => navigate({ page: "member-create" })}
				onUsage={(member) => navigate({ page: "member-usage", id: member.member_id })}
				canWrite={canWrite}
			/>
		</section>
	);
}
