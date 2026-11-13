import type { HTMLAttributes, ReactNode } from "react";

export interface PromptsItemBase {
	key: string;
	icon?: ReactNode;
	label?: ReactNode;
	description?: ReactNode;
	disabled?: boolean;
}

export interface PromptsItem extends PromptsItemBase {
	/** 有子项时本项只作分组卡片，点击由子项触发 */
	children?: PromptsItemBase[];
}

export type PromptsSemantic = "root" | "title" | "list" | "item" | "itemContent" | "subList" | "subItem";

export interface PromptsProps extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "onClick"> {
	items?: PromptsItem[];
	title?: ReactNode;
	onItemClick?: (info: { data: PromptsItem }) => void;
	vertical?: boolean;
	wrap?: boolean;
	fadeIn?: boolean;
	fadeInLeft?: boolean;
	classNames?: Partial<Record<PromptsSemantic, string>>;
}

function cx(...names: Array<string | false | undefined>): string {
	return names.filter(Boolean).join(" ");
}

const ITEM =
	"flex min-h-10 min-w-0 max-w-full flex-none items-start gap-3 rounded-[var(--kit-radius)] text-left text-[length:var(--kit-text-label)] leading-6 text-[var(--kit-fg)] [overflow-wrap:anywhere]";
const CARD = "border border-[var(--kit-border-subtle)] bg-[var(--kit-surface)] px-4 py-3";
const INTERACTIVE =
	"cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--kit-focus)] disabled:cursor-not-allowed";
const DIMMED = "disabled:opacity-50";
const SUB_ITEM = "bg-[var(--kit-bg-subtle)] px-3 py-2 transition-colors enabled:hover:bg-[var(--kit-nav-active)]";
// 动态 class 必须字面出现在源码里 Tailwind 才会生成；超出部分沿用最后一档
const STAGGER = ["delay-0", "delay-75", "delay-150", "delay-225", "delay-300", "delay-375", "delay-450", "delay-525"];

function ItemBody({
	item,
	contentClassName,
	children,
}: {
	item: PromptsItemBase;
	contentClassName?: string;
	children?: ReactNode;
}) {
	return (
		<>
			{item.icon ? (
				<span aria-hidden className="flex h-5 shrink-0 items-center">
					{item.icon}
				</span>
			) : null}
			<span className={cx("flex min-w-0 flex-1 flex-col gap-1", contentClassName)}>
				{item.label ? <span className="font-medium leading-6">{item.label}</span> : null}
				{item.description ? (
					<span className="text-[length:var(--kit-text-caption)] leading-5 text-[var(--kit-fg-muted)]">
						{item.description}
					</span>
				) : null}
				{children}
			</span>
		</>
	);
}

/** 提示集：开场引导里的示例问题/快捷入口。数据来自调用方，点击只回调，不直接发送。 */
export function Prompts({
	items = [],
	title,
	onItemClick,
	vertical = false,
	wrap = false,
	fadeIn = false,
	fadeInLeft = false,
	className,
	classNames = {},
	...rest
}: PromptsProps) {
	if (items.length === 0) return null;
	const motion = fadeInLeft ? "starting:-translate-x-3 starting:opacity-0" : fadeIn ? "starting:opacity-0" : "";
	return (
		<div {...rest} className={cx("flex min-w-0 max-w-full flex-col gap-3", className, classNames.root)}>
			{title ? (
				<div className={cx("text-[length:var(--kit-text-base)] font-semibold text-[var(--kit-fg)]", classNames.title)}>
					{title}
				</div>
			) : null}
			<div
				className={cx(
					"flex min-w-0 gap-2",
					vertical ? "flex-col items-start" : wrap ? "flex-wrap" : "overflow-x-auto",
					classNames.list,
				)}
			>
				{items.map((item, index) => {
					// 渐入只过渡 opacity/translate：若连带背景色，错峰延迟会拖慢之后的 hover 反馈
					const transition = motion
						? cx(
								"transition-[opacity,translate] duration-300 ease-out motion-reduce:transition-none",
								motion,
								STAGGER[Math.min(index, STAGGER.length - 1)],
							)
						: "transition-colors";
					if (item.children?.length) {
						return (
							<div
								key={item.key}
								className={cx(
									ITEM,
									CARD,
									wrap && !vertical && "max-sm:w-full",
									transition,
									item.disabled && "cursor-not-allowed opacity-50",
									classNames.item,
								)}
							>
								<ItemBody item={item} contentClassName={classNames.itemContent}>
									<span className={cx("mt-2 flex flex-col gap-1.5", classNames.subList)}>
										{item.children.map((child) => (
											<button
												key={child.key}
												type="button"
												disabled={item.disabled || child.disabled}
												onClick={() => onItemClick?.({ data: child })}
												className={cx(
													ITEM,
													INTERACTIVE,
													SUB_ITEM,
													// 父卡片已整体变淡，子项不再叠加
													!item.disabled && DIMMED,
													classNames.subItem,
												)}
											>
												<ItemBody item={child} />
											</button>
										))}
									</span>
								</ItemBody>
							</div>
						);
					}
					return (
						<button
							key={item.key}
							type="button"
							disabled={item.disabled}
							onClick={() => onItemClick?.({ data: item })}
							className={cx(
								ITEM,
								CARD,
								wrap && !vertical && "max-sm:w-full",
								INTERACTIVE,
								DIMMED,
								transition,
								"enabled:hover:border-[var(--kit-border)] enabled:hover:bg-[var(--kit-bg-subtle)]",
								classNames.item,
							)}
						>
							<ItemBody item={item} contentClassName={classNames.itemContent} />
						</button>
					);
				})}
			</div>
		</div>
	);
}
