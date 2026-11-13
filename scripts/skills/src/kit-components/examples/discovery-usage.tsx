import { ActivityHeatmap, CategoryTabs, MeterBar, PlazaCard, type PlazaTabId } from "@openagentpack/kit-chat-ui";
import type { PlazaCategory, PlazaEntry } from "@openagentpack/kit-sdk/protocol";

export interface DiscoveryUsageProps {
	entries: PlazaEntry[];
	categories: { id: PlazaCategory; name: string; count: number }[];
	active: PlazaTabId;
	onCategoryChange: (next: PlazaTabId) => void;
	onOpen: (slug: string) => void;
	used: number;
	limit: number;
	unlimited: boolean;
	days: { day: string; turns: number }[];
}

// The caller obtains data from hooks and owns filtering, navigation, and quota policy.
export function DiscoveryUsage(props: DiscoveryUsageProps) {
	return (
		<section>
			<CategoryTabs categories={props.categories} active={props.active} onChange={props.onCategoryChange} />
			<div className="grid gap-4">
				{props.entries.map((entry) => (
					<PlazaCard key={entry.slug} entry={entry} onOpen={props.onOpen} />
				))}
			</div>
			<h2>Monthly usage</h2>
			<MeterBar value={props.used} max={props.limit} unlimited={props.unlimited} />
			<ActivityHeatmap days={props.days} />
		</section>
	);
}
