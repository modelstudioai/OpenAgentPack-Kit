import type { TemplateUsageRow } from "@openagentpack/kit-sdk/protocol";
import { describe, expect, it } from "vitest";
import { aggregateTemplateRows } from "./template-usage-aggregate.ts";

function usageRow(
	templateId: string,
	metrics: Partial<TemplateUsageRow["metrics"]> = {},
	refreshedAt?: string,
): TemplateUsageRow {
	return {
		template_id: templateId,
		name: `模版${templateId}`,
		remote_agent_name: "智能体",
		remote_agent_id: `agent_${templateId}`,
		listing_status: "listed",
		session_count: 2,
		deleted_session_count: 1,
		metrics: {
			input_tokens: { value: null, covered_sessions: 0 },
			output_tokens: { value: null, covered_sessions: 0 },
			cache_read_input_tokens: { value: null, covered_sessions: 0 },
			cache_creation_input_tokens: { value: null, covered_sessions: 0 },
			active_seconds: { value: null, covered_sessions: 0 },
			duration_seconds: { value: null, covered_sessions: 0 },
			...metrics,
		},
		...(refreshedAt ? { refreshed_at: refreshedAt } : {}),
	};
}

describe("模版用量「全部」聚合", () => {
	it("数值列、会话数与覆盖会话数跨模版求和", () => {
		const aggregate = aggregateTemplateRows([
			usageRow("a", {
				input_tokens: { value: 100, covered_sessions: 2 },
				active_seconds: { value: 1.5, covered_sessions: 1 },
			}),
			usageRow("b", {
				input_tokens: { value: 23, covered_sessions: 1 },
				active_seconds: { value: 2, covered_sessions: 2 },
			}),
		]);
		expect(aggregate.name).toBe("全部模版");
		expect(aggregate.session_count).toBe(4);
		expect(aggregate.deleted_session_count).toBe(2);
		expect(aggregate.metrics.input_tokens).toEqual({ value: 123, covered_sessions: 3 });
		expect(aggregate.metrics.active_seconds).toEqual({ value: 3.5, covered_sessions: 3 });
	});

	it("缺失值不按 0 计算：只汇总已知值，全部缺失才保持待获取", () => {
		const aggregate = aggregateTemplateRows([
			usageRow("a", { output_tokens: { value: 50, covered_sessions: 2 } }),
			usageRow("b"),
		]);
		expect(aggregate.metrics.output_tokens).toEqual({ value: 50, covered_sessions: 2 });
		expect(aggregate.metrics.input_tokens).toEqual({ value: null, covered_sessions: 0 });
	});

	it("最近成功采集取各模版中最近一次，全部无采集记录时省略", () => {
		const aggregate = aggregateTemplateRows([
			usageRow("a", {}, "2026-11-01T08:00:00Z"),
			usageRow("b", {}, "2026-11-03T08:00:00Z"),
		]);
		expect(aggregate.refreshed_at).toBe("2026-11-03T08:00:00Z");
		expect(aggregateTemplateRows([usageRow("a")]).refreshed_at).toBeUndefined();
	});
});
