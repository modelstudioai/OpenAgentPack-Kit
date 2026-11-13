# scripts/skills — Coding Agent Skill 源与生成器

这里维护三个面向 coding agent 的英文 Skill：`kit-components`、`use-kit-chat` 和
`kit-chat-provider`。Skill 不参与应用运行时，也不是 npm 包。

本文件面向人类读者；维护不变量见 [AGENTS.md](./AGENTS.md)。

## 源与生成物

只编辑 `src/`：

```text
scripts/skills/src/<name>/
  metadata.json   name、description、displayName、shortDescription、defaultPrompt
  skill.md        SKILL.md 正文
  catalog.json    公开 API 到英文用途、文档与示例的映射
  references/     人工维护的行为说明
  examples/       可编译的 TS/TSX 示例
```

不要手改 `assets/skills/<name>/`。它由 `pnpm gen:skills` 生成，包含：

```text
assets/skills/<name>/
  SKILL.md
  agents/openai.yaml
  references/api.md
  references/examples.md
  references/...   从 src 复制
  examples/        从 src 复制
```

`assets/skills/dist/` 是离线包产物，已 gitignore。

## 常用命令

```bash
pnpm gen:skills       # 生成 assets/skills、API 参考和文档示例
pnpm check:skills     # 只检查漂移，不写文件
pnpm typecheck:skills # 编译示例与公开 API fixture
pnpm test:skills      # 生成、链接、打包和浏览器依赖边界
pnpm pack:skills      # 生成 assets/skills/dist/*.tgz
```

文档站的 `skill-example` 代码块与 Skill 示例来自同一份源文件；改示例后必须重新生成。
发布或复制 Skill 时，使用 `assets/skills/<name>/` 或 `assets/skills/dist/<name>.tgz`。

## 新增或修改内容

- 新增公开组件、子组件或 SDK 入口时，先更新 `catalog.json`，再补示例并运行
  `pnpm gen:skills`。
- 修改行为说明时，编辑 `src/<name>/references/`；生成器只复制，不覆盖人工正文。
- 新增 Skill 时，在 `src/` 下建立完整目录并补齐 metadata、catalog、references 和 examples；
  生成器和文档站会按目录自动发现。
- API 签名、Props 和类型以公开 TypeScript 导出为准；英文用途与约束以 catalog 和
  references 为准，两者共同校验。

## 相关文档

- [维护规则](./AGENTS.md)
- [文档站 Skill 说明](../../apps/storybook/content/docs/skill/index.mdx)
- [安装与更新](../../apps/storybook/content/docs/skill/install.mdx)
- [目录与放置规则](../../docs/repository-layout.md)
