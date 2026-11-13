import type { ReactNode } from "react";

export interface FileCardProps {
	name: string;
	/** MIME 类型；省略时按文件扩展名展示图标。 */
	type?: string;
	/** 调用方提供的缩略图地址，组件不会自行读取文件。 */
	src?: string;
	description?: ReactNode;
	loading?: boolean;
	disabled?: boolean;
	onClick?: () => void;
	onDownload?: () => void;
	className?: string;
}

function cx(...values: Array<string | false | undefined>): string {
	return values.filter(Boolean).join(" ");
}

function fileIcon(name: string, type = ""): string {
	const extension = name.includes(".") ? (name.split(".").pop()?.toUpperCase() ?? "") : "";
	if (type.startsWith("image/") || ["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG"].includes(extension)) return "IMG";
	if (type.startsWith("audio/")) return "AUD";
	if (type.startsWith("video/")) return "VID";
	if (type === "application/pdf" || extension === "PDF") return "PDF";
	if (["ZIP", "GZ", "TAR", "RAR", "7Z"].includes(extension)) return "ZIP";
	if (["XLS", "XLSX", "CSV"].includes(extension)) return "XLS";
	return extension.slice(0, 4) || "FILE";
}

/** 已知 MIME 的友好叫法；未知类型不展示占位词，交给徽标表达。 */
function typeLabel(type = ""): string | undefined {
	if (!type) return undefined;
	if (type === "text/csv") return "表格";
	if (type.startsWith("image/")) return "图片";
	if (type.startsWith("audio/")) return "音频";
	if (type.startsWith("video/")) return "视频";
	if (type === "application/pdf") return "PDF";
	if (type.startsWith("text/")) return "文本";
	if (/^application\/(x-)?(zip|tar|gzip|rar|7z)/.test(type)) return "压缩包";
	if (
		type.startsWith("application/vnd.ms-excel") ||
		type.startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml")
	) {
		return "表格";
	}
	return undefined;
}

/** 徽标：有缩略图展示图片，否则按扩展名给字符徽标。 */
function FileBadge({ name, type, src }: { name: string; type?: string; src?: string }) {
	if (src) return <img src={src} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />;
	return (
		<span
			aria-hidden
			className="grid h-9 w-9 shrink-0 place-items-center rounded bg-[var(--kit-surface)] text-[9px] font-semibold text-[var(--kit-fg-muted)]"
		>
			{fileIcon(name, type)}
		</span>
	);
}

/** 通用文件展示；预览、下载及宿主桥由调用方注入，组件不请求文件。 */
export function FileCard({
	name,
	type,
	src,
	description,
	loading = false,
	disabled = false,
	onClick,
	onDownload,
	className,
}: FileCardProps) {
	const inactive = disabled || loading;
	const activate = onClick ?? onDownload;
	const secondLine = loading ? "加载中…" : description;
	const typeText = secondLine ? undefined : typeLabel(type);
	const actionClass =
		"shrink-0 rounded-[var(--kit-radius-sm)] p-1.5 text-[var(--kit-fg-muted)] transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed";
	return (
		<div
			aria-busy={loading || undefined}
			className={cx(
				"flex w-56 max-w-full shrink-0 items-center gap-2.5 rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-bg-subtle)] p-2",
				disabled && "opacity-50",
				className,
			)}
		>
			<FileBadge name={name} type={type} src={src} />
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex min-w-0 items-baseline gap-1.5">
					{activate ? (
						<button
							type="button"
							disabled={inactive}
							aria-label={`${onClick ? "打开" : "下载"} ${name}`}
							title={name}
							onClick={activate}
							className="min-w-0 truncate rounded-[var(--kit-radius-sm)] text-left text-[length:var(--kit-text-label)] text-[var(--kit-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kit-focus)] enabled:hover:underline disabled:cursor-not-allowed"
						>
							{name}
						</button>
					) : (
						<span className="min-w-0 truncate text-[length:var(--kit-text-label)] text-[var(--kit-fg)]" title={name}>
							{name}
						</span>
					)}
					{typeText ? (
						<span className="shrink-0 text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">
							{typeText}
						</span>
					) : null}
				</div>
				{secondLine ? (
					<div className="text-[length:var(--kit-text-caption)] text-[var(--kit-fg-muted)]">{secondLine}</div>
				) : null}
			</div>
			{onClick && onDownload ? (
				<button
					type="button"
					aria-label={`下载 ${name}`}
					disabled={inactive}
					onClick={onDownload}
					className={`${actionClass} enabled:hover:bg-[var(--kit-surface)] enabled:hover:text-[var(--kit-fg)]`}
				>
					<svg
						aria-hidden
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="h-4 w-4"
					>
						<path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14" />
					</svg>
				</button>
			) : null}
		</div>
	);
}
