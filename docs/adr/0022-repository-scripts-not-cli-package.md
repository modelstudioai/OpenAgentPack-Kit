# ADR-0022：仓库命令归入 scripts，不再维护独立 CLI 包

> `pnpm mobile:pack` 已由 [ADR-0024](./0024-desktop-app-and-remove-mobile-ci-templates.md) 删除；
> 桌面打包链路也已于 2026-11-13 移除。其余仓库脚本与脚手架的归属决策仍然有效。

## 背景

`packages/cli` 同时承载两类命令：

1. 仓库内开发与发布流程：`dev`、`build`、`project`、`catalog list`、`mobile pack`、`eval`；
2. copy-in 与脚手架入口：`create`、`add`。

第一类命令大多只是调用根脚本或另一个包，第二类命令当前也直接读取 kit 仓库的
`templates/` 与 `packages/elements/`，依赖 `REPO_ROOT`，并不是可独立安装的 CLI。
把它保留为独立 workspace 包，会增加构建、类型检查、测试和发布面，却没有形成真实的分发边界。

## 决策

1. 删除 `@openagentpack/kit-cli` workspace 包；不再提供独立 `agents-kit` bin。
2. 仓库内命令放入 `scripts/kit/`，由根 `package.json` 提供：
   - `pnpm kit:create <dir> [--kit <repo>]`
   - `pnpm kit:add <component> [--dir <project>]`
   - `pnpm catalog:list`
   - `pnpm mobile:pack [--skip-build]`
3. `dev`、`build` 继续使用根 `pnpm dev` / `pnpm build`；Skill 评测使用 `pnpm eval`。
4. `kit:create` 生成的项目继续获得一个 `pnpm kit:add` 脚本，指向当前 kit 仓库的
   `scripts/kit/add-component.mjs`。这是 kit 包未发布期间的仓库内方案，不是对外的 npm CLI。
5. 若开源后仍需要 `npx`/全局安装的 copy-in CLI，应另立 ADR，并实现一个真正能从自身包资源
   解析模板与 registry 的可发布入口；不得恢复当前依赖 `REPO_ROOT` 的伪 CLI 包。

## 理由

- 当前实现没有外部安装能力，独立包边界没有带来发布价值。
- 大多数命令重复根脚本，增加入口反而造成文档、测试和维护分叉。
- 根 `scripts/` 已经承载 dev、release、desktop packaging 等同类仓库编排，集中后语义一致。
- copy-in 的 registry 闭包测试仍保留，只是从包内 vitest 迁移到 `scripts/kit/copy-in.test.mjs`。

## 后果

- 文档中的 `agents-kit ...` 命令改为根 `pnpm ...` 命令；历史验收记录保持原文。
- `check:docs` 校验根 `package.json` 的脚本，并阻止活跃文档继续引用已移除的 `agents-kit` 或
  `packages/cli`。
- `pnpm build`、`pnpm typecheck` 不再包含 CLI 包任务；`pnpm test:scripts` 增加 `scripts/kit/` 测试。
- 对外发布 CLI 的能力被明确推迟，不能再用当前包名暗示已经可分发。

## 备选方案

- 保留薄 CLI 包，只保留 `create` / `add`：比当前好，但仍无法从 npm 安装后工作，需同时重做
  资源解析和发布流程，暂不采用。
- 把所有命令塞进一个 `scripts/cli.mjs`：减少文件，但仍需要维护子命令分发，且会把仓库编排与
  copy-in 语义混在一个文件，不如按命令拆分。
- 不提供 copy-in 命令，只发源码：会破坏既有 copy-in 文档体验，因此保留仓库内脚本作为过渡。
