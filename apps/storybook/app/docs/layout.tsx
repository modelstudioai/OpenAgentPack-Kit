import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { RouteTheme } from "../../components/route-theme.tsx";
import { baseOptions } from "../../lib/layout.tsx";
import { source } from "../../lib/source.ts";

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout
			tree={source.pageTree}
			{...baseOptions}
			sidebar={{ defaultOpenLevel: 1 }}
			themeSwitch={{ enabled: false }}
		>
			<RouteTheme theme="light" />
			{children}
		</DocsLayout>
	);
}
