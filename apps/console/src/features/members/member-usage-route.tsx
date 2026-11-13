import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Result, Spin } from "antd";
import { useMemo } from "react";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { getAdminClient } from "../../lib/api.ts";
import { useConsoleRoute } from "../navigation/console-router.tsx";
import { MemberUsagePage } from "./member-usage-page.tsx";
import styles from "./members.module.less";

/** 深链按稳定 ID 读取单个成员，不依赖列表页内存或扫描整个目录。 */
export function MemberUsageRoute({ id, onReturn }: { id: string; onReturn?: () => void }) {
	const client = useMemo(getAdminClient, []);
	const { route, navigate } = useConsoleRoute();
	const member = useAdminQuery(`member:detail:${id}`, (signal) => client.members.get(id, signal));
	const backLabel = route.from === "usage" ? "返回用量列表" : "返回成员列表";
	const onBack = () => {
		onReturn?.();
		navigate({ page: route.from === "usage" ? "usage" : "members" });
	};
	if (member.data && !member.loading && !member.error)
		return (
			<MemberUsagePage
				member={member.data}
				onBack={onBack}
				backLabel={backLabel}
				editLimits={route.limits === "edit"}
			/>
		);
	return (
		<section className={styles.routeRoot}>
			<Button icon={<ArrowLeftOutlined />} onClick={onBack}>
				{backLabel}
			</Button>
			{member.error ? (
				<Result
					status="error"
					title={member.error}
					extra={
						<Button
							onClick={() => {
								void member.refresh();
							}}
						>
							重试
						</Button>
					}
				/>
			) : (
				<div className={styles.loadingRowTall}>
					<Spin />
				</div>
			)}
		</section>
	);
}
