import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const HASH_PATTERN = /^scrypt\$32768\$8\$3\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

function derive(password: string, salt: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(password, salt, 64, OPTIONS, (error, key) => {
			if (error) reject(error);
			else resolve(key);
		});
	});
}

/** 创建与登录共用参数；异步线程池派生避免阻塞 SSE 事件循环。 */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString("hex");
	const key = await derive(password, salt);
	return `scrypt$${OPTIONS.N}$${OPTIONS.r}$${OPTIONS.p}$${salt}$${key.toString("hex")}`;
}

/** 未知账号和无效派生值也计算一次等成本 scrypt，不按账号存在性快速失败。 */
export async function verifyPassword(password: string, encoded?: string): Promise<boolean> {
	const match = encoded?.match(HASH_PATTERN);
	const salt = match?.[1] ?? "0".repeat(32);
	const expected = Buffer.from(match?.[2] ?? "0".repeat(128), "hex");
	const actual = await derive(password, salt);
	return timingSafeEqual(actual, expected) && !!match;
}
