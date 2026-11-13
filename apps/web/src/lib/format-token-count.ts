const compact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	compactDisplay: "short",
	maximumFractionDigits: 2,
});
const exact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });

/** 用户端 Token 统一千进制 K/M/B/T，最多两位小数；舍入跨界时自动提升单位。 */
export function formatTokenCount(value: number): string {
	return compact.format(value);
}

/** 悬停查看原始数值；仅用于展示，不参与任何额度判断。 */
export function formatExactTokenCount(value: number): string {
	return exact.format(value);
}
