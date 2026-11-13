import { SubAgentPanel, Tooltip } from "@openagentpack/kit-chat-ui";
import type { ChatMultiAgent } from "@openagentpack/kit-sdk/chat";
import type {
	AgentMemoryStore,
	AgentResourceItem,
	AgentSummary,
	ArtifactDescriptor,
	RemoteAgentResources,
} from "@openagentpack/kit-sdk/protocol";

/** 产物行首的扩展名徽标文案，与 chat-ui FileCard 的 fileIcon 同一套图标语言（黑白灰）。 */
function artifactBadge(name: string | undefined, type: string | undefined): string {
	const filename = name ?? "";
	const extension = filename.includes(".") ? (filename.split(".").pop()?.toUpperCase() ?? "") : "";
	if (type?.startsWith("image/") || ["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG"].includes(extension)) return "IMG";
	if (type?.startsWith("audio/")) return "AUD";
	if (type?.startsWith("video/")) return "VID";
	if (type === "application/pdf" || extension === "PDF") return "PDF";
	if (["ZIP", "GZ", "TAR", "RAR", "7Z"].includes(extension)) return "ZIP";
	if (["XLS", "XLSX", "CSV"].includes(extension)) return "XLS";
	return extension.slice(0, 4) || "FILE";
}

/** 资源面板「Agent 信息」分区：标题行点击折叠，内容为名称与描述（.kit-collapse 高度过渡）。 */
function AsideAgentSection({ name, description }: { name: string; description: string | undefined }) {
	return (
		<details open className="kit-collapse group/agent min-w-0">
			<summary className="-mx-2 flex min-w-0 cursor-pointer list-none select-none items-center gap-2 rounded-[var(--kit-radius-sm)] px-2 py-1 transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] [&::-webkit-details-marker]:hidden">
				<span className="text-[length:var(--kit-text-label)] font-medium text-[var(--kit-fg-muted)]">Agent 信息</span>
				<svg
					aria-hidden="true"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="ml-auto size-3.5 shrink-0 text-[var(--kit-fg-muted)] transition-transform duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none group-open/agent:rotate-90"
				>
					<path d="m9 6 6 6-6 6" />
				</svg>
			</summary>
			<div className="mt-1.5 min-w-0">
				<div className="text-[length:var(--kit-text-label)] font-medium text-[var(--kit-fg)]">{name}</div>
				{description ? (
					<p className="mt-1 text-[length:var(--kit-text-label)] leading-6 text-[var(--kit-fg-muted)] [overflow-wrap:anywhere]">
						{description}
					</p>
				) : null}
			</div>
		</details>
	);
}

/** 资源面板「会话产物」分区：行点击新窗口预览（不可预览类型由调用方回退下载）、
 * 行尾下载按钮直接下载；两个交互并列不嵌套；无产物时保留空态占位。 */
function AsideArtifactsSection({
	artifacts,
	onArtifactOpen,
	onArtifactDownload,
}: {
	artifacts: ArtifactDescriptor[];
	onArtifactOpen: (fileId: string, contentType?: string) => void;
	onArtifactDownload: (fileId: string) => void;
}) {
	return (
		<details open className="kit-collapse group/artifacts mt-6 min-w-0">
			<summary className="-mx-2 flex min-w-0 cursor-pointer list-none select-none items-center gap-2 rounded-[var(--kit-radius-sm)] px-2 py-1 transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] [&::-webkit-details-marker]:hidden">
				<span className="text-[length:var(--kit-text-label)] font-medium text-[var(--kit-fg-muted)]">产物</span>
				{artifacts.length > 0 ? (
					<span className="text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)] tabular-nums">
						· {artifacts.length}
					</span>
				) : null}
				<svg
					aria-hidden="true"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="ml-auto size-3.5 shrink-0 text-[var(--kit-fg-muted)] transition-transform duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none group-open/artifacts:rotate-90"
				>
					<path d="m9 6 6 6-6 6" />
				</svg>
			</summary>
			{artifacts.length > 0 ? (
				<ul className="mt-1.5 flex flex-col">
					{artifacts.map((artifact) => {
						const name = artifact.filename ?? artifact.file_id;
						return (
							<li
								key={artifact.file_id}
								className="flex items-center gap-1 rounded-[var(--kit-radius-sm)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-bg-subtle)]"
							>
								<button
									type="button"
									title={name}
									aria-label={`打开 ${name}`}
									onClick={() => onArtifactOpen(artifact.file_id, artifact.content_type)}
									className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[var(--kit-radius-sm)] px-1.5 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
								>
									<span
										aria-hidden
										className="grid size-7 shrink-0 place-items-center rounded-[var(--kit-radius-xs)] bg-[var(--kit-bg-subtle)] text-[9px] font-semibold text-[var(--kit-fg-muted)]"
									>
										{artifactBadge(artifact.filename, artifact.content_type)}
									</span>
									<span className="min-w-0 flex-1 truncate text-[length:var(--kit-text-label)] text-[var(--kit-fg)]">
										{name}
									</span>
								</button>
								<button
									type="button"
									aria-label={`下载 ${name}`}
									title="下载"
									onClick={() => onArtifactDownload(artifact.file_id)}
									className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[var(--kit-radius-sm)] text-[var(--kit-fg-muted)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none hover:bg-[var(--kit-nav-active)] hover:text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)]"
								>
									<svg
										aria-hidden="true"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										strokeLinejoin="round"
										className="size-3.5"
									>
										<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
									</svg>
								</button>
							</li>
						);
					})}
				</ul>
			) : (
				<div className="mt-2 rounded-[var(--kit-radius-sm)] border border-dashed border-[var(--kit-border)] px-3 py-3 text-[length:var(--kit-text-caption)] leading-relaxed text-[var(--kit-fg-muted)]">
					发送消息后，生成的文件与图表会出现在这里
				</div>
			)}
		</details>
	);
}

/** 资源面板主体：Agent 信息 + 子 Agent 分区 + MCP/工具/Skills 分区 + 会话产物。资源由 ChatView
 * 拉取后传入（输入框技能选择与这里共用一份数据），不再随面板开合懒加载。 */
export function AsidePanelSections({
	agent,
	resources,
	memories,
	multiAgent,
	artifacts,
	onArtifactOpen,
	onArtifactDownload,
}: {
	agent: AgentSummary;
	resources: RemoteAgentResources | null;
	memories: AgentMemoryStore[] | null;
	multiAgent?: ChatMultiAgent;
	artifacts: ArtifactDescriptor[];
	onArtifactOpen: (fileId: string, contentType?: string) => void;
	onArtifactDownload: (fileId: string) => void;
}) {
	return (
		<>
			<AsideAgentSection name={agent.display_name} description={agent.description} />
			<SubAgentPanel multiAgent={multiAgent} />
			<AsideAgentResourceSections resources={resources} />
			<AsideMemoryStoresSection stores={memories} />
			<AsideArtifactsSection
				artifacts={artifacts}
				onArtifactOpen={onArtifactOpen}
				onArtifactDownload={onArtifactDownload}
			/>
		</>
	);
}

/** 资源分区行图标：与附件图标同族（24 viewBox、1.5 描边、currentColor）；技能=书、MCP=插头、工具=扳手。 */
const SkillIcon = ({ className }: { className: string }) => (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
		<path strokeLinecap="round" strokeLinejoin="round" d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
		<path strokeLinecap="round" strokeLinejoin="round" d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
	</svg>
);

const McpIcon = ({ className }: { className: string }) => (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			d="M9 7V2.5M15 7V2.5M7 7h10v5.5a5 5 0 0 1-5 5 5 5 0 0 1-5-5zM12 17.5v4"
		/>
	</svg>
);

const ToolIcon = ({ className }: { className: string }) => (
	<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"
		/>
	</svg>
);

/** 资源行类型 → 图标：技能与 MCP 合并分区按条目来源区分图标。 */
const RESOURCE_ICONS = { skill: SkillIcon, mcp: McpIcon, tool: ToolIcon } as const;
type AgentResourceRow = AgentResourceItem & { kind: keyof typeof RESOURCE_ICONS };

/** 工具权限标记文案：与运行时审批语义对齐（ask 走审批卡，allow 直接执行）。 */
const PERMISSION_LABELS = { allow: "总是允许", ask: "每次询问" } as const;

/** 三个配置分区共用一份资源投影；Skills 与 MCP 同属外部能力清单故合并展示（skills 在前），
 * 工具单列；收在这里避免 ChatView 复杂度继续膨胀。 */
function AsideAgentResourceSections({ resources }: { resources: RemoteAgentResources | null }) {
	const skillRows: AgentResourceRow[] = (resources?.skills ?? []).map((item) => ({ ...item, kind: "skill" }));
	const mcpRows: AgentResourceRow[] = (resources?.mcp_servers ?? []).map((item) => ({ ...item, kind: "mcp" }));
	const toolRows: AgentResourceRow[] = (resources?.tools ?? []).map((item) => ({ ...item, kind: "tool" }));
	return (
		<>
			<AsideResourceSection title="技能与 MCP" items={[...skillRows, ...mcpRows]} />
			<AsideResourceSection title="工具" items={toolRows} />
		</>
	);
}

/** 资源面板「技能与 MCP / 工具」分区：类型图标 + 名称（+ 权限标记）的紧凑列表；空分区不渲染。 */
function AsideResourceSection({ title, items }: { title: string; items: AgentResourceRow[] }) {
	if (items.length === 0) return null;
	return (
		<details open className="kit-collapse group/res mt-6 min-w-0">
			<summary className="-mx-2 flex min-w-0 cursor-pointer list-none select-none items-center gap-2 rounded-[var(--kit-radius-sm)] px-2 py-1 transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] [&::-webkit-details-marker]:hidden">
				<span className="text-[length:var(--kit-text-label)] font-medium text-[var(--kit-fg-muted)]">{title}</span>
				<span className="text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)] tabular-nums">
					· {items.length}
				</span>
				<svg
					aria-hidden="true"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="ml-auto size-3.5 shrink-0 text-[var(--kit-fg-muted)] transition-transform duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none group-open/res:rotate-90"
				>
					<path d="m9 6 6 6-6 6" />
				</svg>
			</summary>
			<ul className="mt-1.5 flex flex-col">
				{items.map((item) => {
					const Icon = RESOURCE_ICONS[item.kind];
					return (
						<li key={`${item.kind}:${item.name}`} className="rounded-[var(--kit-radius-sm)] px-1.5 py-1.5">
							<div className="flex items-center gap-1.5">
								<Icon className="size-3.5 shrink-0 text-[var(--kit-fg-muted)]" />
								<div className="truncate text-[length:var(--kit-text-label)] font-medium text-[var(--kit-fg)]">
									{item.name}
								</div>
								{item.permission ? (
									<span className="ml-auto shrink-0 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
										{PERMISSION_LABELS[item.permission]}
									</span>
								) : null}
							</div>
						</li>
					);
				})}
			</ul>
		</details>
	);
}

/** 资源面板「记忆库」分区：目录配置的成员侧最小投影（库名称 + 单行描述，溢出 tooltip 展开），
 * 不透出库 ID、权限或条目；未配置或解析降级时整体隐藏。 */
function AsideMemoryStoresSection({ stores }: { stores: AgentMemoryStore[] | null }) {
	if (!stores?.length) return null;
	return (
		<details open className="kit-collapse group/memory mt-6 min-w-0">
			<summary className="-mx-2 flex min-w-0 cursor-pointer list-none select-none items-center gap-2 rounded-[var(--kit-radius-sm)] px-2 py-1 transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] [&::-webkit-details-marker]:hidden">
				<span className="text-[length:var(--kit-text-label)] font-medium text-[var(--kit-fg-muted)]">记忆库</span>
				<span className="text-[length:var(--kit-text-meta)] text-[var(--kit-fg-muted)] tabular-nums">
					· {stores.length}
				</span>
				<svg
					aria-hidden="true"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="ml-auto size-3.5 shrink-0 text-[var(--kit-fg-muted)] transition-transform duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none group-open/memory:rotate-90"
				>
					<path d="m9 6 6 6-6 6" />
				</svg>
			</summary>
			<ul className="mt-1.5 flex flex-col gap-3">
				{stores.map((store) => (
					<li key={store.name} className="min-w-0 px-1.5">
						<div className="text-[length:var(--kit-text-label)] font-medium text-[var(--kit-fg)]">{store.name}</div>
						{store.description ? (
							<Tooltip
								className="mt-0.5 block truncate text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]"
								content={store.description}
								overflowOnly
							>
								{store.description}
							</Tooltip>
						) : null}
					</li>
				))}
			</ul>
		</details>
	);
}
