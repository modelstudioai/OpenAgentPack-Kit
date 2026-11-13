import { Button, Card, Input } from "antd";
import { adminBaseUrl, setAdminToken } from "../../lib/auth.ts";
import styles from "./auth.module.less";

export function AdminLogin({ onLogin }: { onLogin: (token: string) => void }) {
	return (
		<div className={styles.loginRoot}>
			<Card className={styles.loginCard}>
				<h1 className={styles.loginTitle}>管理端登录</h1>
				<p className={styles.loginHint}>
					输入以下服务的 <code>ADMIN_TOKEN</code>（.env 中配置）。令牌仅用于该服务。
				</p>
				<p className={styles.loginServer}>当前服务：{adminBaseUrl()}</p>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const token = new FormData(event.currentTarget).get("token") as string;
						setAdminToken(token);
						onLogin(token);
					}}
				>
					<Input.Password name="token" required placeholder="ADMIN_TOKEN" className={styles.fieldGap} />
					<Button type="primary" htmlType="submit" block className={styles.fieldGap}>
						进入
					</Button>
				</form>
			</Card>
		</div>
	);
}
