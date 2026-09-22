# T04 — History, manual records and statistics

## Outcome

把执行数据变成可信的历史与反馈。完成后，用户和 AI 都能查看、筛选、补录和纠正 Session，检查 Distractions，并获得符合 timezone、跨午夜、暂停和实时 Session 规则的统计。

## Dependency

Depends on #3.

## Scope

### Session history query

- 实现统一 sessions list/detail query，支持时间范围、Track、Task、状态、entryMode、createdVia、cursor/limit。
- 默认排除 cancelled；审计查询可以显式包含。
- History 按 Session startedAt 对应的本地日期归组，一条 Session 始终只显示一次。
- detail 返回 Track/Task 快照所需字段、时间、planned/actual/pause、Note、Distractions、entryMode、createdVia 和 status。
- 查询边界明确使用 half-open interval，避免分页/相邻日期重复。

### Manual Session creation

- Web 与 MCP 均可补录 Track、可选 Task、duration、endedAt 和 Note。
- 默认 endedAt=now，startedAt=endedAt-duration，entryMode=manual；createdVia 由 adapter context 决定。
- `session_log` 支持 idempotencyKey，重试不重复写入。
- 目标 Goal/Track 可以是当前 active 或历史仍存在的实体；Task 若提供必须属于 Track。禁止关联不存在或错误归属的 Task。
- 手动补录不参与“当前 active Session”排他，因为它创建后即 completed。

### Session correction

- completed/manual Session 支持更新 Track、Task、startedAt/endedAt 或有效 duration、plannedMinutes 和 Note。
- 定义清晰输入优先级：调用者提供 start/end 或 start/duration 的一种合法组合，service 归一为一致字段；禁止互相矛盾的组合。
- 更新后重新验证 duration>0、Task/Track 关系和 overlap。
- completed Session 不可改回 active/paused；cancelled Session 只允许读取，不通过 update 复活。
- Timer Session 的历史时间可以纠错，但保留 entryMode=timer 与 createdVia。

### Overlap detection and confirmation

- 创建/更新 manual 或 completed Session 时检测与其他非 cancelled Session 的有效时间范围重叠。
- 第一次请求返回 `SESSION_TIME_OVERLAP`，context 至少包含冲突 Session ID、Track、startedAt、endedAt。
- Web 显示冲突并要求确认；确认请求传 `allowOverlap=true`。
- MCP schema 同样要求显式 `allowOverlap=true` 才能越过冲突。
- overlap 检查和最终写入处于足够强的事务隔离中，避免检查后并发插入绕过提示。

### History Web UI

- `/history` 按本地日期分组，支持日期范围、Track 筛选与分页/加载更多。
- 每日展示 Session 行与总时长；当前 active/paused Session 可实时显示但状态明确。
- Add Session 提供 Track、可选 Task、duration、结束时间和 Note；时间重叠时保留表单并显示确认。
- 点击记录使用行内展开或 Sheet 显示完整 detail 与 Distractions。
- completed/manual Session 可 Edit；合法 Session 可按既定规则 Cancel。cancelled 默认隐藏，可切换审计视图。
- History detail 内可编辑/archive Distraction。
- 所有时间和日期以 AppSettings timezone 呈现，并清楚区分有效时长与墙上开始/结束时间。

### Statistics service

实现 today/week/month/custom 统计：

```text
totalFocusSeconds
sessionCount
completedTaskCount
focusDays
byTrack
```

严格规则：

- completed、active、paused、manual 计入；cancelled 不计入；
- active/paused 按 query now 实时计算；paused 当前区间不计入；
- Session 与查询时间段求真实交集，跨午夜/周边界按秒拆分；
- timezone 使用当前 AppSettings；weekStartsOn 决定周起点；
- DST 使用真实 instant 计算，不假设一天固定 24 小时；
- 重叠 Session 分别累加；
- sessionCount 计入与区间相交且有有效专注秒数的 Session，包括当前 Session；
- completedTaskCount 根据 completedAt 落入本地查询区间计算；
- focusDays 是有效专注秒数大于 0 的本地日期数。

### Today and History integration

- Today 的今日时长/sessionCount 改为复用同一 stats service，不维护独立口径。
- Finish、Cancel、manual log/update 后相关页面 revalidate，避免旧统计。
- Track Distribution 对 archived/completed Track 仍使用历史 title，不丢失归属。

### MCP parity

实现或补全：

```text
sessions_list
session_get
session_log
session_update
stats_get
distractions_list
```

- list/detail 输出既适合 AI 概括，也避免无界返回大数据。
- stats custom period 校验 from/to；所有输出包含计算使用的 timezone、period start/end。
- overlap domain error 和确认重试在 MCP 真实调用中验证。

## Required tests

### Unit/service

- manual time normalization；
- overlap boundary：相邻不冲突、包含/部分相交冲突、cancelled 不冲突；
- completed/manual update validation；
- timezone day/week boundaries；
- cross-midnight、current paused、DST spring/fall；
- cancelled exclusion、overlap summation、completedTaskCount/focusDays。

### Integration/concurrency

- session_log idempotency；
- overlap check/confirm 与并发写；
- query pagination 无重复/遗漏；
- update transaction 与 entity relation validation；
- Web/MCP History/Stats contract parity。

### E2E/runtime

- Web 补录 → overlap warning → confirm → History 两条均存在；
- 编辑 Session Track/Task/time/note，统计同步变化；
- MCP 补录后 Web 立即显示；Web 编辑后 MCP detail 一致；
- 跨本地午夜 Session 在 History 一条、两日统计拆分；
- active/paused Session 的 Today 数值随状态正确变化；
- cancelled Session 只在审计筛选中可见。

## Acceptance checklist

- [ ] History、Today 和 stats_get 不存在三套统计口径。
- [ ] 用户能修正错误记录，而不破坏 Session 状态机。
- [ ] AI 不能在未明确确认时写入重叠时间。
- [ ] 跨午夜和 DST 有确定、经过测试的结果。
- [ ] cancelled 数据保留但不污染默认体验与统计。

## Out of scope

- 高级图表、趋势预测或生产力评分；
- 自动合并重叠 Session；
- CSV/export/import；
- hard delete。
