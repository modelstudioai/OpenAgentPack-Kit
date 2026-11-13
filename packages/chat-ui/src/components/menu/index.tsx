import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { type ComponentProps, forwardRef } from "react";

/** 命令菜单（Radix DropdownMenu 薄包装）：`Menu`/`MenuTrigger` 原样透传 Radix 能力
 * （方向键导航、Escape 关闭、焦点圈、`asChild`），`MenuContent` 定型弹层
 * （surface 底 + 边框 + `--kit-shadow` + `--kit-animate-overlay-in` 入场），`MenuItem`
 * 定型行高亮（hover 与键盘高亮走 Radix 的 `data-highlighted`）。弹层经 Portal 渲染到 body，
 * 位置避让与翻面由 Radix 处理（贴底触发器自动向上翻）。退出动画与 Tooltip 同策略不做
 * （入场即可），`prefers-reduced-motion` 下动效 token 自动降级为无动画。 */
export const Menu = DropdownMenu.Root;

export const MenuTrigger = DropdownMenu.Trigger;

export const MenuContent = forwardRef<HTMLDivElement, ComponentProps<typeof DropdownMenu.Content>>(function MenuContent(
	{ className, align = "start", sideOffset = 6, ...props },
	ref,
) {
	return (
		<DropdownMenu.Portal>
			<DropdownMenu.Content
				ref={ref}
				align={align}
				sideOffset={sideOffset}
				className={`z-[9999] min-w-36 overflow-hidden rounded-[var(--kit-radius-sm)] border border-[var(--kit-border)] bg-[var(--kit-surface)] p-1 text-[var(--kit-fg)] shadow-[var(--kit-shadow)] [animation:var(--kit-animate-overlay-in)] ${className ?? ""}`}
				{...props}
			/>
		</DropdownMenu.Portal>
	);
});

export const MenuItem = forwardRef<HTMLDivElement, ComponentProps<typeof DropdownMenu.Item>>(function MenuItem(
	{ className, ...props },
	ref,
) {
	return (
		<DropdownMenu.Item
			ref={ref}
			className={`flex min-h-9 w-full cursor-default select-none items-center gap-2 rounded-[calc(var(--kit-radius-sm)-4px)] px-2.5 py-1.5 text-start text-[length:var(--kit-text-label)] outline-none transition-colors duration-[var(--kit-duration-fast)] ease-[var(--kit-ease-out)] motion-reduce:transition-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-[var(--kit-bg-subtle)] ${className ?? ""}`}
			{...props}
		/>
	);
});
