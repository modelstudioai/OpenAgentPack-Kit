import styles from "./form-row.module.less";

/** 横排表单行：label 固定 96px 左列、控件占满剩余宽度，窄屏回落为上下两行。 */
export const formRowClass = styles.row;

export const formRowLabelClass = styles.label;

/** 无标题的行内块缩进到控件列起点（96px 列宽 + 12px 列距）。 */
export const formRowIndent = styles.indent;
