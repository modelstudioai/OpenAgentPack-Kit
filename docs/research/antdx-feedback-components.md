# Ant Design X 反馈组件参考（2026-10-16）

## 参考范围

官方[组件介绍](https://x.ant.design/components/introduce-cn/)将 Actions、FileCard、Sources、
CodeHighlighter、Mermaid、Folder 归为「反馈」。本轮按用户确认，先实现已有体验页调用场景的
Actions、FileCard、CodeHighlighter、Mermaid。Sources 和 Folder 不在本轮范围内。

| 组件 | 参考的交互 | Kit 真实调用方 |
| --- | --- | --- |
| [Actions](https://x.ant.design/components/actions-cn/) | 操作项、复制反馈、点赞/点踩受控状态、更多操作与变体 | 助手消息完成后的原文复制；Web 注入宿主桥复制能力 |
| [FileCard](https://x.ant.design/components/file-card-cn/) | 文件名、类型、大小、加载态、预览与操作 | Message 的 Artifact 下载；Attachments 的上传卡片适配 |
| [CodeHighlighter](https://x.ant.design/components/code-highlighter-cn/) | 语言头部、语法高亮、原文复制 | 助手 Markdown 的 fenced code |
| [Mermaid](https://x.ant.design/components/mermaid-cn/) | 图表与源码切换、复制、异步图形展示 | 助手 Markdown 的 mermaid fenced code |

## 实现取舍

Ant Design X 依赖 antd，与 ADR-0002 不兼容，因此这里只参考公开 API 与交互，不引入
`@ant-design/x` 或 antd。现有 Markdown 仅提供代码块排版，ArtifactCard 仅提供文件下载，
无法覆盖本轮高亮、图表和独立文件卡片能力；在既有组件上提取复用，并保留已有导出兼容。

- Actions 的点赞/点踩是受控展示能力，调用方通过回调处理；当前 Provider 合同没有反馈写入
  操作，体验页只接入已存在的复制能力。
- 文件卡片仅展示 props 并发出操作回调。上传、下载鉴权、宿主保存仍归现有调用方负责。
- 代码高亮采用 lowlight 返回的语法树，通过 React 文本节点渲染并映射到既有 theme token。
  未识别语言显示原文，不执行代码，也不向浏览器注入高亮 HTML。
- Mermaid 按需加载，图表渲染失败时保留源码；图像隔离展示，避免把模型生成的 SVG 直接作为
  交互 DOM。图形渲染与代码高亮依赖均从包安装，不使用运行时 CDN。
- 不修改 SessionEvent 或 MessagePart，不解析未知工具输出来伪造来源引用。

上游 API 参考：[lowlight](https://github.com/wooorm/lowlight)、
[Mermaid 用法](https://mermaid.js.org/config/usage.html)、
[Mermaid 安全级别](https://mermaid.js.org/config/schema-docs/config.html#securitylevel)。

本记录是上游调研与实现取舍；实际通过项与验证边界以仓库测试套件为准。
