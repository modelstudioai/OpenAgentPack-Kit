# ADR-0027：Skill 改为源目录 + 生成物，不再作为 workspace 包

## 背景

`packages/skills` 同时承担两种职责：保存英文 Skill 内容，以及提供生成、校验和打包工具。
实际生成范围只包括 6 份 `references/api.md` / `references/examples.md`、文档站示例块和
`dist/*.tgz`；`SKILL.md`、catalog、行为说明、metadata 和 examples 仍由人工维护。

把它保留为 workspace 包会带来不必要的构建、类型检查、测试和 lockfile 入口，却没有形成
真实的分发边界。Skill 也不参与任何应用运行时，直接修改最终目录则容易与公开 API 漂移。

## 决策

1. 删除 `packages/skills` workspace 包。
2. 人工源内容放到 `scripts/skills/src/<name>/`：
   - `metadata.json`：name、description、displayName、shortDescription、defaultPrompt；
   - `skill.md`：`SKILL.md` 正文；
   - `catalog.json`：公开 API 到英文用途、文档和示例的映射；
   - `references/` 与 `examples/`：人工维护的行为说明与可编译示例。
3. 生成器放在 `scripts/skills/`，负责：
   - 生成 `assets/skills/<name>/SKILL.md`、`agents/openai.yaml`、API/示例参考；
   - 复制人工 references 与 examples；
   - 同步文档站 `skill-example` 代码块；
   - 校验英文内容、链接、API 覆盖、组件示例调用和漂移；
   - 生成确定性离线 tgz。
4. `assets/skills/<name>/` 作为生成物提交，便于直接浏览、复制和文档链接；
   `assets/skills/dist/` 不提交。
5. 根命令承载原包能力：
   - `pnpm gen:skills`
   - `pnpm check:skills`
   - `pnpm typecheck:skills`
   - `pnpm test:skills`
   - `pnpm pack:skills`

## 理由

- Skill 是公开 API 的派生产物，不是第二个运行时或发布包。
- 源与生成物分开后，最终目录可以独立复制，同时禁止手改生成内容。
- 生成器和测试仍在仓库内，可继续保护 API 覆盖、英文内容、链接、示例和离线包确定性。
- 不引入新的 workspace 包，减少 Turbo、pnpm 和文档站的依赖面。

## 后果

- 文档里的 `@openagentpack/kit-skills` 包名与 `packages/skills` 路径移除。
- `assets/skills/<name>/` 与 `scripts/skills/src/` 会有同名示例副本；前者由
  `pnpm gen:skills` 重建。
- `pnpm build` 不再包含 Skill 包任务；文档构建仍会通过 `pack.mjs --docs` 校验并准备下载资产。
- `pnpm typecheck` 追加 `pnpm typecheck:skills`，根 devDependencies 增加示例编译所需的
  React、类型与 esbuild。

## 备选方案

- 保留 `packages/skills`，只把脚本移出：能减少包职责，但仍保留一个没有发布价值的 workspace 包，未采用。
- 只生成 references，不生成最终目录：改动最小，但无法阻止最终 Skill 与源内容漂移，未采用。
- 将 `assets/skills/<name>/` 完全 gitignore：产物更纯粹，但失去仓库内直接浏览、复制和现有文档链接体验，未采用。
