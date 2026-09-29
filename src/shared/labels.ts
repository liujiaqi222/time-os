/**
 * 全站唯一的中文状态 / 术语映射来源。
 *
 * 约定：任何组件 / 页面都从这里取人话文案，禁止再手写裸英文状态字面量
 * （例如直接渲染 `goal.status`、`task.status`、`session.status`）。
 */

export const goalStatusLabel = {
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

export const timerModeLabel = {
  stopwatch: "正计时",
  pomodoro: "番茄钟",
} as const;

export const timeBasisLabel = {
  observed: "实测",
  manual: "补录",
  corrected: "已更正",
} as const;

export const selectionReasonLabel = {
  "active-session": "正在执行",
  "explicit-selection": "已选择",
  "task-fallback": "自动顺延",
  "recent-goal": "最近执行",
  "first-goal": "当前目标",
} as const;

export const terms = {
  goal: "目标",
  task: "任务",
  session: "专注",
  record: "执行记录",
  distraction: "打断",
  resumeHint: "接续提示",
  intent: "本次意图",
} as const;
