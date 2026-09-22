# T02 — Planning system and Current Next

## Outcome

交付完整的 Goal → Track → Task 计划系统。完成后，用户可以在 Web 中维护全部计划，AI 也可以通过 MCP 完成完全等价的领域操作；每个 Track 的 Current Next 在创建、排序、完成、跳过、归档和恢复过程中始终满足 PRD 约束。

## Dependency

Depends on #1.

## Scope

### Goal and Track services

- 实现 Goal create/list/update、complete、archive、reactivate 和 reorder。
- 实现 Track create/list/update、complete、archive、reactivate 和 reorder。
- Goal/Track 状态变化不级联修改子项。
- 非 active Goal/Track 不出现在默认 active 查询中；`includeArchived`/status filter 可显式读取。
- Goal/Track 重新 active 时保留子项状态和 Track.currentTaskId。
- 如果所属 Track 存在 active/paused Session，禁止将 Track 或 Goal 改为 completed/archived，返回 `PARENT_HAS_ACTIVE_SESSION`。
- reorder 接受当前容器内完整 ID 顺序，验证不缺失、不重复、不混入其他父级，在事务中重编号为连续整数。

### Task services

- 单个与批量 Task 创建；MCP/Web 共用同一 batch service，单次 1–50 个。
- 新 Task 默认追加，批量输入顺序保持不变。
- Track 没有 Current Next 时，第一个新 pending Task 在同一事务中自动成为 Next；已有 Next 时不覆盖。
- Task update 支持 title、description、estimatedMinutes、resource 和 note。
- Resource type/value 必须成对存在；URL 只允许 http/https；清除操作原子清除两者。
- 实现 Task complete、skip、archive、reopen 和 reorder。
- Current Next Task 被 complete/skip/archive 时，原子推进到其后第一个 pending Task；没有则设为 null。
- 操作非 Current Next Task 不改变 Next。
- reopen 将状态恢复为 pending、清除 completedAt，但不改变 Next。
- reorder 不改变 Next；后续 advance 使用最新排序。
- 完成最后一项不自动完成 Track。

### Current Next service

- `getNext(trackId?)`：读取指定 Track 或所有 active Tracks 的 Next。
- `setNext(trackId, taskId | null)`：验证 Task 属于 Track 且 pending；允许显式清空。
- 服务返回 Task 状态变更后的 `affectedTask` 与 `nextTask`，避免 Web/MCP 再做推断。
- 并发 complete/skip/archive/setNext 使用事务和锁策略保证不会产生非法引用或丢失更新。

### Idempotent task creation

- `tasks_create` 支持可选 idempotencyKey。
- 相同 operation/key 和相同 payload 返回第一次结果；相同 key 但 payload 不同返回 `IDEMPOTENCY_KEY_REUSED`。
- 并发相同 key 只能创建一批 Tasks。

### Web experience

- `/goals` 展示 active Goals 及其 Tracks，支持创建、编辑、complete、archive、reactivate 和 drag reorder。
- archived/completed 内容通过低权重筛选查看，不污染默认执行视图。
- `/tracks/:id` 显示 Track 状态、Current Next 与完整 Task 列表。
- Task 行提供 Edit、Complete、Skip、Archive、Reopen、Set as Next、Open resource；破坏性状态操作提供清晰确认或可撤销反馈。
- 支持 Add Task、batch paste/create 与 drag reorder。
- Current Next 有明确标记；排序变化时标记不跳动。
- Track 没有 Task 或没有 Next 时展示不同空状态，并允许新增或显式选择 Next。
- Desktop 与 375px mobile 均可完成主要维护操作。

### MCP parity

实现并注册：

```text
goals_list
goal_create
goal_update
goals_reorder
tracks_list
track_create
track_update
tracks_reorder
tasks_list
tasks_create
task_update
tasks_reorder
task_complete
task_skip
task_archive
task_reopen
next_get
next_set
```

- update tools 承载 complete/archive/reactivate 等父级状态变化；tool description 明确生命周期规则。
- 所有 list tools 有 status/includeArchived 和安全 limit/cursor。
- 返回结构适合 AI 继续调用：必须包含稳定 ID、title、status、position 与必要父级 ID。
- 所有失败映射为结构化 domain error，不把 DB error 直接暴露给 MCP client。

## Required tests

### Unit/service

- 首批 Task 自动 Next、已有 Next 不覆盖；
- complete/skip/archive Current Next 的推进；
- 非 Current Next 操作不推进；
- reopen 与 reorder 不改变 Next；
- resource pair 和 estimatedMinutes validation；
- parent lifecycle 与恢复；
- idempotency key 同 payload/异 payload行为。

### Integration/concurrency

- reorder 完整性和连续 position；
- 两个并发 complete/setNext 不产生 dangling currentTaskId；
- 两个并发 batch create 使用同 key 只写一次；
- foreign key、status 与 transaction rollback；
- 每个 service 的 Web/MCP contract parity。

### E2E

- Web：创建 Goal → Track → batch Tasks → 首项自动 Next → reorder → complete 当前项 → Next 推进 → reopen 不抢占；
- MCP：独立完成同一流程并由 Web 立即显示结果；
- 父级 archive/reactivate 后默认视图、执行限制和数据保留正确。

## Acceptance checklist

- [ ] 不打开 Web，AI 能完整创建和维护计划。
- [ ] 不使用 MCP，Web 能完成完全相同的数据操作。
- [ ] Current Next 在所有 Task 状态与排序路径中保持合法。
- [ ] 无业务规则存在于 React component 或 MCP handler。
- [ ] 真实 PostgreSQL 并发测试证明事务规则，而非只靠单元 mock。

## Out of scope

- Session timer 与 Focus 页面；
- History/Statistics；
- 自动 AI 规划或推荐。
