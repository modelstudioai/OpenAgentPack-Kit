# ADR-0002：零内网依赖、开源前不发布 npm 包

## 背景

仓库以开源为目标孵化（GitHub `modelstudioai`，Apache-2.0），历史阶段在内部环境开发。
内部生态有现成的 antd + 私有网关 + Rspack 微前端方案可复用，用起来最快。

## 决策

1. **全仓零内网依赖**：禁止 `@ali/*`、`@alife/*`、内网域名、私有网关协议与固定密钥注入、
   antd、Rspack 微前端。只参考内部项目的设计与信息架构，不复制代码。
2. **开源前不发布 npm 包**：所有包 `private: true`，仓库内用 `workspace:*` 消费；包名按
   开源目标预置为 `@openagentpack/kit-*`，迁移时只删 `private`，零改名。
3. **依赖公网包走公共 registry**：lockfile 锁定公共源，不引入私有镜像。
4. 管理端与体验页的 UI 一律基于 `kit-elements`（Radix + Tailwind v4）自建。

## 理由

- 「零内网依赖」是开源可行性的前置条件；一旦引入 antd/私有网关，管理端在开源迁移时等于
  重写，且无法对外分发。
- 开源前不发包可以避免与公网已有同名包占位冲突（`@openagentpack/sdk` 等已存在），
  也避免「代码在内部、产物在公网」的合规风险。
- 用 `workspace:*` 消费在 monorepo 内开发体验与发包一致，迁移成本接近零。

## 后果

- 管理端的表单、表格、树、代码编辑器等重控件需要自建，M3 工作量显著高于用 antd。
- 其他项目想复用 kit 能力，只能通过 git 依赖或等开源后安装。
- 需要自动化守护，否则约束会被无意破坏：`pnpm check:no-inner-deps`（扫描内网包与域名）
  + dependency-cruiser `no-inner-network-deps` 规则，两者都进 `verify:push` 与 CI。

## 备选方案

- 双轨（核心零内网 + 独立的内网适配层）：保留在待决项里，需显式批准。
- 直接用内部技术栈：开发最快，但放弃开源可能性，已否决。
