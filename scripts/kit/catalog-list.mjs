// biome-ignore lint/suspicious/noUndeclaredEnvVars: 仓库命令直接读取本地 server 配置，不参与 Turbo 缓存。
const base = process.env.KIT_API_BASE ?? "http://localhost:8787";
// biome-ignore lint/suspicious/noUndeclaredEnvVars: 仓库命令直接读取本地管理端令牌，不参与 Turbo 缓存。
const token = process.env.ADMIN_TOKEN ?? "";
const response = await fetch(`${base}/api/admin/agents`, {
	headers: { authorization: `Bearer ${token}` },
});
if (!response.ok) {
	console.error(`catalog list 失败：HTTP ${response.status}`);
	process.exit(1);
}
const body = await response.json();
console.log(JSON.stringify(body.data, null, 2));
