# packages/eval — Skill 效果评测

## 不变量

1. **只经 SDK 公开面碰 Provider**：skill 上传/审查/挂载/会话/事件一律 `@openagentpack/sdk`
   公开导出或 agentstudio REST 公开路径；禁 `internal/*`。
2. **触发判定唯一信号**：`tool_use` 事件且 `tool_name === "activate_skill"`、
   `tool_input.name === <skill name>`；不得用文本猜测触发（负例对照见
   `docs/research/skill-eval-probe.md`）。
3. **评测资产与产物只落本地 workspace**（`<skill-dir>-workspace/`），永不写进 git、
   不落 kit server 的 SQLite；`evals/evals.json` 保持社区 schema 可被外部 runner 消费，
   扩展字段只进旁置 `evals/kit.json`。
4. **审查等待必须异步有界**：`checking → active` 实测分钟级；run 的 ingest 阶段独立展示
   进度，超时取 `config.review_timeout_ms`（默认 10 分钟），不得静默死等。
5. **清理语义**：session 可 delete；agent 只能 archive（DELETE 返回 405）；skill 默认不删
   （硬删不可恢复），按 content-hash 复用已上传 version。
6. **评测 agent 三件套缺一不可**（探针实测）：`system`（不是 instructions）+
   builtin_toolkit(bash/read/write, always_allow) + environment_id；少 toolkit 时 agent 无写文件能力，
   skill 的文件产出契约必然假失败；
7. **judge 断言必须带证据引文**；脚本断言与 judge 断言分开执行、分开计分（grading.json
   的 `kind` 字段），tokens 拿不到时 timing.json 的 `tokens` 显式为 null 不许编造。

## 加一个新断言类型时

1. 在 `src/schema.ts` 的脚本断言词表加名字与参数语法；
2. 在 `src/grade.ts` 实现纯函数判定（输入 transcript/artifacts，输出 passed+evidence）；
3. 补单测（正/负各一）；
4. 同步 `docs/research/skill-eval-probe.md` 的词表小节。

## 强制它的闸门

- dependency-cruiser `eval-node-only-consumers`（只允许 cli/server 消费本包）；
- `pnpm --filter @openagentpack/kit-eval typecheck|test`；`pnpm gate`。
