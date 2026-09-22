# T03 — Focus execution loop

## Outcome

交付 Time OS 的核心日用闭环：打开 Today，在 5 秒内选择当前 Track 并开始 Focus；计时可跨刷新恢复，支持 Pause/Resume、Note、Distraction、Finish Review 和 Cancel；完成/跳过当前 Task 时原子推进 Next。Web 与 MCP 对所有 Session/Distraction 操作具有等价能力。

## Dependency

Depends on #2.

## Scope

### Session state machine services

- 实现 session start、get active、get detail、pause、resume、finish、cancel。
- 整个实例最多一个 active/paused Session；数据库约束/事务和 service error 同时生效。
- Start 验证 Goal/Track active、可选 Task 属于 Track 且 pending、plannedMinutes 合法。
- 允许 Track-only Session；有 Current Next 时 Web 默认关联，但 service 不强制。
- 计时以服务端 timestamp 为真实来源；提供共享 elapsed/duration 计算函数。
- Pause/Resume/Finish 的重复调用按 PRD 幂等；非法历史状态转换返回 `INVALID_SESSION_STATE`。
- 从 paused finish 时排除当前暂停区间。
- Cancel 保留记录但从默认查询和统计排除，且解除全局 active 锁。
- session_start 支持 idempotencyKey，相同成功请求重试返回同一 Session。

### Atomic finish review services

- `finishSession` 只结束 Session，不自动完成 Task。
- 增加一个面向 Web/MCP 复用的事务 service，支持：
  - Continue later：finish only；
  - Completed：finish + complete Task + advance Next；
  - Skip：finish + skip Task + advance Next。
- 无 Task Session 只允许 finish only。
- 任一步失败整笔回滚；响应包含完成的 Session、Task 结果与新的 Next。
- 并发重复提交 Review 不产生二次推进或错误覆盖。

### Distraction and focus note services

- 实现 Distraction create/list/update/archive；允许空文本。
- 默认列表排除 archived，可显式 includeArchived。
- Distraction 默认使用当前 active/paused Session，也允许显式 sessionId；没有目标时返回明确错误。
- Session Note 更新走轻量 service，允许 Focus 页 debounce 保存；已 finish 的 Session Note 后续由 History update 流程维护。

### Today dashboard

- `/` 查询今日实时统计、active Session、selected/current focus Track 和 active Tracks。
- Current Focus 选择严格按 PRD fallback 顺序；用户手选后写入 AppSettings.selectedTrackId。
- 主卡显示 Track、Current Next、estimatedMinutes/默认时长与唯一 Primary Start CTA。
- 其他 Track 卡为次级视觉；可设为 Current Focus 或直接开始。
- 无 Next Track 支持 `Start unstructured focus` 与 `Add task`。
- 没有任何 Track 时显示去创建计划的空状态。
- 若已有 Session，Start 新 Session 显示现有 Session context 与 Return to focus，而不是泛化错误。

### Focus page

- `/focus/:sessionId` 校验目标是当前 active/paused Session；历史 Session 不伪装为可计时页面。
- 显示 Track、可选 Task、elapsed 或剩余时间；到零进入 overtime，继续累计。
- Pause/Resume、Add Distraction、Quick Note、Finish 与低权重 Cancel 全部可键盘/触屏使用。
- Note debounce 状态清楚展示 saving/saved/error；刷新后以服务端内容恢复。
- Finish 打开轻量 Review，显示实际时长、Note、Continue/Completed/Skip 和预计的新 Next。
- 保存 Review 时等待服务端确认；失败保留用户输入和可重试状态。
- Focus 页不显示普通导航或 backlog。

### Active session global affordance

- 除 Focus 页外的认证页面顶部显示紧凑 active/paused banner：Track、Task、elapsed/status 和 Return to focus。
- 不强制重定向，不在 banner 内复制完整计时控制。
- 浏览器标签恢复、跨页面导航与重新加载后状态正确。

### Keyboard and mobile

- Space pause/resume、D distraction、F finish、Esc close；输入/textarea/select/contenteditable 聚焦时禁用快捷键。
- Focus 以 375px 为最低宽度完成布局、点击区域和软键盘验证。
- 防止重复点击、浏览器返回和页面 visibility change 造成状态分叉。

### MCP parity

实现并注册：

```text
dashboard_get
session_get_active
session_get
session_start
session_pause
session_resume
session_finish
session_cancel
distractions_list
distraction_log
distraction_update
distraction_archive
```

- `session_finish` 支持 finish-only 或带明确 Task outcome 的原子 Review 语义；schema 不允许模糊组合。
- dashboard 返回 AI 做选择所需的 Current Next、estimatedMinutes、today focus 与 active Session。
- Web/MCP 的重复调用、错误和响应形状通过共享 contract cases 验证。

## Required tests

### Unit/service

- 所有合法/非法 Session transitions；
- 多次 pause/resume 与 paused finish 的 duration；
- idempotent pause/resume/finish/start；
- Cancel 排除规则；
- Finish+complete/skip 事务与 Next；
- dashboard fallback selection；
- keyboard shortcut guard。

### Integration/concurrency

- 并发 start 只有一个成功；
- 并发 finish Review 只推进一次；
- transaction 中任一步失败完全回滚；
- cancelled Session 不再阻塞；
- Distraction 仅关联合法 Session；
- Web/MCP contract parity。

### E2E/runtime

- Today Start → 运行一段时间 → refresh → elapsed 不重置；
- pause → refresh → 时间保持停止 → resume；
- overtime 不自动 finish；
- Note 自动保存并跨刷新恢复；
- Distraction 创建/编辑/archive；
- Finish+Completed 后 History 数据存在、Task 完成、Next 推进；
- Cancel 后立即可启动另一个 Track；
- 375px mobile 完整 Focus 流程；
- MCP 启动的 Session 在 Web 中立即恢复，Web 操作后 MCP 读取一致。

## Acceptance checklist

- [ ] 用户打开首页后 5 秒内可开始一次 Focus。
- [ ] 关闭或刷新浏览器不会丢失计时。
- [ ] 全局永远不会出现两个 active/paused Session。
- [ ] Finish 与 Task outcome 的跨实体事务可证明原子。
- [ ] Web 与 MCP 可以接管彼此启动的 Session。
- [ ] Focus 页在移动端可实际完成全流程。

## Out of scope

- 手动历史补录和 Session 时间纠错；
- 完整 History 过滤与统计图表；
- 系统通知、声音或 Pomodoro 行为。
