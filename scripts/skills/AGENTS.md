# scripts/skills — 英文 Coding Agent Skills 源与生成器

这里交付 `kit-components`、`use-kit-chat`、`kit-chat-provider`，不参与产品运行时。
按用户明确要求，Skill 内的入口、引用、元数据与示例全部使用英文；维护文档与文档站介绍仍用中文。

## 源与产物

- `src/<name>/` 是唯一人工编辑入口：
  - `metadata.json`：name、description、displayName、shortDescription、defaultPrompt；
  - `skill.md`：`SKILL.md` 正文；
  - `catalog.json`：公开 API 到英文用途、中文权威文档与示例的映射；
  - `references/`：人工维护的行为说明；
  - `examples/`：可编译的 TS/TSX 示例。
- `assets/skills/<name>/` 由 `pnpm gen:skills` 生成，禁止手改。每个最终目录必须能独立复制，
  内部相对链接不得越出当前 Skill；生成链接与文件键统一使用 `/`，不依赖宿主路径分隔符。
- `assets/skills/dist/` 是 `pnpm pack:skills` 生成的离线包，不提交。

## 生成规则

- `SKILL.md` 的 frontmatter 由 metadata 生成，正文来自 `skill.md`。
- `agents/openai.yaml` 由 metadata 生成。
- `references/api.md` 来自公开 TypeScript 导出及 catalog 的英文语义说明；
  `references/examples.md` 与文档站标记块来自同一份 TS/TSX。
- `kit-components` 必须覆盖 chat-ui barrel 的全部组件、静态子组件与工具函数，不能只看
  registry 分组。工具函数标记 `kind: "helper"`，示例必须实际调用；组件示例必须通过 JSX 使用。
- `kit-chat-provider` 覆盖独立 Stream/Request 与后端适配；`use-kit-chat` 覆盖 SDK Controller
  与各功能 `/hooks` hook。新公开子入口必须登记 API 模块表；同一类型经多入口重导出时按符号去重。
  Kit Context 使用 `/providers/kit/react`；通用 `/hooks` 只公开 `useIsMobile`，内部订阅与查询工具不进入公开参考。
- SDK 与 Skill 文档页都从 `src/*/examples/` 同步代码，不能为新入口维护第二份手写示例。
- SDK 未发布能力必须说明依赖前提；示例不得导入 SDK 主入口或 internal，不复制其转换器。

## 验收与分发

- `pnpm typecheck:skills` 编译 `src/*/examples/` 与公开 API fixture。
- `pnpm test:skills` 保护同步漂移、独立离线包、英文内容、链接和浏览器依赖边界，
  不重复测试 Provider 网络映射。
- `pnpm gen:skills` 更新最终目录与文档示例块；`pnpm check:skills` 只读比较，发现漂移失败。
- `pnpm pack:skills` 在检查通过后生成 `assets/skills/dist/*.tgz`；构建产物不入库，不发布 npm。
- 文档站构建先校验源内容，再复制最终 Skill 目录与离线包。不能在构建时改写被跟踪的文档。
- 新增复杂流程时用独立 agent 在临时目录前向试用，再按实际结果改进内容。
