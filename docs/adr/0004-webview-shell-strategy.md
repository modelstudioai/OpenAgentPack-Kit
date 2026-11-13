# ADR-0004：桌面与移动壳复用同一份 Web 产物（RN 走 WebView + 离线包）

> 原生壳已退役：移动壳于 ADR-0024 移除，桌面壳于 2026-11-13 移除，见
> [ADR-0024 的状态更新](./0024-desktop-app-and-remove-mobile-ci-templates.md)。本文保留历史决策原文。

> 独立 `host-bridge` 包已由 [ADR-0019](./0019-remove-host-bridge-package.md) 取消；
> 自定义宿主仍可通过 `window.__OPENAGENTPACK_KIT_BRIDGE__` 注入能力，页面侧适配留在体验页本地。

> 命令载体已由 [ADR-0022](./0022-repository-scripts-not-cli-package.md) 调整为
> `pnpm mobile:pack`；本文保留当时的决策原文。

## 背景

需求包含四端：浏览器 Web、H5、本地桌面端、移动端（React Native）。为 RN 单独实现一套
原生 UI，意味着重写消息气泡、Markdown、代码高亮、工具卡、线程面板、Artifact 预览
（pdf/pptx/xlsx），成本极高且长期双份维护。

同时确认了两个技术事实：

- RN 原生 `fetch` **不支持流式响应体**（`response.body` 为 `null`），SSE 需要额外适配；
  而 WKWebView / Chrome WebView 内的 `fetch` + `ReadableStream` 是完整的。
- `expo-updates` / EAS Update 管的是 **RN 自身的 JS bundle**，与 WebView 里的 Web 产物
  无关，不能直接当离线包热更方案。

## 决策

1. **一份 Web 产物，三种壳**：`apps/web` 构建出纯静态 CSR 产物；浏览器直接用，Electron
   （M5）加载它，RN（M6）用 `react-native-webview` 加载它。
2. **RN 离线包用内嵌静态服务器**：`@dr.pogodin/react-native-static-server`
   （维护版；不用已停更的 `react-native-static-server@0.5`）把离线包 serve 到
   `http://127.0.0.1:<随机端口>`，而不是 `file://` 直载。
3. **离线包只随 App 发版**，v1 不做 OTA；`agents-kit mobile pack` 负责把 Web 产物打进
   App 资源目录。
4. **原生外壳承担原生职责**：导航/Tab、设置、推送、文件与分享、离线包管理；成员登录、
   Agent 广场与切换、对话与 Artifact 全在同一个 WebView（成员登录后的调整见下文）。
5. **运行时配置注入**：Web 产物不得假设同源或构建期写死后端地址；壳通过
   `window.__OPENAGENTPACK_KIT__` 注入 `apiBaseUrl`，浏览器兜底读 `GET /api/config`。

## 理由

- `127.0.0.1` 是 secure context：history 路由、Service Worker、IndexedDB、fetch/SSE 全部
  正常，与浏览器行为一致；`file://` 直载则要开
  `allowUniversalAccessFromFileURLs`、退化到 hash 路由、且无 Service Worker。
- 保留推送、离线、文件、分享等原生能力，可规避 App Store Guideline 4.2（最低功能要求）
  对「纯 WebView 套壳」的拒审风险。
- 桌面选 Electron + electron-vite：可复用 CloudAgentBot 的分层经验（main/preload/
  renderer、OS 安全存储、tray、自动更新、electron-builder），团队已有存量认知。

## 后果

- 需要维护壳注入协议与体验页本地宿主适配：文件选择/相机、下载、主题等能力缺失时降级。
- server 必须为 `http://127.0.0.1:*` 开 CORS 白名单（`KIT_CORS_ORIGINS`）。
- 移动端 UI 无法做到像素级原生（滚动惯性、键盘避让、手势返回需逐个调优）。
- Tauri 作为桌面备选被推迟：包体更小，但本地 Node server 需当 sidecar 管理，且团队无存量
  经验；若后续对包体敏感可再评估。

## 备选方案

- RN 原生 UI + 复用 headless hooks：体验最原生，但要重写全部富内容渲染，且 hooks 必须
  在 RN 侧解决流式传输问题，成本与风险都最高。
- 远端优先 + 本地兜底：UI 永远最新，但首屏依赖网络、离线体验不可预测。
- `file://` 直载离线包：依赖最少，但受同源与 API 限制（见上）。
## 实施记录（2026-10-15，M6 壳层落地）

决策本身不变，以下是落地时被迫修正的**技术细节**（都经本机实测，未上真机）：

1. **离线包载体：assets 目录 + Expo 配置插件，而不是内联 base64 到 JS。**
   原设想「`agents-kit mobile pack` 把产物打进 App 资源目录」在 Expo 下不能靠
   `assets/` 自动生效（Metro 只打包被 `require()` 引用的资源），而
   `@dr.pogodin/react-native-fs` 没有 `unzip`，于是先试了「base64 内联成生成文件」：
   可用，但产物是 4.3 MB 的 TS 文件、每次打包都变、没法进 git。
   最终改为 `plugins/withKitWebPack.js`（`withDangerousMod` + `withXcodeProject`）在
   prebuild 期把 `assets/kit-web/` 装进原生工程，JS bundle 保持 1.6 MB。
   离线包（516 KB，已排除 `.map`）留在 gitignore 的资源目录里，仍然「只随 App 发版」。
2. **版本必须按 Expo SDK 的 `bundledNativeModules.json` 对齐**：SDK 57 → RN `0.86.3`、
   react `19.2.3`、react-native-webview `13.16.1`。计划书里写的 webview 14 与 RN 最新
   （0.87.1）不可用：RN 0.87 移除了 `rn-get-polyfills`，而 `@expo/metro-config` 仍按路径
   `require` 它 → `expo export`/`expo start` 直接失败。
3. **两个上游坑（已在插件里绕开并注释）**：
   - SDK 57 的 xcodeproj mod 载荷在 `cfg.modResults`（就是 xcode 的 Project 实例），
     文档里常见的 `cfg.mod.project` 是 undefined；
   - `xcode@3.0.1` 的 `addResourceFile` → `correctForResourcesPath` 直接读
     `pbxGroupByName("Resources").path`，而 Expo 模板没有 Resources 组 → 抛
     `Cannot read properties of null (reading 'path')`；先 `addPbxGroup([], "Resources")` 即可。
   - iOS 的「复制文件」与「登记 pbxproj」必须在**同一个** mod 回调里做：两个 mod 的执行
     顺序不保证，先登记后复制会拿到不存在的路径。
4. **Android 与 iOS 取用离线包的方式不同**（`src/lib/pack-source.ts` 的唯一职责）：
   iOS 的 bundle 资源就是真实文件，`resolveAssetsPath("kit-web")` 可直接 serve；
   Android 的 assets 在 APK 内不是文件路径，必须按 `manifest.json` 的 `files` 清单逐个
   `copyFileAssets` 到可写目录（每版本一个子目录，避免半写状态被 serve）。
5. **CORS 需要 loopback 端口通配**：`KIT_CORS_ORIGINS` 支持 `http://127.0.0.1:*`
   （只对 loopback 生效，默认已含），否则随机端口的壳永远跨源失败。
6. **推送仍未接**（`expo-notifications` 未引入）：App Store Guideline 4.2 的「非纯套壳」
   论证目前靠离线包 + 文件/分享 + 原生导航三项；上架前需要重新评估这一条。

## 成员登录后的职责调整（2026-10-22）

ADR-0011 将数据面改为默认成员登录，原生匿名 Agent 列表不能继续读取 catalog。为避免维护
第二套登录与令牌桥，移动壳改为「体验 / 设置」两项导航，体验 WebView 复用现有登录、广场、
Agent 选择与对话。切换设置只隐藏 WebView，不卸载页面；更换后端地址或显式重载时重建。
成员令牌留在 WebView 内按 API 地址隔离的 sessionStorage，不发送给原生层。原生文件与分享、
离线包和设置能力保持原有边界。
