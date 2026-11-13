"use client";

import { useState } from "react";
import { Check, Copy } from "./icons.tsx";

export interface TerminalLine {
	/** 命令行原文（参与复制） */
	cmd: string;
	/** 行尾注释（不参与复制） */
	comment?: string;
}

/**
 * 落地页终端卡：mac 窗口点 + 一键复制全部命令。
 * 复制反馈走 aria-live（屏幕阅读器可感知），1.6s 后回落。
 */
export function TerminalCard({ title, lines }: { title: string; lines: TerminalLine[] }) {
	const [copied, setCopied] = useState(false);

	const copyAll = async () => {
		try {
			await navigator.clipboard.writeText(lines.map((l) => l.cmd).join("\n"));
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		} catch {
			setCopied(false);
		}
	};

	return (
		<div className="kit-terminal">
			<div className="kit-terminal-bar">
				<span className="kit-terminal-dot" aria-hidden="true" />
				<span className="kit-terminal-dot" aria-hidden="true" />
				<span className="kit-terminal-dot" aria-hidden="true" />
				<span className="kit-terminal-title">{title}</span>
				<button
					type="button"
					className="kit-terminal-copy"
					data-copied={copied || undefined}
					onClick={() => void copyAll()}
				>
					{copied ? <Check /> : <Copy />}
					<span aria-live="polite">{copied ? "已复制" : "复制"}</span>
				</button>
			</div>
			<pre className="kit-terminal-body">
				{lines.map((line) => (
					<div key={line.cmd}>
						<span className="p">$ </span>
						<span className="k">{line.cmd.split(" ")[0]}</span>
						<span>{line.cmd.slice(line.cmd.split(" ")[0].length)}</span>
						{line.comment ? <span className="c"> # {line.comment}</span> : null}
					</div>
				))}
			</pre>
		</div>
	);
}
