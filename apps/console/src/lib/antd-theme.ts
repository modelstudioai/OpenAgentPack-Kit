import type { ThemeConfig } from "antd";

/**
 * console 唯一的 antd 主题归口（ADR-0015）。主题迁移自独立站&百炼的设计 token
 * （bailian-web `@ali/bfal-bailian-design-token`：#2564f8 主色 + #14151c 中性灰阶 +
 * #f2f2f4 布局底色），左侧导航、顶栏与全局控件视觉随之对齐。与 chat-ui theme.css
 * 的 `--kit-*` token 互不引用；如需定制只改这里，页面不得散落覆盖 antd 内部样式。
 *
 * 与上游 theme 的两处刻意差异：
 * - 不迁移上游显式锁定 antd 6.4 默认值的 shadow token 组（boxShadow、boxShadowDrawer*、
 *   dropShadowPopover、boxShadowCard 等），console 的 antd 6.6.8 保持官方默认阴影；
 *   上游有而 antd 6.6.8 类型不存在的个别 token（colorBorderHover、colorFillQuinary、
 *   Popover dropShadowPopover/boxShadowPopoverArrow）一并省略；
 * - Menu 组件 token 不取上游主站版（#f0f7ff 蓝字选中），按百炼 Sidebar 自绘 MenuItem
 *   规格定制：36px 高、全圆角胶囊、透明项底、选中浅灰底 #14151c0f + 加粗深字。
 * 另：上游 token 中 colorPurple/colorSlate 等非 antd 标准扩展色仅服务百炼业务标签，
 * console 无消费场景，不迁移。
 */

/** 浮层（毛玻璃面板）统一视觉参数，上游 floatingPanelStyle 原值。 */
const floatingPanelStyle = {
	background: "rgba(255, 255, 255, 0.9)",
	borderColor: "#e9e9ed",
	boxShadow: "0 4px 20px 0 rgba(0, 0, 0, 0.06)",
	backdropFilter: "blur(30px)",
} as const;

const floatingPanelBorderShadow = `inset 0 0 0 1px ${floatingPanelStyle.borderColor}`;

/** Select 与 Dropdown 列表型浮层的统一视觉参数，上游 selectionPopupStyle 原值。 */
const selectionPopupStyle = {
	background: floatingPanelStyle.background,
	borderColor: floatingPanelStyle.borderColor,
	borderRadius: 20,
	itemBorderRadius: 16,
	padding: 4,
	itemHeight: 32,
	itemGap: 4,
	itemPaddingBlock: 5,
	itemPaddingInline: 12,
	itemFontSize: 13,
	itemLineHeight: 20,
	itemHoverBg: "#14151c0a",
	itemSelectedBg: "#f0f7ff",
	itemSelectedColor: "#14151ccc",
	itemSelectedFontWeight: 600,
	boxShadow: `${floatingPanelBorderShadow}, ${floatingPanelStyle.boxShadow}`,
	backdropFilter: floatingPanelStyle.backdropFilter,
} as const;

export const antdTheme: ThemeConfig = {
	token: {
		// 保留 antd 默认的键盘焦点描边与输入框聚焦光环，便于识别当前操作位置。
		/** antd 组件默认（middle）尺寸高度，antd 默认 32 */
		controlHeight: 36,
		/** antd 组件 large 尺寸高度，antd 默认 40 */
		controlHeightLG: 40,
		colorPrimary: "#2564f8",
		colorPrimaryText: "#2564f8",
		colorPrimaryBg: "#f0f7ff",
		colorInfo: "#2564f8",
		colorPrimaryBgHover: "#e3efff",
		colorPrimaryBorder: "#a1c6ff",
		colorTextBase: "#14151c",
		colorText: "rgba(20, 21, 28, 0.90)",
		colorTextHeading: "rgba(20, 21, 28, 0.80)",
		colorTextSecondary: "#14151c99",
		colorTextTertiary: "#14151c66",
		colorTextQuaternary: "#14151c3d",
		colorBorderSecondary: "#f2f2f4",
		colorBorder: "#e9e9ed",
		colorFill: "#14151c1f",
		colorFillSecondary: "#14151c14",
		colorFillTertiary: "#14151c0f",
		colorFillQuaternary: "#14151c0a",
		colorBgBase: "#ffffff",
		colorBgLayout: "#f2f2f4",
		colorBgMask: "#0000004d",
		colorLinkHover: "#78A9FF",
	},
	components: {
		Button: {
			borderRadius: 99,
			borderRadiusSM: 99,
			borderRadiusLG: 99,
			colorPrimary: "#000000",
			colorPrimaryActive: "#1547d1",
			colorPrimaryHover: "#2564f8",
			colorBgSolidActive: "#1547d1",
			colorBgSolidHover: "#2564f8",
			primaryShadow: "none",
			colorErrorBg: "#fff1f0",
			colorErrorActive: "#cf1322",
			dangerShadow: "none",
			colorErrorBgFilledHover: "#ffccc7",
			dashedBgDisabled: "#14151c0a",
			defaultActiveBorderColor: "#1547d1",
			defaultActiveColor: "#1547d1",
			defaultBgDisabled: "#14151c0a",
			defaultBorderColor: "#e9e9ed",
			defaultColor: "#14151ccc",
			defaultShadow: "none",
			defaultHoverBorderColor: "#4f8aff",
			defaultHoverColor: "#4f8aff",
			textHoverBg: "#14151c0f",
			textTextActiveColor: "#14151ccc",
			textTextColor: "#14151ccc",
			textTextHoverColor: "#14151ccc",
			paddingInlineLG: 19,
		},
		Divider: {
			colorSplit: "#f2f2f4",
		},
		Layout: {
			bodyBg: "#f2f2f4",
			footerBg: "#f2f2f4",
			headerColor: "#14151ccc",
			lightTriggerColor: "#14151ccc",
			/** 顶栏对齐百炼 TopNav：白色通栏、恒 72px 高，内边距交给页面 Tailwind 控制 */
			headerBg: "#ffffff",
			headerHeight: 72,
			headerPadding: 0,
			siderBg: "#ffffff",
		},
		Anchor: {
			colorSplit: "#f2f2f4",
		},
		Breadcrumb: {
			itemColor: "#14151c66",
			lastItemColor: "#14151ccc",
			linkColor: "#14151c66",
			linkHoverColor: "#14151ccc",
			separatorColor: "#14151c66",
		},
		Dropdown: {
			colorBgElevated: selectionPopupStyle.background,
			colorSplit: "#f2f2f4",
			boxShadowSecondary: selectionPopupStyle.boxShadow,
			borderRadiusLG: selectionPopupStyle.borderRadius,
			borderRadiusSM: selectionPopupStyle.itemBorderRadius,
			paddingXXS: selectionPopupStyle.padding,
			paddingBlock: selectionPopupStyle.itemPaddingBlock,
			controlPaddingHorizontal: selectionPopupStyle.itemPaddingInline,
			fontSize: selectionPopupStyle.itemFontSize,
			lineHeight: selectionPopupStyle.itemLineHeight / selectionPopupStyle.itemFontSize,
			colorText: selectionPopupStyle.itemSelectedColor,
			colorPrimary: selectionPopupStyle.itemSelectedColor,
			controlItemBgHover: selectionPopupStyle.itemHoverBg,
			controlItemBgActive: selectionPopupStyle.itemSelectedBg,
			controlItemBgActiveHover: selectionPopupStyle.itemHoverBg,
		},
		/* 侧栏菜单已改为自绘结构（console-layout.module.less 的 .menu/.navItem 族，规格 1:1 复刻
		   百炼 Sidebar），不再消费 antd Menu；Menu token 段随之移除。 */
		Pagination: {
			itemActiveBgDisabled: "#14151c1f",
			itemActiveColorDisabled: "#14151c3d",
			itemActiveColor: "#2564f8",
			itemActiveColorHover: "#4f8aff",
			controlOutline: "#0593ff1a",
		},
		Steps: {
			navArrowColor: "#14151c3d",
			colorSplit: "#f2f2f4",
		},
		Cascader: {
			optionSelectedBg: "#f0f7ff",
			optionSelectedColor: "#14151ccc",
			colorSplit: "#f2f2f4",
		},
		DatePicker: {
			activeBorderColor: "#2564f8",
			addonBg: "#14151c0a",
			cellActiveWithRangeBg: "#f0f7ff",
			cellBgDisabled: "#14151c0a",
			cellHoverBg: "#14151c0a",
			hoverBorderColor: "#d6d7dc",
			multipleItemBg: "#14151c14",
			multipleItemColorDisabled: "#14151c3d",
			multipleSelectorBgDisabled: "#14151c0a",
		},
		Form: {
			labelColor: "#14151ccc",
		},
		Input: {
			activeBorderColor: "#bdbfc7",
			hoverBorderColor: "#d6d7dc",
		},
		InputNumber: {
			activeBorderColor: "#bdbfc7",
			addonBg: "#14151c0a",
			handleHoverColor: "#2564f8",
			hoverBorderColor: "#d6d7dc",
		},
		Mentions: {
			hoverBorderColor: "#d6d7dc",
			activeBorderColor: "#d6d7dc",
		},
		Radio: {
			buttonCheckedBgDisabled: "#14151c1f",
			buttonCheckedColorDisabled: "#14151c3d",
			buttonColor: "#14151ccc",
			buttonSolidCheckedActiveBg: "#1547d1",
			buttonSolidCheckedBg: "#2564f8",
			buttonSolidCheckedHoverBg: "#4f8aff",
			dotColorDisabled: "#14151c3d",
		},
		Rate: {
			starBg: "#14151c14",
		},
		Select: {
			// 按 small / middle / large 的控件高度设置全圆角，避免多选换行后出现超大胶囊圆角
			borderRadius: 18,
			borderRadiusSM: selectionPopupStyle.itemBorderRadius,
			borderRadiusLG: selectionPopupStyle.borderRadius,
			colorBgElevated: selectionPopupStyle.background,
			boxShadowSecondary: selectionPopupStyle.boxShadow,
			activeBorderColor: "#bdbfc7",
			hoverBorderColor: "#d6d7dc",
			// 多选标签背景色
			multipleItemBg: "#14151c0f",
			// 多选标签高度
			multipleItemHeight: 28,
			multipleItemColorDisabled: "#14151c3d",
			multipleSelectorBgDisabled: "#14151c0a",
			// 下拉选项高度
			optionHeight: selectionPopupStyle.itemHeight,
			// 下拉选项字号
			optionFontSize: selectionPopupStyle.itemFontSize,
			// 下拉选项行高
			optionLineHeight: `${selectionPopupStyle.itemLineHeight}px`,
			// 下拉选项内边距
			optionPadding: `${selectionPopupStyle.itemPaddingBlock}px ${selectionPopupStyle.itemPaddingInline}px`,
			optionActiveBg: selectionPopupStyle.itemHoverBg,
			optionSelectedBg: selectionPopupStyle.itemSelectedBg,
			optionSelectedColor: selectionPopupStyle.itemSelectedColor,
			optionSelectedFontWeight: selectionPopupStyle.itemSelectedFontWeight,
		},
		Slider: {
			dotActiveBorderColor: "#a1c6ff",
			dotBorderColor: "#f2f2f4",
			handleActiveColor: "#2564f8",
			handleActiveOutlineColor: "#e3efff",
			handleColor: "#a1c6ff",
			railBg: "#14151c0a",
			railHoverBg: "#14151c14",
			trackHoverBg: "#78a9ff",
		},
		TreeSelect: {
			nodeHoverBg: "#14151c0a",
			nodeHoverColor: "#14151ccc",
			nodeSelectedBg: "#f0f7ff",
		},
		Upload: {
			actionsColor: "#14151c66",
		},
		Calendar: {
			itemActiveBg: "#f0f7ff",
		},
		Card: {
			extraColor: "#14151ccc",
		},
		Collapse: {
			headerBg: "#14151c0a",
		},
		Descriptions: {
			contentColor: "#14151ccc",
			extraColor: "#14151ccc",
			labelBg: "#14151c0a",
			labelColor: "#14151c66",
			titleColor: "#14151ccc",
		},
		Segmented: {
			// 轨道圆角（全胶囊），覆盖 default / large / small 三种尺寸
			borderRadius: 100,
			borderRadiusLG: 100,
			borderRadiusSM: 100,
			// 选中项 / thumb 圆角（全胶囊），覆盖 default / large / small 三种尺寸
			borderRadiusXS: 100,
			itemActiveBg: "#14151c1f",
			itemColor: "#14151c99",
			itemHoverBg: "#14151c14",
			itemHoverColor: "#14151c",
			itemSelectedColor: "#14151ccc",
			trackBg: "#f2f2f4",
		},
		Table: {
			borderColor: "#f2f2f4",
			footerColor: "#14151ccc",
			headerColor: "#14151ccc",
			headerFilterHoverBg: "#14151c14",
			rowExpandedBg: "#14151c0a",
			stickyScrollBarBg: "#14151c3d",
			headerBg: "#fafafa",
			rowHoverBg: "#f0f7ff",
			/* 列表单元格 padding 16（对齐百炼 td.bailian-web-table-cell 实测），三种尺寸统一；
			   行高 60 由 styles.css 的 td height 补足（Table token 无行高） */
			cellPaddingBlock: 16,
			cellPaddingInline: 16,
			cellPaddingBlockMD: 16,
			cellPaddingInlineMD: 16,
			cellPaddingBlockSM: 16,
			cellPaddingInlineSM: 16,
		},
		Tabs: {
			cardBg: "#14151c0a",
			inkBarColor: "#2564f8",
			itemActiveColor: "#1547d1",
			itemColor: "#14151ccc",
			itemHoverColor: "#4f8aff",
			itemSelectedColor: "#2564f8",
		},
		Tag: {
			defaultColor: "#14151ccc",
		},
		Timeline: {
			tailColor: "#f2f2f4",
		},
		Tree: {
			directoryNodeSelectedBg: "#2564f8",
			nodeHoverBg: "#14151c0a",
			nodeHoverColor: "#14151ccc",
			nodeSelectedColor: "#14151ccc",
			nodeSelectedBg: "#f0f7ff",
		},
		Drawer: {
			colorBgMask: "#14151c4d",
		},
		Modal: {
			titleColor: "#14151ccc",
			colorBgMask: "#14151c4d",
			borderRadiusLG: 24,
			// 关闭按钮圆角（全圆形），antd Modal 仅在 close 按钮上消费 borderRadiusSM
			borderRadiusSM: 100,
		},
		Popover: {
			// 浮层圆角，v5/v6 均消费 borderRadiusLG
			borderRadiusLG: 12,
			// 90% 不透明纯白背景，箭头背景同步继承该颜色
			colorBgElevated: floatingPanelStyle.background,
			// 对齐 site-bailian 左下角切换浮层：1px 内描边 + 柔和投影
			boxShadowSecondary: `${floatingPanelBorderShadow}, ${floatingPanelStyle.boxShadow}`,
		},
		Progress: {
			defaultColor: "#000000",
			circleTextColor: "#14151ccc",
			remainingColor: "#14151c0a",
		},
		Skeleton: {
			gradientFromColor: "#14151c0a",
			gradientToColor: "#14151c1f",
		},
		Spin: {
			colorBgMask: "#14151c4d",
		},
		Notification: {
			// Figma Ant Design System v6 / Notification：360px 卡片、20px 纵向与 24px 横向内边距
			width: 360,
			paddingMD: 20,
			paddingContentHorizontalLG: 24,
			borderRadiusLG: 12,
			colorError: "#ff4d4f",
			colorErrorBg: "#ffffff",
			// 图标与内容间距、标题与描述间距
			marginSM: 16,
			marginXS: 8,
			// 标题 16/24，描述 14/22
			fontSizeLG: 16,
			lineHeightLG: 1.5,
			fontSize: 14,
			lineHeight: 22 / 14,
		},
		Message: {
			contentBg: "#ffffff",
			contentPadding: "11px 12px",
			// 卡片圆角，v5/v6 均消费
			borderRadiusLG: 12,
			// 卡片阴影
			boxShadow: "0px 2px 20px -4px rgba(0, 0, 0, 0.1)",
			// 图标-文字间距（v5 marginInlineEnd / v6 gap）
			marginXS: 12,
		},
	},
};
