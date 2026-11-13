# ADR-0024：desktop 归入 apps，移除移动壳与 CI 示例模板

> 状态更新（2026-11-13）：Electron 桌面壳及其开发、冒烟与打包链路也已移除。
> 当前应用为 server、web、console 与 docs；保留 Web / H5、`web-experience` 脚手架模板
> 和自定义宿主接入约定。下文保留此前目录迁移与移动壳退役的决策原文。

## 背景

`templates/` 原本混放了四种不同性质的内容：

- `templates/web-experience`：`pnpm kit:create` 的复制源模板；
- `templates/desktop`：可安装、可启动、可打包的 Electron 应用；
- `templates/mobile`：Expo prebuild + WebView 的 RN 移动壳；
- `templates/ci`：可拷贝到使用方 `.gitlab-ci.yml` 的 Skill 评测片段。

其中只有 `web-experience` 真正承担「模板」职责。`desktop` 有 appId、产品名、安装包与
独立的启动/冒烟命令，是 workspace 应用；`mobile` 长期未完成真机验收，且引入了整套 RN/
Expo 依赖；`ci` 只是一段流水线示例，不是项目模板，也不参与构建。

## 决策

1. 将 `templates/desktop` 移动到 `apps/desktop`，包名仍为 `desktop`；`pnpm dev ... desktop`、
   `pnpm --filter desktop ...` 与 `pnpm dist:desktop` 的调用方式不变。
2. 删除 `templates/mobile`、`scripts/kit/mobile-pack.mjs`、`apps/web/e2e/mobile-shell.spec.ts`
   与 `apps/web/playwright.mobile-shell.config.ts`；根 `mobile:pack` 脚本一并移除。
3. 删除 `templates/ci/skill-eval.gitlab-ci.yml`。Skill 评测文档只保留 `run` / `gate`
   命令说明，具体 CI 配置由使用方按自己的流水线编写。
4. `templates/` 只保留 `web-experience`，语义收敛为「脚手架复制源」。
5. Playwright 的 `mobile` project 与 H5 响应式视口不是 RN 移动壳，继续保留。

## 理由

- `apps/` 表示可运行、可构建、可发布的入口；`templates/` 表示生成其他项目时复制的源文件。
  按运行形态归类后，desktop 不再需要从「模板」语义里例外解释。
- 移动壳没有形成可持续验收的真机链路，保留它需要维护 Expo、RN 与原生插件的版本矩阵，
  却无法证明真实设备可用；移除比继续维持「部分达成」更诚实。
- CI 片段只有一份 GitLab 示例，没有测试或发布消费者；文档里的两段命令已足够表达使用方法。
- 桌面壳仍需要 loopback CORS、宿主能力注入与 `apps/web` 静态产物；这些能力不随移动壳移除。

## 后果

- `templates/desktop` 与 `templates/mobile` 的历史文档、验收记录保留原文；活跃文档和路径引用
  改为 `apps/desktop` 或明确标注移动壳已移除。
- `pnpm mobile:pack` 是无兼容期的脚本删除；`CONTEXT.md` 的 Offline Pack 术语随移动壳一起删除。
- 桌面打包产物改为 `apps/desktop/release/`；`.gitignore`、biome override 与文档同步更新。
- `apps/server` 的 `http://127.0.0.1:*` CORS 通配只为桌面壳保留，安全边界不变。

## 备选方案

- 保留 `templates/mobile` 等待真机验收：需要继续承担 Expo/RN 依赖和原生工程维护，暂不采用。
- 把 `desktop` 继续留在 `templates/`：目录语义与「复制源」冲突，且会让 `templates/*` 的
  workspace 包同时承担两种角色，已否决。
- 把 CI 片段迁到 `examples/ci/`：能保留示例，但仓库还没有 `examples/` 目录体系，单文件示例
  不足以支撑新建顶层目录，已否决。
