# templates/web-experience — 脚手架模板

## 不变量

1. **模板必须可独立验收**：`pnpm kit:create` 产物要能 install → typecheck → build 通过；
   改模板后必须重跑该验收（见 `docs/validation.md`）。
2. **kit 包未发布期间经别名直连 kit dist**（`kit.repo.json` + vite alias + tsconfig paths 的 `__KIT__`
   占位由 CLI 替换）；开源发包后改为 npm 依赖并删除别名与 `kit.repo.json` 逻辑。
   `kit.repo.json` 缺失时（模板还在本仓内被 `pnpm build`）别名回落到 monorepo 根，
   否则模板自身构建会因为解析不到 `@openagentpack/kit-*` 直接失败。
3. **`src/styles.css` 里的 `@source` 是模板能出样式的前提**：仓内用相对路径扫
   `packages/chat-ui/src`；`pnpm kit:create` 会额外追加一行指向 kit 仓库的**绝对路径**
   `@source`（`cmdCreate` → `appendElementsSource`），因为生成项目里的 kit 在仓库外，
   Tailwind 默认扫不到。改模板样式或 CLI 生成逻辑后，必须重跑「create → install → build →
   grep 产物 CSS」这条验收。
4. **保持最小**：模板展示推荐用法（KitProvider + hooks + chat-ui），不堆特性；
   新能力先进 `apps/web` 验证，再下沉到模板。
5. **宿主能力本地化**：壳注入只在 `src/lib/host.ts` 读取，浏览器下载作为 fallback；
   不重新引入独立宿主桥包，也不把 DOM/宿主能力放进 SDK。

## 强制它的闸门

- 手工验收：`pnpm kit:create /tmp/x --kit <repo> && cd /tmp/x && pnpm i && pnpm typecheck && pnpm build`，
  并检查产物 CSS 里确实生成了 chat-ui 的工具类（例如 `grep -c 'max-md' dist/assets/*.css` 应 ≥ 1）。
