/**
 * 进程内指标（Prometheus 文本格式）。
 * 只统计**运营需要的粗粒度**信号：请求量/错误量/限流命中、SSE 活跃流、事件缓冲规模、会话与上传计数。
 * 不变量：指标里不得出现令牌、事件正文、文件内容或用户输入（label 只用路由模板与状态码）。
 */
export interface Metrics {
	count(name: string, labels?: Record<string, string | number>, by?: number): void;
	gauge(name: string, value: number, labels?: Record<string, string | number>): void;
	render(): string;
	snapshot(): Record<string, number>;
}

const HELP: Record<string, string> = {
	kit_http_requests_total: "HTTP 请求数（按路由模板/方法/状态码）",
	kit_http_request_errors_total: "5xx 与 4xx 请求数",
	kit_rate_limited_total: "被限流拒绝的请求数",
	kit_sse_streams_active: "当前活跃的 SSE 流",
	kit_event_buffer_sessions: "事件缓冲里的会话数",
	kit_sessions_created_total: "创建的会话数",
	kit_uploads_total: "附件上传次数",
	kit_admin_writes_total: "管理端写操作次数（按角色）",
};

function key(name: string, labels?: Record<string, string | number>): string {
	const entries = Object.entries(labels ?? {}).sort(([a], [b]) => a.localeCompare(b));
	return entries.length ? `${name}{${entries.map(([k, v]) => `${k}="${v}"`).join(",")}}` : name;
}

export function createMetrics(): Metrics {
	const counters = new Map<string, number>();
	const gauges = new Map<string, number>();

	return {
		count(name, labels, by = 1) {
			const k = key(name, labels);
			counters.set(k, (counters.get(k) ?? 0) + by);
		},
		gauge(name, value, labels) {
			gauges.set(key(name, labels), value);
		},
		snapshot() {
			const out: Record<string, number> = {};
			for (const [k, v] of counters) out[k] = v;
			for (const [k, v] of gauges) out[k] = v;
			return out;
		},
		render() {
			const lines: string[] = [];
			const emit = (map: Map<string, number>, type: "counter" | "gauge") => {
				const byName = new Map<string, string[]>();
				for (const [k, v] of map) {
					const name = k.slice(0, k.indexOf("{") === -1 ? undefined : k.indexOf("{"));
					const bucket = byName.get(name) ?? [];
					bucket.push(`${k} ${v}`);
					byName.set(name, bucket);
				}
				for (const [name, samples] of byName) {
					lines.push(`# HELP ${name} ${HELP[name] ?? name}`, `# TYPE ${name} ${type}`, ...samples);
				}
			};
			emit(counters, "counter");
			emit(gauges, "gauge");
			return `${lines.join("\n")}\n`;
		},
	};
}
