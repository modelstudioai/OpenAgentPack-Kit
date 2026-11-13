import { useEffect, useState } from "react";

export function useIsMobile(breakpointPx = 768): boolean {
	const [isMobile, setIsMobile] = useState(() =>
		typeof window === "undefined" ? false : window.innerWidth < breakpointPx,
	);
	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const query = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
		const onChange = () => setIsMobile(query.matches);
		onChange();
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, [breakpointPx]);
	return isMobile;
}
