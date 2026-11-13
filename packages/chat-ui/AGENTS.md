# packages/chat-ui — copy-in Chat 产品组件

## 不变量

1. **组件不 fetch、不依赖 server**：数据一律来自 SDK 各功能 `/hooks` hooks 的 props 注入。
2. **样式只用 Tailwind 工具类或 `theme.css` 冻结 token**（CSS 变量）；禁止新增颜色/间距/
   圆角/阴影常量，禁止手写 `.css`（`theme.css` 是唯一例外，放冻结 token 与动效基类）。
3. **可 copy-in**：每个组件文件自包含（仅依赖 registry.json 里声明的 deps），复制进用户
   项目后不依赖 monorepo 内部路径。
4. **破坏性操作 UI 必须 AlertDialog 语义**（见 `apps/console` 的确认弹窗）。
5. **新组件门槛**：至少一个真实调用方（apps/web、apps/console、templates）。
6. **不得嵌套交互元素**（`<button>` 内不能再有 `<button>`/`<a>`）：Chrome 对**真实点击**会把
   激活行为交给最外层的可激活元素，内层按钮的 `onClick` 永远不触发；而合成 `el.click()`
   却能触发——所以这类 bug 只有真实点击的 E2E（或真机）能抓到。行内多操作用
   「`div` 容器 + 并列 `button`」，不要用一个外层 button 包整行。
7. **消费方必须能扫到本包的工具类**：Tailwind v4 的自动源探测不扫 `node_modules`（workspace
   软链也算）与仓库外目录，因此每个消费方的 `styles.css` 必须显式
   `@source ".../packages/chat-ui/src/**/*.{ts,tsx}"`。缺失的表现是**静默无样式**
   （class 在 DOM 上、CSS 里查不到），验证方式：`grep -c 'max-md' apps/web/dist/assets/*.css`。
   只在 chat-ui 内部使用的断点类（如侧栏 `max-md:hidden`）尤其容易踩。
8. **图标字段既可能是图片地址也可能是 emoji**：`isIconImageSource()`（`agent-header/index.tsx`）是
   唯一判定入口——只有 `http(s):` / `data:` / `/` / `./` 开头才渲染 `<img>`，其余按文本
   渲染。把 emoji 塞进 `<img src>` 会得到一张裂图，且不会报错。
9. **`AgentHeader` 的标题可以是切换器**：传入 `agents` + `onPickAgent` 时标题渲染为
    `<select aria-label="切换 Agent">`，桌面壳与 H5 共用；不传时仍是纯文本标题。
    体验页当前不接切换器（切 Agent 走广场入口与 `?agent=` 深链）；切换器内部不得再嵌按钮
    （不变量 6）。
10. **自动滚底只滚列表容器，禁止 `scrollIntoView`**：`scrollIntoView` 会连带滚动所有可滚动
   祖先——落地页/文档页内嵌的 Chat 预览曾因此把**整个页面**拖到预览位置（用户看到「打开首页
   自动滚动」）。正确写法是对 `overflow-y-auto` 的列表容器设 `scrollTop = scrollHeight`
   （`components/message-list/index.tsx` 的 `MessageList`）。任何新组件需要「滚到某处」时同理：只操作自己的滚动容器。
   空列表的开场内容从顶部阅读，用户滚动后保留位置；出现首条消息时再恢复自动滚底。
11. **组件必须有过渡动效**：弹层、展开/收起、入场、悬停等状态变化不得生硬切换。动效 token
    （`--kit-duration-*`、`--kit-ease-out`、`--kit-animate-*`）与 details 高度过渡基类
    `.kit-collapse` 冻结在 `theme.css`；新动效先补 token 再消费，不就地写死时长/缓动，
    且必须随 `prefers-reduced-motion` 降级。

## 加一个新组件时

1. 在 `src/components/<component>/` 写 `index.tsx`、中文 `README.md` 与同目录测试；
   `process/` 下的组件同样各自建目录。复合组件的静态子组件与私有辅助逻辑留在所属目录，
   可独立使用的组件各自建目录；跨组件测试放 `tests/`；
2. 在 `registry.json` 登记 file/deps，保留组件目录层级；聚合入口只重导出，不承载组件实现；
3. 在 `apps/web` 或 `apps/console` 接入真实调用方；
4. 需要新 token 时先改 `theme.css` 并说明理由（不要就地写死）。

## 强制它的闸门

- dependency-cruiser `chat-ui-must-not-depend-on-server`；
- `pnpm --filter @openagentpack/kit-chat-ui typecheck`；
- `apps/web/e2e/fixtures.ts`：把 React 的「非法 HTML 嵌套」开发期警告升级成 E2E 失败（不变量 6）；
- `apps/web/e2e/experience.spec.ts` 的 H5 用例：断点类真的生成了（不变量 7）。
