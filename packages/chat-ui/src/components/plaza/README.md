# plaza 广场与用量组件聚合

兼容已有 `kit:add plaza` 用法，只重导出组件。

智能体卡片、分类导航、用量条和活跃图各有独立目录；它们只消费展示数据和回调，不编排后端业务。

## Props

本目录只重导出组件，不接收独立 Props；各组件参数见下表。

| 导出 | 参数说明 |
| --- | --- |
| `PlazaCard` | [plaza-card](../plaza-card/README.md#props) |
| `CategoryTabs` | [category-tabs](../category-tabs/README.md#props) |
| `MeterBar` | [meter-bar](../meter-bar/README.md#props) |
| `ActivityHeatmap` | [activity-heatmap](../activity-heatmap/README.md#props) |

## 导出与使用

本目录维护：PlazaCard、CategoryTabs、PlazaTabId、MeterBar、ActivityHeatmap；内部 relativeUsedLabel。

```bash
pnpm kit:add plaza
```

源码入口为 [index.ts](index.ts)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[activity-heatmap](../activity-heatmap/README.md)、[category-tabs](../category-tabs/README.md)、[meter-bar](../meter-bar/README.md)、[plaza-card](../plaza-card/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/plaza.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
