import styles from "./styles.module.less";

/**
 * 管理端共享样式常量：桥接层，颜色消费 antd css-var（ADR-0015，console 用 antd 默认主题）。
 * 页面迁移到 antd 组件后，对应常量随之删除；不要往这里新增常量。
 */

/** 主按钮（提交/保存）。 */
export const primaryButtonClass = styles.primaryButton;

/** 次级按钮（编辑/展开等中性动作）。 */
export const ghostButtonClass = styles.ghostButton;
