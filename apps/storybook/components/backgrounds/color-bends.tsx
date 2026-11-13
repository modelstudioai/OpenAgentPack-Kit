"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

/**
 * Color Bends 风格的 hero 背景（reactbits.dev/c/backgrounds/color-bends 的同概念自研实现）：
 * 近黑底上多条横向弯曲的丝绸光带（fbm 扰动中心线 + 高斯衰减 + 亮核）。
 *
 * 硬约束：
 * - **vanilla WebGL，零依赖**（不引 three/ogl；静态导出与离线可开不受影响）；
 * - WebGL 不可用时渲染 null，回落 `globals.css` 的 CSS 极光（hero 上不带 data-webgl）；
 * - prefers-reduced-motion：只画一帧静态图，不起 rAF；
 * - 离屏（IntersectionObserver）或 document.hidden 时暂停 rAF；
 * - devicePixelRatio 上限 1.5，frag 里只做 4 octave fbm ×3 条带，成本可控。
 * 变体（Nebula/Aurora/Ember/Ice）只换三条带的颜色 uniform，对应 reactbits 的变体行。
 */
const VARIANTS = {
	nebula: ["#7c3aed", "#c084fc", "#f0abfc"],
	aurora: ["#059669", "#34d399", "#67e8f9"],
	ember: ["#dc2626", "#f97316", "#fbbf24"],
	ice: ["#2563eb", "#38bdf8", "#e0f2fe"],
} as const;

type VariantName = keyof typeof VARIANTS;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uLight;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
		mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
		u.y
	);
}

float fbm(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		v += a * noise(p);
		p = p * 2.03 + vec2(11.3, 7.1);
		a *= 0.5;
	}
	return v;
}

float ribbon(vec2 uv, float base, float amp, float freq, float t, float thick) {
	float y = base + amp * (fbm(vec2(uv.x * freq + t * 0.06, t * 0.045)) - 0.5);
	float d = uv.y - y;
	return exp(-(d * d) / (thick * thick));
}

void main() {
	vec2 uv = gl_FragCoord.xy / uRes;
	float t = uTime;
	// 光带压在下半屏：hero 文案区（上半）保持干净，正文对比度不被光带吃掉
	float r0 = ribbon(uv, 0.40, 0.22, 2.1, t, 0.13);
	float r1 = ribbon(uv, 0.28, 0.26, 1.6, t * 1.27 + 31.7, 0.08);
	float r2 = ribbon(uv, 0.16, 0.20, 2.6, t * 0.83 + 77.3, 0.045);
	vec3 col = uC0 * r0 * 0.55 + uC1 * r1 * 0.50 + uC2 * r2 * 0.60;
	col += vec3(1.0) * (pow(r2, 3.0) * 0.12 + pow(r1, 4.0) * 0.06);
	float mask = r0 + r1 + r2;
	float fade = smoothstep(0.0, 0.10, uv.y) * smoothstep(1.0, 0.62, uv.y);
	vec3 dark = vec3(0.016, 0.020, 0.035);
	vec3 light = vec3(0.965, 0.970, 0.992);
	vec3 bg = mix(dark, light, uLight);
	vec3 outc;
	if (uLight > 0.5) {
		vec3 tint = col / max(mask, 0.0001);
		outc = mix(bg, tint * 0.75 + 0.25, clamp(mask, 0.0, 1.0) * 0.22 * fade);
	} else {
		outc = bg + col * fade * 0.95;
	}
	gl_FragColor = vec4(outc, 1.0);
}
`;

const VERT = `
attribute vec2 aPos;
void main() {
	gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

function hexToRgb(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function ColorBends({ variant }: { variant: VariantName }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const variantRef = useRef(variant);
	variantRef.current = variant;
	const { resolvedTheme } = useTheme();
	const lightRef = useRef(resolvedTheme === "dark" ? 0 : 1);
	lightRef.current = resolvedTheme === "dark" ? 0 : 1;
	const [supported, setSupported] = useState(true);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const gl = (canvas.getContext("webgl", { alpha: false, antialias: false }) ||
			canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
		if (!gl) {
			setSupported(false);
			return;
		}
		canvas.closest(".kit-hero")?.setAttribute("data-webgl", "true");

		const compile = (type: number, src: string) => {
			const sh = gl.createShader(type);
			if (!sh) return null;
			gl.shaderSource(sh, src);
			gl.compileShader(sh);
			if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
			return sh;
		};
		const vs = compile(gl.VERTEX_SHADER, VERT);
		const fs = compile(gl.FRAGMENT_SHADER, FRAG);
		const prog = gl.createProgram();
		if (!vs || !fs || !prog) {
			setSupported(false);
			return;
		}
		gl.attachShader(prog, vs);
		gl.attachShader(prog, fs);
		gl.linkProgram(prog);
		if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
			setSupported(false);
			return;
		}
		// biome-ignore lint/correctness/useHookAtTopLevel: WebGL  API，不是 React hook
		gl.useProgram(prog);

		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
		const loc = gl.getAttribLocation(prog, "aPos");
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

		const uRes = gl.getUniformLocation(prog, "uRes");
		const uTime = gl.getUniformLocation(prog, "uTime");
		const uLight = gl.getUniformLocation(prog, "uLight");
		const uCols = [0, 1, 2].map((i) => gl.getUniformLocation(prog, `uC${i}`));

		const resize = () => {
			const dpr = Math.min(1.5, window.devicePixelRatio || 1);
			const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
			const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
			}
			gl.viewport(0, 0, w, h);
			gl.uniform2f(uRes, w, h);
		};

		const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
		let raf = 0;
		let running = false;
		let visible = true;
		const start = performance.now();

		const draw = (now: number) => {
			resize();
			const colors = VARIANTS[variantRef.current];
			colors.forEach((hex, i) => {
				const [r, g, b] = hexToRgb(hex);
				gl.uniform3f(uCols[i], r, g, b);
			});
			gl.uniform1f(uLight, lightRef.current);
			gl.uniform1f(uTime, reduced ? 13.7 : (now - start) / 1000);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		};

		const loop = (now: number) => {
			draw(now);
			raf = requestAnimationFrame(loop);
		};
		const maybeRun = () => {
			const should = visible && !document.hidden && !reduced;
			if (should && !running) {
				running = true;
				raf = requestAnimationFrame(loop);
			} else if (!should && running) {
				running = false;
				cancelAnimationFrame(raf);
			}
		};

		draw(start);
		maybeRun();

		const ro = new ResizeObserver(() => draw(performance.now()));
		ro.observe(canvas);
		const io = new IntersectionObserver((entries) => {
			visible = entries.some((e) => e.isIntersecting);
			if (visible) draw(performance.now());
			maybeRun();
		});
		io.observe(canvas);
		const onVis = () => {
			if (!document.hidden) draw(performance.now());
			maybeRun();
		};
		document.addEventListener("visibilitychange", onVis);
		const onRedrawWin = () => draw(performance.now());
		window.addEventListener("kit-bg-redraw", onRedrawWin);
		// 暂停态（离屏 / reduced-motion）下变体或主题变化也要立即重画一帧
		const onRedraw = () => draw(performance.now());
		canvas.addEventListener("kit-redraw", onRedraw);
		// 主题/变体变化时立即重画一帧（循环跑着时下一帧自然带上）
		const mo = new MutationObserver(() => draw(performance.now()));
		mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			io.disconnect();
			mo.disconnect();
			document.removeEventListener("visibilitychange", onVis);
			canvas.removeEventListener("kit-redraw", onRedraw);
			window.removeEventListener("kit-bg-redraw", onRedrawWin);
			canvas.closest(".kit-hero")?.removeAttribute("data-webgl");
		};
	}, []);

	if (!supported) return null;
	return (
		<div className="kit-hero-bg" aria-hidden="true">
			<canvas ref={canvasRef} className="kit-hero-bg-canvas" />
		</div>
	);
}

export function ColorBendsChips({ value, onChange }: { value: VariantName; onChange: (v: VariantName) => void }) {
	return (
		<div className="kit-hero-bg-chips">
			<span className="kit-hero-bg-chips-label">bg</span>
			<span className="kit-seg">
				{(Object.keys(VARIANTS) as VariantName[]).map((name) => (
					<button
						key={name}
						type="button"
						data-active={value === name || undefined}
						aria-pressed={value === name}
						onClick={() => onChange(name)}
					>
						{name}
					</button>
				))}
			</span>
		</div>
	);
}

/** 变体/主题变化时通知暂停态的 shader 立即重画一帧。 */
export function requestBgRedraw() {
	window.dispatchEvent(new Event("kit-bg-redraw"));
}

export type { VariantName };
