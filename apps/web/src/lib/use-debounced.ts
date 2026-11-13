import { useEffect, useState } from "react";

/**
 * 输入防抖：广场搜索每次按键都不该打一次 `/api/kit/plaza`（服务端要扫目录 + 统计）。
 * 只在值稳定 delayMs 之后更新，卸载/再次变化时清掉上一个定时器。
 */
export function useDebounced<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}
