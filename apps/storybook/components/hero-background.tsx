"use client";

import { useState } from "react";
import { ColorBends, ColorBendsChips, requestBgRedraw, type VariantName } from "./backgrounds/color-bends.tsx";

/** hero 背景 = ColorBends shader + 变体切换（reactbits 首页同款交互：背景可选配色）。 */
export function HeroBackground() {
	const [variant, setVariant] = useState<VariantName>("nebula");
	return (
		<>
			<ColorBends variant={variant} />
			<ColorBendsChips
				value={variant}
				onChange={(v) => {
					setVariant(v);
					requestBgRedraw();
				}}
			/>
		</>
	);
}
