# Time OS — MVP PRD

**Version:** 0.2

**Date:** 2026-09-22
**Status:** Ready for implementation

**Working name:** Time OS

---

## 1. Product definition

Time OS 是一个面向个人的、AI-native 的目标执行与时间管理工具。

> **AI is the planner. Time OS is the execution system.**

用户在 ChatGPT、Claude、Codex 等支持 MCP 的 AI 客户端里讨论目标、拆解计划和调整优先级；Time OS 保存计划状态，明确每条推进线的下一步，并记录真实执行。

Time OS 解决两个问题：

1. **我现在应该做什么？**
2. **我上次做到哪里了？**

MVP 不内置 AI Chat、LLM API、自动拆解或推荐算法。

### 1.1 MVP 成功标准

第一优先级是作者本人可以每天稳定使用；同时保持任何开发者都能通过 GitHub、Vercel 和 Neon 部署自己的单用户实例。

核心价值按以下顺序验证：

1. 每个 Track 唯一的 Current Next 能降低启动成本。
2. Focus Session 能可靠记录执行过程。
3. AI 能通过 MCP 完成与 Web 相同的领域数据操作。

Web 首先形成可日用体验，但每个领域能力必须复用同一 Service Layer，并同时提供等价 MCP 能力。

---

## 2. Product principles

### 2.1 Execution first

Time OS 80% 服务执行，20% 服务查看和维护计划。首页首先展示当前可执行内容，而不是完整 backlog。

### 2.2 One clear next

每个 Track 同一时间最多有一个 Current Next。Current Next 是显式执行状态，不等同于排序第一的 Task。

### 2.3 AI plans, app stores

AI 负责讨论与决策；Time OS 负责持久化、状态约束、计时、历史与统计。所有关键业务规则必须在服务端执行。

### 2.4 Low friction

任何功能都必须回答：它是在帮助用户开始执行，还是在制造管理工作？后者不进入 MVP。

### 2.5 Safe defaults, reversible details

产品方向和数据完整性必须在实现前明确。排序重编号、加载态、错误文案等可逆细节采用简单可靠的默认实现，在真实使用后调整。

---

## 3. Target user and deployment model

MVP 面向：

- 单用户；
- 同时推进多个学习或工作方向；
- 经常使用 10–60 分钟碎片时间；
- 已使用 ChatGPT、Claude、Codex 等 AI 工具；
- 希望 AI 可以直接维护自己的执行系统。

部署模型固定为：

> **One deployment = one user**

每个实例拥有独立的 Vercel Project、Neon PostgreSQL、Web 密码、MCP Token 和数据。不设计 users、organizations、workspaces、memberships、roles、subscriptions 或 tenant_id。

---

## 4. Domain model

产品采用固定三级结构：

```text
Goal
  └── Track
        └── Task
```

不支持 Subtask 或任意深度嵌套。Task 太大时，应拆成多个平级 Task。

### 4.1 Goal

```ts
type GoalStatus = "active" | "completed" | "archived"

interface Goal {
  id: UUID
  title: string
  description: string | null
  status: GoalStatus
  position: number
  createdAt: timestamp
  updatedAt: timestamp
}
```

### 4.2 Track

Track 必须属于一个 Goal。

```ts
type TrackStatus = "active" | "completed" | "archived"

interface Track {
  id: UUID
  goalId: UUID
  title: string
  description: string | null
  status: TrackStatus
  currentTaskId: UUID | null
  position: number
  createdAt: timestamp
  updatedAt: timestamp
}
```

`currentTaskId` 即 Current Next；它必须指向本 Track 内的 pending Task。

### 4.3 Task

```ts
type TaskStatus = "pending" | "completed" | "skipped" | "archived"
type ResourceType = "url" | "text"

interface Task {
  id: UUID
  trackId: UUID
  title: string
  description: string | null
  status: TaskStatus
  position: number
  estimatedMinutes: number | null
  resourceType: ResourceType | null
  resourceValue: string | null
  note: string | null
  completedAt: timestamp | null
  createdAt: timestamp
  updatedAt: timestamp
}
```

Resource 只有 URL 和 Text 两类。`resourceType` 与 `resourceValue` 必须同时为空或同时有值；URL 仅接受 `http`/`https`。

### 4.4 Session

Session 代表一次真实执行时间，必须关联 Track，可以不关联 Task。

```ts
type SessionStatus = "active" | "paused" | "completed" | "cancelled"
type SessionEntryMode = "timer" | "manual"
type SessionCreatedVia = "web" | "mcp"

interface Session {
  id: UUID
  trackId: UUID
  taskId: UUID | null
  status: SessionStatus
  entryMode: SessionEntryMode
  createdVia: SessionCreatedVia
  plannedMinutes: number | null
  startedAt: timestamp
  pausedAt: timestamp | null
  totalPausedSeconds: number
  endedAt: timestamp | null
  durationSeconds: number | null
  note: string | null
  createdAt: timestamp
  updatedAt: timestamp
}
```

`entryMode` 表示 timer 或事后补录；`createdVia` 表示由 Web 还是 MCP 创建。两者不得混用为一个 source 字段。

### 4.5 Distraction

```ts
interface Distraction {
  id: UUID
  sessionId: UUID
  text: string | null
  archivedAt: timestamp | null
  createdAt: timestamp
  updatedAt: timestamp
}
```

允许空文本，表示快速记录一次打断。支持编辑和 archive，不支持 hard delete。

### 4.6 App settings

```ts
interface AppSettings {
  id: "default"
  timezone: string
  defaultFocusMinutes: number
  weekStartsOn: 0 | 1
  selectedTrackId: UUID | null
  setupCompletedAt: timestamp | null
  createdAt: timestamp
  updatedAt: timestamp
}
```

Timezone 必须使用 IANA timezone。数据库时间统一存 UTC，展示和统计基于当前设置的 timezone 计算。

### 4.7 Idempotency records

`tasks_create`、`session_start`、`session_log` 支持可选 `idempotencyKey`。相同操作范围和 key 的重试必须返回第一次的结果，不能重复写入。实现可以使用独立表保存 key、操作类型、请求摘要和结果引用。

---

## 5. Domain invariants

数据库约束与 Service Layer 必须共同保证：

1. Track 必须属于 Goal。
2. Task 必须属于 Track。
3. Session 必须属于 Track。
4. Session 有 Task 时，Task 必须属于同一 Track。
5. Current Next 必须属于同一 Track，且状态为 pending。
6. 整个实例同时最多存在一个 active 或 paused Session。
7. completed、skipped、archived Task 不能成为 Current Next。
8. 非 active Goal 或 Track 下不能开始新 Session。
9. 有 active/paused Session 时，不能将其 Goal 或 Track 改为 completed/archived。
10. `estimatedMinutes`、`plannedMinutes` 和手动时长有值时必须大于 0。
11. `durationSeconds` 和 `totalPausedSeconds` 不能为负。
12. 每个 Track 内 Task position 是从 1 开始的连续整数。
13. 所有跨实体状态变更必须通过事务完成。

MVP 不提供任何 hard delete。Goal、Track、Task 和 Distraction 使用 archive；Session 使用 cancel。

---

## 6. Task and Current Next rules

### 6.1 Creation and ordering

- 新 Task 默认追加到 Track 末尾。
- 批量创建保持输入数组顺序，每次最多 50 个。
- 如果 Track 没有 Current Next，创建后的第一个 pending Task 自动成为 Current Next。
- 如果已有 Current Next，创建 Task 不覆盖它。
- Web 与 MCP 都提供一次提交完整 Task ID 顺序的 reorder 能力；服务端在事务内重编号。
- 重排不改变 Current Next。

### 6.2 Manual selection

用户或 AI 可以显式设置任意合法 pending Task 为 Current Next，也可以设置为 null。设置时必须验证 Task 属于 Track。

### 6.3 Complete, skip and archive

当 complete、skip 或 archive 的 Task正好是 Current Next 时，服务端在同一事务中修改状态、按当前 position 查找后续第一个 pending Task并更新 Current Next。没有后续 Task 时设为 null。

对非 Current Next Task 执行这些操作时，不改变 Current Next。完成最后一个 Task 不自动完成 Track。

### 6.4 Reopen

completed、skipped 或 archived Task 可以恢复为 pending：清除 `completedAt`，但不自动设为 Current Next。

### 6.5 Parent states

- Goal/Track 的 completed 和 archived 都不会级联改写子项状态。
- 非 active 父级从默认界面隐藏，并阻止其下开始新 Session。
- Goal/Track 可以重新激活；恢复时保留子项状态和原 Current Next。

---

## 7. Session state machine

### 7.1 Timer source of truth

计时真实状态来自服务端时间字段：

```text
elapsed = now - startedAt - accumulated paused time
```

客户端仅实时显示。刷新、关闭浏览器或换设备都不会停止 Session。

### 7.2 Start

可以从 Track 的 Current Next 启动，也可以启动不关联 Task 的 Track-only Focus。

启动必须验证 Goal/Track active、可选 Task 属于 Track 且 pending、没有其他 active/paused Session，以及 plannedMinutes 合法。

`plannedMinutes` 可选。有值时 UI 显示剩余时间，到零后进入 overtime；不弹窗、不暂停、不自动完成。

### 7.3 Pause and resume

- active → paused 合法；重复 pause 返回当前 paused Session。
- paused → active 合法；重复 resume 返回当前 active Session。
- paused 时间不计入 duration。
- cancelled/completed Session 不能 pause 或 resume。

### 7.4 Finish

active 或 paused Session 可以 finish。服务端计算实际有效时长；如果从 paused finish，当前暂停区间也必须排除。重复 finish 返回已完成结果，不重复变化。Finish 本身不自动修改 Task。

### 7.5 Finish review

Web Review 提供：

- Continue later：仅 finish Session；
- Completed：事务内 finish Session、complete Task、advance Next；
- Skip：事务内 finish Session、skip Task、advance Next。

任一步失败则整笔事务回滚。无 Task 的 Session 只显示 Finish。

### 7.6 Cancel

误启动或遗留 Session 可以 cancel。它保留记录、note 和 endedAt，但不进入默认 History，不计入专注时长或 Session count，也不能恢复、resume 或 finish。

### 7.7 Manual log and correction

Web 与 MCP 都支持事后补录：Track、可选 Task、有效时长、结束时间和 note。默认 `endedAt = now`，`startedAt = endedAt - duration`。

completed/manual Session 可以更正 Track、Task、开始/结束时间、有效时长与 note，但不能改回 active/paused。修改后必须重新验证实体关系和正时长。

### 7.8 Overlap policy

历史非 cancelled Session 时间重叠时允许保存，但必须显式确认：

- Web 先显示冲突 Session，再由用户确认；
- MCP 首次返回 `SESSION_TIME_OVERLAP`，只有传入 `allowOverlap: true` 才写入。

统计按各 Session 有效时长相加，不自动去重。

### 7.9 Focus note

Focus 页 Quick Note 通过短 debounce 自动保存到当前 Session。Finish Review 编辑同一字段，刷新或关闭页面不得丢失已保存内容。

---

## 8. Today and Focus experience

### 8.1 Today

首页目标是 5 秒内开始执行，包括今日专注数据、一个主要 Current Focus 卡片和其他 active Tracks 的紧凑卡片。全页最多一个强视觉 Primary CTA。

Current Focus 选择规则：

1. `selectedTrackId` 对应 Track 仍可执行时使用它；即使没有 Current Next，也保持选择。
2. 否则选择最近存在有效 Session 行为的可执行 Track。
3. 再否则按 `Goal.position → Track.position` 选择第一个。
4. 没有可执行 Track 时显示创建引导。

用户可以手选 Track 并持久保存。Track 有 Current Next 时 Start 默认关联该 Task；没有 Next 时提供 `Start unstructured focus` 和 `Add task`。

### 8.2 Focus page

Focus 页只显示 Track、可选 Task、计时、Pause/Resume、Add Distraction、Quick Note、Finish，以及低权重的 Cancel。它不显示普通 Sidebar、Goals、Statistics 或 Backlog。

其他页面如果存在 active/paused Session，在顶部显示紧凑提示与 `Return to focus`，不强制重定向。

### 8.3 Keyboard interaction

- Space：Pause/Resume；
- D：记录 Distraction；
- F：Finish；
- Esc：关闭 Dialog/Sheet。

输入框获得焦点时不得触发快捷键。

---

## 9. Planning, History and Statistics

### 9.1 Goals and Track detail

Goals 页面支持 Goal/Track 创建、编辑、完成、归档、恢复和排序。Track Detail 支持完整 Task 维护、排序、Next 设置、资源与 Note，以及从 Track/Task 启动 Focus。

### 9.2 History

History 按 Session `startedAt` 对应的本地日期归组，支持日期/Track 筛选和 Add Session。点击记录后用行内展开或 Sheet 显示 Track、Task、时间、有效/计划/暂停时长、Note、Distractions、entryMode、createdVia，以及 Edit/Cancel。

跨午夜 Session 在 History 中归入开始日，始终只显示一条；统计按真实时间区间拆分。

### 9.3 Statistics

MVP 提供 Today Focus、Weekly Focus、Track Distribution、Completed Tasks、Focus Days 和 Session Count。

- completed、active、paused 和 manual Session 计入；cancelled 不计入；
- active/paused 按查询时刻实时计算，paused 区间不计入；
- 跨本地午夜按查询区间交集拆分；
- weekStartsOn 决定周边界；
- 使用当前 AppSettings timezone；
- 重叠 Session 各自累加，不自动去重。

不提供 Productivity、Efficiency、AI 或 Focus Quality 分数。

---

## 10. Web and MCP capability parity

所有 Web 可执行的领域数据读取与写入，MCP 都必须能完成，包括：

- Goal/Track/Task 状态操作和排序；
- Current Next set/clear；
- Session start/pause/resume/finish/cancel/log/update/detail/list；
- Distraction create/list/update/archive；
- Settings read/update；
- Dashboard、History 和 Statistics 查询。

页面导航、拖拽手势、Web 登录和 Secret 管理不属于领域能力对等；MCP 提供语义等价工具。所有 adapter 调用同一 Service Layer。

### 10.1 MCP tools

Read：

```text
dashboard_get
goals_list
tracks_list
tasks_list
next_get
session_get_active
session_get
sessions_list
distractions_list
stats_get
settings_get
```

Write：

```text
goal_create / goal_update / goals_reorder
track_create / track_update / tracks_reorder
tasks_create / task_update / tasks_reorder
task_complete / task_skip / task_archive / task_reopen
next_set
session_start / session_pause / session_resume
session_finish / session_cancel / session_log / session_update
distraction_log / distraction_update / distraction_archive
settings_update
```

所有工具必须有严格 input schema、结构化 output、明确 description 和一致的 domain error。列表工具必须分页或设置安全上限。

`dashboard_get` 一次返回 active Session、今日统计、selected/current focus Track，以及所有 active Tracks 的 Current Next 与今日投入。

---

## 11. Authentication and security

Required environment variables：

```env
DATABASE_URL=
TIMEOS_WEB_PASSWORD=
TIMEOS_MCP_TOKEN=
TIMEOS_SESSION_SECRET=
```

Optional：`NEXT_PUBLIC_APP_NAME=Time OS`。

### 11.1 Web

- 单用户密码登录，不建立 User 表；
- 密码仅在服务端校验，不存入客户端存储；
- 签发由 Session Secret 保护的 `HttpOnly`、`Secure`、`SameSite=Lax` Cookie；
- Cookie 采用 90 天滑动有效期，活跃使用时续期；
- 提供 Logout；轮换 Secret 会使已有 Cookie 失效；
- 登录接口提供适合 Serverless 的基础速率限制或退避；
- 写请求采用能抵御 CSRF 的同源策略。

### 11.2 MCP

`POST /mcp` 使用 `Authorization: Bearer <TIMEOS_MCP_TOKEN>`。Web Password 和 MCP Token 不可互换。

认证层只向业务层提供 `AuthenticatedContext`，便于未来替换 OAuth 2.1。Settings 只展示 endpoint 和 `YOUR_MCP_TOKEN` 占位配置，不读取或回显 Secret。

---

## 12. Architecture and technology

Required stack：

```text
Next.js + TypeScript
PostgreSQL on Neon
Drizzle ORM + committed Drizzle migrations
Tailwind CSS + shadcn/ui
MCP TypeScript SDK v2 (@modelcontextprotocol/server)
Zod
```

MCP 使用 Streamable HTTP，生产 endpoint 为 `POST /mcp`，并保持 stateless。所有真实状态在 PostgreSQL。

```text
Web UI / Server Actions / Route Handlers / MCP Tools
                       ↓
                 Service Layer
                       ↓
              Drizzle / PostgreSQL
```

关键索引至少覆盖 Goal/Track/Task 排序、Task 状态、Session Track/Task/状态/时间、Distraction session/archive 和 idempotency key。

“全局最多一个 active/paused Session”不能只靠前端检查，必须使用数据库可保证的约束或事务锁策略。

---

## 13. Setup and self-hosting

README 第一屏提供 Deploy with Vercel，并优先解释产品价值。目标流程：

```text
GitHub → Vercel → Neon → Environment Variables → Migration → Login → Setup
```

Repository 提交 migrations。部署负责幂等 migration；Setup 不改 schema。

首次登录后，`setupCompletedAt` 为空则进入 `/setup`。Setup 检查数据库/schema、从浏览器 timezone 提供默认值、设置 default focus/week start、展示 MCP endpoint 并标记完成。失败时给出可操作的修复信息；重复访问允许重新检查和更新。

发布前必须用全新 Vercel Project 和 Neon Database 完成一次真实部署验证，不能只依赖文档假设。

---

## 14. UI and error handling

设计关键词：Calm、Minimal、Fast、Content-first、Keyboard-friendly。

- Desktop 优先，375px mobile 可用；
- Today 只有一个明显 Primary CTA；
- 轻量 Task/Next 更新可以 optimistic；
- Session 与跨实体事务必须等待服务端确认；
- loading、empty、error 和 retry 状态必须可访问、可理解。

Service Layer 返回统一、可序列化的 domain error，至少包括：

```text
ACTIVE_SESSION_EXISTS
SESSION_NOT_FOUND
INVALID_SESSION_STATE
SESSION_TIME_OVERLAP
TASK_NOT_IN_TRACK
TASK_NOT_PENDING
TASK_ALREADY_COMPLETED
INVALID_NEXT_TASK
TRACK_NOT_ACTIVE
GOAL_NOT_ACTIVE
PARENT_HAS_ACTIVE_SESSION
INVALID_POSITION_ORDER
IDEMPOTENCY_KEY_REUSED
UNAUTHORIZED
```

Web 映射成人类可读消息；MCP 返回 code、message 和必要 context，不能只返回 `Something went wrong`。

---

## 15. Acceptance scenarios

### 15.1 Core execution

创建 Goal/Track，Web 或 MCP 批量创建 Tasks，首项自动成为 Next；从 Today 启动，刷新后计时正确；多次 pause/resume；Finish+Completed 后 Session、Task 和 Next 原子更新，History/Stats 立即反映结果。

### 15.2 Active Session and cancel

已有 active/paused Session 时启动第二个返回 `ACTIVE_SESSION_EXISTS` 与现有 Session。Cancel 后不再阻塞，默认 History 与统计不包含它，但审计查询可读取。

### 15.3 Manual and overlap

Web/MCP 均可补录与纠正。重叠时首次不写入并返回冲突；明确确认后保存，统计分别累加。

### 15.4 Current Next integrity

- 完成非 Current Next 不改变 Next；
- 重排不改变 Next；
- complete/skip/archive Current Next 自动推进；
- reopen 不自动抢占 Next；
- 非 pending Task 无法设为 Next。

### 15.5 Parent lifecycle

有 active Session 时不能完成或归档所属 Goal/Track。父级非 active 后不能开始新 Session；重新激活后子项与 Current Next 保持。

### 15.6 Timezone and statistics

跨午夜、周边界和 DST 按真实区间统计；History 只展示一条并归到开始日。

### 15.7 Capability parity

每项 Web 领域操作都有等价 MCP tool，并通过相同 service contract tests。MCP 可独立完成计划、排序、Next、执行/补录/纠正 Session、Distraction、History/Stats 和 Settings。

### 15.8 Fresh deployment

从全新 Vercel 与 Neon 出发：填写环境变量、自动 migration、登录、Setup、创建计划并开始 Focus，全程不执行手动 SQL。

---

## 16. Testing requirements

### Unit

状态机、时间计算、Next advancement、排序、统计切分、幂等和 domain errors。

### Integration

真实 PostgreSQL 测试约束、事务、全局 Session 排他、并发 complete/next set、重叠确认、Service → DB 和 MCP → Service → DB。

### Contract

每项领域能力用同一组案例验证 Web adapter 与 MCP adapter 的输入、输出和错误一致性。

### E2E

- 登录与 Setup；
- Goal → Track → batch Tasks → auto Next；
- Start → refresh → pause/resume → Finish+Complete → Next；
- Cancel 后重新开始；
- History 补录、冲突确认和编辑；
- mobile 375px Focus；
- MCP 完整核心闭环；
- 全新部署 smoke test。

---

## 17. Explicit non-goals

MVP 不包含：

- 内置 AI Chat、LLM API、自动拆解、推荐引擎或 AI summary；
- Calendar、deadline planning、通知或外部日历集成；
- Habit、Pomodoro gamification、XP、等级或奖励；
- Social、Team、Multi-user、Public profile；
- 文件/图片附件、Markdown knowledge base 或富文本；
- Nested subtasks、Kanban、Gantt 或复杂标签；
- 原生移动 App、浏览器扩展；
- hard delete；
- OAuth 2.1 和 Hosted SaaS multi-tenancy。

---

## 18. Core product sentence

> **Time OS remembers the next action and records the work. The AI helps decide what that next action should be.**
