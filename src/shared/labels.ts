/**
 * 全站唯一的中文状态 / 术语映射来源。
 *
 * 约定：任何组件 / 页面都从这里取人话文案，禁止再手写裸英文状态字面量
 * （例如直接渲染 `track.status`、`task.status`、`session.status`）。
 */

export const goalTrackStatusLabel = {
  active: "进行中",
  completed: "已完成",
  archived: "已归档",
} as const;

export const taskStatusLabel = {
  pending: "待办",
  completed: "已完成",
  skipped: "已跳过",
  archived: "已归档",
} as const;

export const sessionStatusLabel = {
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
} as const;

export const sessionEntryModeLabel = {
  timer: "计时",
  manual: "手动补录",
} as const;

export const sessionCreatedViaLabel = {
  web: "网页",
  mcp: "MCP",
} as const;

export const terms = {
  goal: "目标",
  track: "推进线",
  task: "任务",
  next: "下一步",
  session: "专注",
  record: "专注记录",
  distraction: "打断",
} as const;
