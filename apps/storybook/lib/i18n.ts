/**
 * 文档站 UI 文案中文化。
 *
 * fumadocs-ui 的翻译键就是英文原文（见 node_modules/fumadocs-ui/dist/.translations/keys.js），
 * 通过 RootProvider 的 `i18n.translations` 覆盖；站点内容本身是中文（AGENTS.md 不变量 2），
 * 壳文案没理由留英文。新增壳文案时先查 keys.js 有没有对应键。
 */
export const zhCN: Record<string, string> = {
	"Search(search trigger)": "搜索",
	"Open Search(search trigger)(aria-label)": "打开搜索",
	"Search(search dialog)": "搜索文档、组件与接口",
	"Close Search(search dialog)(aria-label)": "关闭搜索",
	"No results found(search dialog)": "没有匹配结果",
	"On this page(table of contents)": "本页目录",
	"No Headings(table of contents)": "暂无标题",
	"Table of Contents(inline table of contents)": "目录",
	"Previous Page(pagination)": "上一页",
	"Next Page(pagination)": "下一页",
	"Last updated on(page footer)": "最后更新于",
	"Edit on GitHub(edit page)": "在 GitHub 上编辑此页",
	"Copy Text(code block)(aria-label)": "复制代码",
	"Copied Text(code block)(aria-label)": "已复制",
	"Copy Anchor Link(heading anchor)(aria-label)": "复制标题链接",
	"Copied Anchor Link(heading anchor)(aria-label)": "已复制标题链接",
	"Toggle Theme(theme switcher)(aria-label)": "切换主题",
	"Light(theme switcher)(aria-label)": "亮色",
	"Dark(theme switcher)(aria-label)": "暗色",
	"System(theme switcher)(aria-label)": "跟随系统",
	"Open Sidebar(sidebar)(aria-label)": "打开侧栏",
	"Close Sidebar(sidebar)(aria-label)": "关闭侧栏",
	"Collapse Sidebar(sidebar)(aria-label)": "折叠侧栏",
	"Hide Sidebar(sidebar)": "隐藏侧栏",
	"Show Sidebar(sidebar)": "显示侧栏",
	"Toggle Menu(mobile menu)(aria-label)": "切换菜单",
	"Page Not Found(404 page)": "页面不存在",
	"The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 page)":
		"你要找的页面可能已被移除、改名，或暂时不可用。",
	"Back to Home(404 page)": "回到首页",
	"Layout Tab(layout tab trigger)": "分区",
	"Parameters(type table)": "参数",
	"Returns(type table)": "返回值",
	"Prop(type table)": "属性",
	"Type(type table)": "类型",
	"Default(type table)": "默认值",
};
