import { CategoryTabs, EmptyState, ErrorState, PlazaCard, type PlazaTabId } from "@openagentpack/kit-chat-ui";
import { usePlaza } from "@openagentpack/kit-sdk/agents/hooks";
import {
	PLAZA_CATEGORY_LABELS,
	type PlazaCategory,
	type PlazaEntry,
	type PlazaView as PlazaSnapshot,
} from "@openagentpack/kit-sdk/protocol";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useDebounced } from "../../lib/use-debounced.ts";
import type { NavigateFn } from "../../lib/use-route.ts";

/** 卡片网格：H5 单列，md 两列，xl 三列（AGENTS.md：同包靠断点适配，不出第二套布局）。 */
const GRID = "grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3";

/**
 * 卡片外层承载测试锚点；`[&>div]:h-full` 让同一行的卡片等高。
 */
function CardGrid({ entries, onOpen }: { entries: PlazaEntry[]; onOpen: (slug: string) => void }) {
	if (entries.length === 0) return null;
	return (
		<div className={GRID}>
			{entries.map((entry) => (
				<div key={entry.slug} data-testid={`plaza-card-${entry.slug}`} className="h-full min-w-0 [&>div]:h-full">
					<PlazaCard entry={entry} onOpen={onOpen} />
				</div>
			))}
		</div>
	);
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<section className="mt-8 min-w-0">
			<div className="mb-4 flex flex-wrap items-baseline gap-2">
				<h2 className="text-[length:var(--kit-text-heading)] font-semibold">{title}</h2>
				{hint ? <span className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">{hint}</span> : null}
			</div>
			{children}
		</section>
	);
}

/** 按 slug 列表取条目：popular / featured 是服务端给的 slug 序，要映射回 entry 才能渲染卡片。 */
function pick(agents: PlazaEntry[], slugs: string[]): PlazaEntry[] {
	const bySlug = new Map(agents.map((entry) => [entry.slug, entry]));
	return slugs.flatMap((slug) => {
		const entry = bySlug.get(slug);
		return entry ? [entry] : [];
	});
}

interface PlazaSections {
	popular: PlazaEntry[];
	mine: PlazaEntry[];
	main: PlazaEntry[];
	mainTitle: string;
	mainHint?: string;
}

/**
 * 分区与主网格的派生规则（纯函数，方便推理）：
 * - 只有「精选 tab + 无关键词」才出「同学们都在用 / 我的 Agent」两个分区；
 * - 精选 tab 的主网格 = featured 条目，featured 为空时回落全部已上架（标题跟着变）；
 * - 分类 tab / 搜索时主网格 = 服务端已过滤的 agents。
 */
function sectionsOf(view: PlazaSnapshot, tab: PlazaTabId, searching: boolean): PlazaSections {
	const agents = view.agents;
	const onFeatured = tab === "featured";
	const featured = pick(agents, view.featured);
	const useFeatured = onFeatured && !searching && featured.length > 0;
	const showSections = onFeatured && !searching;
	const main = useFeatured ? featured : agents;
	/*
	 * 同一个 slug 在一页里只渲染一张卡：主网格优先，分区剔除已出现的条目。
	 * popular 在全员零用量时会回落到「全部已上架」，不去重就会和精选主网格重复
	 * （重复的 data-testid 也会让 E2E 的 strict mode 定位失败）。
	 */
	const shown = new Set(main.map((entry) => entry.slug));
	const takeUnique = (list: PlazaEntry[]): PlazaEntry[] => {
		const unique: PlazaEntry[] = [];
		for (const entry of list) {
			if (shown.has(entry.slug)) continue;
			shown.add(entry.slug);
			unique.push(entry);
		}
		return unique;
	};
	const category = view.categories.find((c) => c.id === tab);
	let mainTitle = "全部 Agent";
	if (searching) mainTitle = "搜索结果";
	else if (onFeatured) mainTitle = useFeatured ? "精选" : "全部 Agent";
	else mainTitle = category?.name ?? PLAZA_CATEGORY_LABELS[tab as PlazaCategory];
	return {
		popular: showSections ? takeUnique(pick(agents, view.popular)) : [],
		mine: showSections ? takeUnique(agents.filter((entry) => entry.stats.mine)) : [],
		main,
		mainTitle,
		...(showSections && !useFeatured ? { mainHint: "还没有精选条目，先看看全部已上架的 Agent" } : {}),
	};
}

/** 结果区：loading / error / 分区 + 主网格。独立成组件，早退分支才不会牵连搜索框与 tab。 */
function PlazaResults({
	view,
	loading,
	error,
	reload,
	tab,
	searching,
	onOpen,
}: {
	view: PlazaSnapshot | null;
	loading: boolean;
	error: string | null;
	reload: () => void;
	tab: PlazaTabId;
	searching: boolean;
	onOpen: (slug: string) => void;
}) {
	if (error)
		return (
			<div className="mt-8 min-w-0 [overflow-wrap:anywhere]">
				<ErrorState message={error} onRetry={reload} />
			</div>
		);
	if (loading || !view)
		return (
			<div className="mt-8 rounded-[var(--kit-radius)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] py-6">
				<EmptyState title="加载中…" loading />
			</div>
		);
	const sections = sectionsOf(view, tab, searching);
	return (
		<>
			{sections.popular.length > 0 ? (
				<Section title="同学们都在用" hint="近 30 天使用最多">
					<CardGrid entries={sections.popular} onOpen={onOpen} />
				</Section>
			) : null}
			{sections.mine.length > 0 ? (
				<Section title="我的 Agent" hint="你用过的">
					<CardGrid entries={sections.mine} onOpen={onOpen} />
				</Section>
			) : null}
			<Section title={sections.mainTitle} hint={sections.mainHint}>
				{sections.main.length > 0 ? (
					<CardGrid entries={sections.main} onOpen={onOpen} />
				) : (
					<div className="rounded-[var(--kit-radius)] border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] py-6">
						<EmptyState
							title={searching ? "没有匹配的 Agent" : "这里还没有 Agent"}
							hint="换个关键词，或到管理端上架一个。"
						/>
					</div>
				)}
			</Section>
		</>
	);
}

/** 广场（默认首页）：搜索 + 分类 tab + 精选/热门/我的分区。
 * 新建聊天页复用同一份内容（heading=false 隐藏「Agent 广场」标题，leading 放「最近使用」chips）。 */
export function PlazaView({
	navigate,
	heading = true,
	leading,
}: {
	navigate: NavigateFn;
	heading?: boolean;
	/** 渲染在页头行与分类 tab 之间的前置内容（如最近使用）。 */
	leading?: ReactNode;
}) {
	const [tab, setTab] = useState<PlazaTabId>("featured");
	const [keyword, setKeyword] = useState("");
	const q = useDebounced(keyword.trim(), 250);
	const category: PlazaCategory | undefined = tab === "featured" ? undefined : tab;
	const { view, loading, error, reload } = usePlaza({
		...(category ? { category } : {}),
		...(q ? { q } : {}),
	});

	/*
	 * CategoryTabs 也是冻结公开面、不接受 data-testid；这里按它的渲染顺序（「精选」+ categories）
	 * 给每个 tab 补 E2E 锚点，避免为了 testid 在 web 侧复制一份 tab 组件。
	 */
	const tabsRef = useRef<HTMLDivElement>(null);
	const tabIds = useMemo(() => ["featured", ...(view?.categories ?? []).map((c) => c.id)], [view]);
	useEffect(() => {
		const buttons = tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
		if (!buttons) return;
		tabIds.forEach((id, index) => {
			buttons[index]?.setAttribute("data-testid", `plaza-tab-${id}`);
		});
	}, [tabIds]);

	return (
		<div className="h-full min-w-0 overflow-y-auto">
			<div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 md:px-8 md:py-8">
				<div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
					<div className="min-w-0">
						{heading ? (
							<h1 className="text-[length:var(--kit-text-display)] font-semibold leading-snug">Agent 广场</h1>
						) : null}
						<p className="mt-2 text-[length:var(--kit-text-label)] leading-relaxed text-[var(--kit-fg-muted)]">
							挑一个同事上架的 Agent，点「开始体验」直接开聊
						</p>
					</div>
					<div className="relative w-full lg:w-72 lg:shrink-0">
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--kit-fg-muted)]"
						>
							<circle cx="10.5" cy="10.5" r="6.5" />
							<path strokeLinecap="round" d="m16 16 4 4" />
						</svg>
						<input
							type="search"
							value={keyword}
							onChange={(e) => setKeyword(e.target.value)}
							placeholder="搜索名称、描述或 slug"
							aria-label="搜索 Agent"
							data-testid="plaza-search"
							className="min-h-11 w-full min-w-0 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] py-2 pl-10 pr-3 text-[length:var(--kit-text-heading)] placeholder:text-[var(--kit-fg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] md:text-[length:var(--kit-text-label)]"
						/>
					</div>
				</div>
				{leading}
				<div ref={tabsRef} data-testid="plaza-tabs" className="mt-6 min-w-0">
					<CategoryTabs categories={view?.categories ?? []} active={tab} onChange={setTab} />
				</div>
				<PlazaResults
					view={view}
					loading={loading}
					error={error}
					reload={reload}
					tab={tab}
					searching={q.length > 0}
					onOpen={(slug) => navigate({ view: "chat", agent: slug })}
				/>
			</div>
		</div>
	);
}
