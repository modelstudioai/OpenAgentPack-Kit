import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

/**
 * 文档、组件、SDK 与接口由侧边栏分类导航提供。
 * 仓库链接用 Fumadocs 内置的 `githubUrl` 图标位（自托管 GitLab 地址同样适用）。
 * 导航图标是内联 SVG（components/icons.tsx），不用 emoji。
 */
export const baseOptions: BaseLayoutProps = {
	nav: {
		title: (
			<span className="flex items-center gap-2">
				<span
					className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[15px] text-white"
					style={{ background: "linear-gradient(135deg, var(--kd-accent), var(--kd-accent-3))" }}
				>
					<svg
						viewBox="0 0 24 24"
						width="15"
						height="15"
						fill="none"
						stroke="currentColor"
						strokeWidth={1.6}
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M12 2.8 20 7v10l-8 4.2L4 17V7l8-4.2Z" />
						<path d="M4 7l8 4.4L20 7" />
						<path d="M12 11.4V21.2" />
					</svg>
				</span>
				OpenAgentPack Kit
			</span>
		),
	},
	githubUrl: "https://github.com/modelstudioai/OpenAgentPack-Kit",
};
