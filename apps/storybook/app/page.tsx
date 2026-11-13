import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { CountUp } from "../components/count-up.tsx";
import { GlowCard } from "../components/glow-card.tsx";
import { HeroBackground } from "../components/hero-background.tsx";
import { HeroShowcase } from "../components/hero-showcase.tsx";
import {
	ArrowRight,
	ArrowUpRight,
	Boxes,
	Braces,
	GitBranch,
	Globe,
	Layers,
	LogoMark,
	MessageSquare,
	MonitorSmartphone,
	Puzzle,
	Server,
	ShieldCheck,
	Smartphone,
	Sparkles,
	Zap,
} from "../components/icons.tsx";
import { Marquee } from "../components/marquee.tsx";
import { Reveal } from "../components/reveal.tsx";
import { RouteTheme } from "../components/route-theme.tsx";
import { ScrambleText } from "../components/scramble-text.tsx";
import { Showcase } from "../components/showcase.tsx";
import { SiteHeader } from "../components/site-header.tsx";

export const metadata: Metadata = {
	title: "OpenAgentPack Kit — 为百炼 Managed Agent 打造体验页的开发套件",
	description:
		"自研协议 + headless hooks + copy-in 组件 + 可部署 Node server + 管理端 IaC 闸门：几条命令搭出一个 managed-agent 体验页，支持浏览器与 H5。",
};

/** openapi 操作数在构建期读同步过来的 spec（prebuild 第一步），读不到时回落到保守值。 */
function apiOperationCount(): number {
	try {
		const spec = JSON.parse(readFileSync(join(process.cwd(), "openapi.json"), "utf8")) as {
			paths: Record<string, Record<string, unknown>>;
		};
		return Object.values(spec.paths).reduce((sum, methods) => sum + Object.keys(methods).length, 0);
	} catch {
		return 45;
	}
}

const FEATURES = [
	{
		icon: <Layers />,
		tone: "blue",
		title: "自研协议，事件契约与 SDK 同源",
		body: "SSE 帧、游标与重连、event_id 去重、乐观消息与 turn 边界由 kit-sdk 承担；事件模型直接复用 @openagentpack/sdk 的 SessionEvent，不私造第二套。",
		href: "/docs/sdk/client/#快照与游标",
	},
	{
		icon: <Puzzle />,
		tone: "cyan",
		title: "headless hooks + copy-in 组件",
		body: "useChat / useSessions / useAgentCatalog 管状态；kit-chat-ui 的组件源码可整份复制进你的项目自由修改（ADR-0005），样式只用 Tailwind + 冻结 token。",
		href: "/docs/components",
	},
	{
		icon: <Server />,
		tone: "violet",
		title: "可部署的 Node server",
		body: "Hono + node:sqlite：数据面 /api/kit/*、控制面 /api/admin/*；凭据不出服务端，事件不落库，openapi.json 与接口文档双向校验。",
		href: "/docs/server-api",
	},
	{
		icon: <ShieldCheck />,
		tone: "blue",
		title: "管理端与高风险闸门",
		body: "Project 声明 → plan（展示 diff）→ 一次性确认令牌 → apply / publish / 上下架；服务端拒绝无令牌的破坏性请求，CLI 也没有 --yes。",
		href: "/docs/server-api",
	},
	{
		icon: <MonitorSmartphone />,
		tone: "cyan",
		title: "多端复用一份 Web 产物",
		body: "浏览器与 H5 复用同一份体验页，按视口适配导航、对话布局与输入区。",
		href: "/docs/guides",
	},
	{
		icon: <GitBranch />,
		tone: "violet",
		title: "为 coding agent 而写的仓库",
		body: "AGENTS.md 权威顺序 + 执行红线 + 包级不变量；dependency-cruiser 与 check:docs 把约定变成门禁，别人用自己的 agent 也能安全接手。",
		href: "/docs/contributing",
	},
] as const;

const FLOW = [
	{ icon: <Braces />, name: "kit-sdk/protocol", desc: "事件契约 / SSE 帧 / 错误模型" },
	{ icon: <Zap />, name: "kit-sdk", desc: "去重 / 重连 / turn / artifact 归并" },
	{ icon: <MessageSquare />, name: "kit-sdk/chat/hooks", desc: "useChat 等 headless hooks" },
	{ icon: <Boxes />, name: "kit-chat-ui", desc: "copy-in 对话组件（Radix + Tailwind）" },
];

const DEVICES = [
	{ icon: <Globe />, name: "浏览器 Web", desc: "Vite 静态 CSR，断点自适应桌面与 H5" },
	{ icon: <Smartphone />, name: "H5", desc: "同一份组件：底部 composer + 安全区 + 手势" },
];

export default function Home() {
	const apiOps = apiOperationCount();
	const endpoints = [
		{
			method: "get",
			path: "/api/config",
			desc: "运行时公开配置（任何端不假设同源）",
			href: "/docs/api/meta/config/get",
		},
		{
			method: "post",
			path: "/api/kit/sessions",
			desc: "建会话（可挂文件，扫描就绪后才放行）",
			href: "/docs/api/kit/sessions/post",
		},
		{
			method: "post",
			path: "/api/kit/sessions/{sessionId}/messages",
			desc: "发消息，触发一轮 turn",
			href: "/docs/api/kit/sessions/sessionid/messages/post",
		},
		{
			method: "get",
			path: "/api/kit/sessions/{sessionId}/stream",
			desc: "SSE 事件流，?after= 断线续传",
			href: "/docs/api/kit/sessions/sessionid/stream/get",
		},
		{
			method: "post",
			path: "/api/admin/templates/{templateId}/listing/plan",
			desc: "破坏性动作：必须带一次性确认令牌",
			href: "/docs/api/admin/templates/templateid/listing/plan/post",
		},
	] as const;

	return (
		<main className="flex min-h-screen flex-col bg-fd-background text-fd-foreground">
			<RouteTheme theme="dark" />
			<SiteHeader />

			<section className="kit-hero">
				<HeroBackground />
				<div className="kit-hero-grid">
					<div>
						<span className="kit-badge">
							<b>New</b>
							开源 · 可自托管 · 对齐 ai-sdk.dev 的体验形态
							<ArrowRight />
						</span>
						<h1 className="kit-display">
							为百炼 Managed Agent
							<br />
							<ScrambleText className="kit-gradient-text" text="打造体验页的开发套件" />
						</h1>
						<p className="kit-hero-sub">
							自研协议 + headless hooks + copy-in 组件 + 可部署 Node server + 管理端。 用 OpenAgentPack 声明并管理
							Agent（plan → 确认 → apply → publish → 上架）， 前端拿到的是一个能流式对话、能渲染工具卡与
							Artifact、适配浏览器与 H5 的体验页。
						</p>
						<div className="mt-8 flex flex-wrap items-center gap-3">
							<Link href="/docs/quickstart" className="kit-btn" data-solid="true">
								开始使用
								<ArrowRight />
							</Link>
							<Link href="/docs/components" className="kit-btn">
								<Boxes />
								组件总览
							</Link>
							<Link href="/docs/server-api" className="kit-btn" data-ghost="true">
								<Braces />
								接口总览
							</Link>
						</div>
					</div>
					<HeroShowcase />
				</div>
			</section>

			<Marquee />

			<section className="kit-section" style={{ paddingTop: 40, paddingBottom: 24 }}>
				<div className="kit-stats">
					<div className="kit-stat">
						<b>
							<CountUp value={120} suffix="+" />
						</b>
						<span>单测（8 个包）</span>
					</div>
					<div className="kit-stat">
						<b>
							<CountUp value={14} />
						</b>
						<span>Playwright E2E</span>
					</div>
					<div className="kit-stat">
						<b>
							<CountUp value={apiOps} />
						</b>
						<span>openapi 操作（自动生成）</span>
					</div>
					<div className="kit-stat">
						<b>
							<CountUp value={2} />
						</b>
						<span>端：Web / H5</span>
					</div>
				</div>
			</section>

			<section className="kit-section">
				<Reveal>
					<div className="kit-section-head">
						<div>
							<span className="kit-eyebrow">
								<Layers />
								Architecture
							</span>
							<h2 className="kit-section-title">一条依赖方向，从契约到组件</h2>
							<p className="kit-section-sub">
								protocol ← sdk ← chat-ui 由 dependency-cruiser 强制；server 只依赖 protocol， 浏览器 bundle 里不会出现
								provider 凭据。
							</p>
						</div>
						<Link href="/docs/sdk/#四层组织" className="kit-btn" data-ghost="true">
							分层与接入
							<ArrowUpRight />
						</Link>
					</div>
					<div className="kit-flow">
						{FLOW.map((node, index) => (
							<div key={node.name} className="contents">
								{index > 0 ? (
									<span className="kit-flow-arrow" aria-hidden="true">
										<ArrowRight />
									</span>
								) : null}
								<GlowCard className="kit-flow-node">
									<b>
										{node.icon}
										{node.name}
									</b>
									<span>{node.desc}</span>
								</GlowCard>
							</div>
						))}
					</div>
				</Reveal>
			</section>

			<section className="kit-section" style={{ paddingTop: 0 }}>
				<Reveal>
					<div className="kit-section-head">
						<div>
							<span className="kit-eyebrow">
								<Sparkles />
								Why
							</span>
							<h2 className="kit-section-title">它解决什么</h2>
							<p className="kit-section-sub">从协议到上架目录的每一层，都有门禁与真实 Cloud 验证记录兜底。</p>
						</div>
					</div>
					<div className="kit-bento">
						{FEATURES.map((feature) => (
							<GlowCard key={feature.title} href={feature.href} className="kit-card no-underline">
								<span className="kit-chip" data-tone={feature.tone === "blue" ? undefined : feature.tone}>
									{feature.icon}
								</span>
								<h3>{feature.title}</h3>
								<p>{feature.body}</p>
								<span className="kit-card-go" aria-hidden="true">
									<ArrowUpRight />
								</span>
							</GlowCard>
						))}
					</div>
				</Reveal>
			</section>

			<section className="kit-section" style={{ paddingTop: 0 }}>
				<Reveal>
					<div className="kit-section-head">
						<div>
							<span className="kit-eyebrow">
								<Boxes />
								Live preview
							</span>
							<h2 className="kit-section-title">组件在线预览（真实组件，不是截图）</h2>
							<p className="kit-section-sub">
								文档站直接依赖 workspace 里的 kit-chat-ui：预览里长什么样，你的页面就长什么样。 可切桌面 /
								手机、展开源码、复制 copy-in 命令。
							</p>
						</div>
						<Link href="/docs/components" className="kit-btn" data-ghost="true">
							组件总览
							<ArrowUpRight />
						</Link>
					</div>
					<Showcase name="chat" />
				</Reveal>
			</section>

			<section className="kit-section" style={{ paddingTop: 0 }}>
				<Reveal>
					<div className="kit-section-head">
						<div>
							<span className="kit-eyebrow">
								<Braces />
								接口总览
							</span>
							<h2 className="kit-section-title">接口声明即文档</h2>
							<p className="kit-section-sub">
								由路由的 zod schema 生成 openapi.json，再生成站内接口页；手写文档里的链接被测试盯着，改路由不留死链。
							</p>
						</div>
						<Link href="/docs/server-api" className="kit-btn" data-ghost="true">
							{apiOps} 个操作
							<ArrowUpRight />
						</Link>
					</div>
					<div className="kit-endpoints">
						{endpoints.map((item) => (
							<Link key={item.path + item.method} className="kit-endpoint no-underline" href={item.href}>
								<span className="kit-method" data-method={item.method}>
									{item.method.toUpperCase()}
								</span>
								<code>{item.path}</code>
								<span>{item.desc}</span>
							</Link>
						))}
					</div>
				</Reveal>
			</section>

			<section className="kit-section" style={{ paddingTop: 0 }}>
				<Reveal>
					<div className="kit-section-head">
						<div>
							<span className="kit-eyebrow">
								<MonitorSmartphone />
								Everywhere
							</span>
							<h2 className="kit-section-title">一份 Web 产物，适配桌面与手机</h2>
							<p className="kit-section-sub">
								同一套对话与 Artifact 组件按视口调整布局，桌面浏览器与手机 H5 都能使用。
							</p>
						</div>
						<Link href="/docs/guides" className="kit-btn" data-ghost="true">
							接入指南
							<ArrowUpRight />
						</Link>
					</div>
					<div className="kit-devices">
						{DEVICES.map((device) => (
							<GlowCard key={device.name} className="kit-device">
								{device.icon}
								<b>{device.name}</b>
								<span>{device.desc}</span>
							</GlowCard>
						))}
					</div>
				</Reveal>
			</section>

			<footer className="kit-footer">
				<div className="kit-footer-grid">
					<div>
						<span className="kit-brand">
							<span className="kit-brand-mark">
								<LogoMark />
							</span>
							<span className="kit-brand-name">OpenAgentPack Kit</span>
						</span>
						<p className="mt-3 max-w-sm text-[13px] leading-relaxed" style={{ color: "var(--kd-muted)" }}>
							接手这个仓库请先读 <code>AGENTS.md</code>（权威顺序、执行红线、包级不变量），使用文档从「快速开始」进入。
						</p>
					</div>
					<div>
						<h4>文档</h4>
						<ul>
							<li>
								<Link href="/docs/quickstart">快速开始</Link>
							</li>
							<li>
								<Link href="/docs/concepts">核心功能</Link>
							</li>
							<li>
								<Link href="/docs/components">组件总览</Link>
							</li>
							<li>
								<Link href="/docs/server-api">接口总览</Link>
							</li>
						</ul>
					</div>
					<div>
						<h4>仓库</h4>
						<ul>
							<li>
								<a href="https://github.com/modelstudioai/OpenAgentPack-Kit">modelstudioai/OpenAgentPack-Kit</a>
							</li>
							<li>
								<Link href="/docs/contributing">参与开发</Link>
							</li>
						</ul>
					</div>
				</div>
				<div className="kit-footer-base">Apache-2.0 · 开源，可自托管</div>
			</footer>
		</main>
	);
}
