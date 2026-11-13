# ADR-0019：取消独立 Host Bridge 包，宿主能力留在应用侧

> 原生桌面与移动壳已移除，见 [ADR-0024 的状态更新](./0024-desktop-app-and-remove-mobile-ci-templates.md)。
> 应用本地适配与注入约定继续服务浏览器和自定义宿主；下文的原生壳描述保留为历史背景。

## 背景

`@openagentpack/kit-host-bridge` 原本统一浏览器、Electron 与 RN WebView 的文件选择、
下载、分享、剪贴板与主题能力。但实际调用面很小：

- SDK React adapter 只为 `KitProvider` 提供一个默认 `bridge`，`bridge` prop 没有调用方；
- `useHostBridge()` 只有 `apps/web` 与 `templates/web-experience` 使用；
- Electron 与 RN 壳只依赖 `window.__OPENAGENTPACK_KIT_BRIDGE__` 注入约定，不 import 该包；
- `share`、`postToShell` 没有业务调用方，`kind` 只在测试中断言。

这与「SDK 只提供数据处理」的边界冲突。浏览器 DOM、剪贴板和宿主探测属于体验页运行环境，
不属于数据 SDK；为两三个真实调用维持独立包，也增加了构建、发布、文档与跨包兼容成本。

## 决策

1. 删除 `@openagentpack/kit-host-bridge` 包及其 workspace、依赖、alias、tsconfig path、
   lockfile 与文档条目。
2. 宿主能力收敛到体验页应用本地：
   - `apps/web/src/lib/host.ts` 提供完整的浏览器 fallback、壳注入读取与主题降级；
   - `templates/web-experience/src/lib/host.ts` 只保留模板真实需要的保存能力。
3. `KitProvider` 只提供稳定 `KitClient`。删除 `bridge` prop 和 `useHostBridge()`；
   需要宿主能力的应用在自己的 infrastructure 层实现，不进入 SDK。
4. 保留壳与页面之间的注入约定：
   - 运行时配置仍是 `window.__OPENAGENTPACK_KIT__`；
   - 宿主能力仍是 `window.__OPENAGENTPACK_KIT_BRIDGE__`。
   两个壳继续实现自己的协议和本地类型，不依赖页面包。
5. 只为真实调用保留能力。`share`、`postToShell` 等暂无调用方的方法不进入公共接口；
   未来出现实际消费方时，再由应用侧扩展注入约定。

## 理由

- 删除的是只有两个消费者、且两个壳都不依赖的包装包，不是跨端注入协议。
- 应用本地适配可以直接按真实能力裁剪，避免 SDK 暴露 DOM 与宿主 API。
- `KitProvider` 的职责更单一：数据 hooks 的 Client 上下文。
- 浏览器 fallback 与应用错误提示、下载交互属于同一层，放在应用内更容易测试和维护。

## 后果

- `KitProvider` 的 `bridge` prop 与 `useHostBridge()` 是无兼容期的公开 API 删除；仓库内调用方
  同步迁移，Skills API 与文档需要重新生成。
- Electron 在注入对象缺少 `copyText` 时，由体验页的浏览器 clipboard fallback 补齐；
  不再因为整体替换 bridge 而丢失剪贴板能力。
- 桌面与移动壳的注入对象可以继续携带尚未使用的扩展字段，但页面不会把它们当作公共合同。
- `apps/web` 与脚手架模板各保留一份很薄的宿主适配代码；目前只有两个真实消费者，暂不为
  少量重复重新建包。

## 备选方案

- 保留独立包：边界清楚，但包没有独立演进价值，且与 SDK 的数据职责冲突，已否决。
- 折叠进 `packages/sdk/adapters/react`：改动最小，但会让 SDK 继续承担 DOM 与宿主环境职责，
  已否决。
- 放进 `packages/elements`：组件库应保持视觉与交互职责，不应拥有文件选择和系统宿主能力，
  已否决。
