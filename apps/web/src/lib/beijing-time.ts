const formatter = new Intl.DateTimeFormat("zh-CN", {
	timeZone: "Asia/Shanghai",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
});

/** 固定北京时间，不依赖浏览器或宿主时区；计量键和服务端时间戳不改写。 */
export function formatBeijingTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** 服务端聚合日键对应的起点，展示其真实北京时间，而非按北京零点重新解释。 */
export function formatUsageDayStart(day: string): string {
	return formatBeijingTime(`${day}T00:00:00Z`);
}
