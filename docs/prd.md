# Time OS — MVP PRD

**Version:** 0.1  
**Date:** 2026-09-21  
**Status:** Ready for implementation  
**Working name:** Time OS

---

# 1. Product Summary

Time OS 是一个面向个人的、AI-native 的目标执行与时间管理工具。

它不负责替用户思考，也不在网页内部提供 AI Chat。

产品采用明确的职责分工：

> **AI is the planner. Time OS is the execution system.**

用户通过 ChatGPT 等支持 MCP 的 AI 客户端讨论目标、拆解计划、调整优先级。

Time OS 负责：

- 保存 Goal / Track / Task
- 保存每个 Track 当前唯一的 Next
- 启动和记录 Focus Session
- 管理计时
- 记录执行结果
- 记录 Distraction
- 展示历史与统计
- 通过 MCP 向 AI 暴露完整的读取和写入能力

核心目标不是建立另一个 Todo App，而是解决：

> **“我现在应该做什么？”**

以及：

> **“我上次做到哪里了？”**

---

# 2. Product Principles

## 2.1 Execution First

Time OS 80% 服务于执行，20% 服务于查看和维护计划。

用户进入首页后，首先看到的不是大量任务，而是：

> Current Next → Start Focus

---

## 2.2 One Clear Next

每个 Track 同一时间最多只能有一个 `Current Next`。

例如：

- AI Agent → 第 3 讲：Tool
- Postgres → 1.2 Postgres vs Everyone
- Design → 继续阅读 10 页
- AI Content → 完成第一条 30 秒视频脚本

系统负责记住用户做到哪里。

---

## 2.3 AI Plans, App Stores

Time OS MVP 不包含：

- LLM API
- AI Chat
- AI Breakdown
- Prompt management
- Agent runtime

计划由用户与 ChatGPT 等外部 AI 完成。

AI 通过 MCP 把最终结果写入 Time OS。

---

## 2.4 Low Friction

任何功能都需要问：

> 它是在帮助用户开始执行，还是在制造新的管理工作？

如果属于后者，MVP 不做。

---

# 3. Target User

MVP 目标用户：

- 单用户
- 有多个长期学习 / 工作方向
- 经常面对大量信息和学习资料
- 容易因为不知道下一步做什么而产生启动成本
- 希望利用 10–60 分钟碎片时间
- 已经使用 ChatGPT / Claude / Codex 等 AI
- 希望 AI 可以直接管理自己的执行系统

MVP 首先为项目作者本人设计。

同时代码必须支持：

> GitHub → Deploy with Vercel → Neon → Own Time OS

即任何人可以快速部署自己的独立实例。

---

# 4. Deployment Model

MVP 不设计多租户 SaaS。

采用：

> **One deployment = one user**

每个用户拥有自己的：

- Vercel Project
- Neon PostgreSQL Database
- Time OS deployment
- MCP endpoint
- MCP credential
- Data

因此 MVP 不需要：

- users
- organizations
- workspaces
- memberships
- subscriptions
- roles
- tenant_id

未来如果推出 Hosted SaaS，再增加 multi-tenancy。

---

# 5. Core Domain Model

产品固定采用三级结构：

```text
Goal
  └── Track
        └── Task
```

不支持 Subtask。

不支持任意深度嵌套。

如果一个 Task 仍然太大，应拆成多个平级 Task。

例如：

```text
Goal
成为更强的 AI / Full-stack Builder

Track
AI Agent

Tasks
01 课程脉络
02 Agent 开发概览
03 Tool
04 Mini Cursor
05 MCP
06 MCP Server 实战
...
```

---

# 6. Entity Definitions

## 6.1 Goal

长期方向。

Examples:

- 提升 AI / Full-stack 能力
- 构建 AI 自媒体能力
- 提升产品设计能力

Fields:

```ts
Goal {
  id: UUID
  title: string
  description?: string

  status:
    | "active"
    | "completed"
    | "archived"

  position: number

  createdAt: timestamp
  updatedAt: timestamp
}
```

---

# 6.2 Track

持续推进的一条学习 / 项目线。

Examples:

- AI Agent Course
- Mastering Postgres
- 写给大家的设计书
- AI Video

每个 Track 必须属于一个 Goal。

Fields:

```ts
Track {
  id: UUID
  goalId: UUID

  title: string
  description?: string

  status:
    | "active"
    | "completed"
    | "archived"

  currentTaskId?: UUID

  position: number

  createdAt: timestamp
  updatedAt: timestamp
}
```

核心约束：

```text
一个 Track 同一时间：
currentTaskId = 0 or 1 Task
```

`currentTaskId` 即 Current Next。

---

# 6.3 Task

可以明确完成的执行单元。

Examples:

```text
第 3 讲：Tool
```

```text
1.2 Postgres vs Everyone
```

```text
写第一条 30 秒视频脚本
```

Fields:

```ts
Task {
  id: UUID
  trackId: UUID

  title: string
  description?: string

  status:
    | "pending"
    | "completed"
    | "skipped"
    | "archived"

  position: number

  estimatedMinutes?: number

  resourceType?:
    | "url"
    | "text"

  resourceValue?: string

  note?: string

  completedAt?: timestamp

  createdAt: timestamp
  updatedAt: timestamp
}
```

MVP 不提供：

```text
parentTaskId
```

Task 不允许嵌套。

---

# 6.4 Session

Session 代表一次真实的执行时间。

关系：

```text
Track 1 ─── N Session

Task  0 ─── N Session
```

规则：

> Session 必须关联 Track。

但是：

> Session 可以不关联 Task。

例如：

```text
Track: Postgres
Task: null
Duration: 25m
Note: 临时研究 MVCC
```

正常学习则：

```text
Track: Postgres
Task: 1.2 Postgres vs Everyone
Duration: 18m
```

Fields:

```ts
Session {
  id: UUID

  trackId: UUID
  taskId?: UUID

  status:
    | "active"
    | "paused"
    | "completed"
    | "cancelled"

  source:
    | "web"
    | "mcp"
    | "manual"

  plannedMinutes?: number

  startedAt: timestamp

  pausedAt?: timestamp
  totalPausedSeconds: number

  endedAt?: timestamp
  durationSeconds?: number

  note?: string

  createdAt: timestamp
  updatedAt: timestamp
}
```

---

# 7. Session Invariant

整个 Time OS 同一时间最多只能存在：

```text
1 active/paused session
```

禁止：

```text
AI Agent timer running
+
Postgres timer running
```

同时存在。

数据库 / Service Layer 必须保证这一约束。

---

# 8. Timer Architecture

Timer 不依赖纯客户端倒计时状态。

真实状态来自：

```text
startedAt
pausedAt
totalPausedSeconds
```

前端只负责实时计算显示。

例如：

```text
startedAt = 21:00
currentTime = 21:23
paused = 3 min

elapsed = 20 min
```

因此：

- 浏览器刷新不会丢失 Session
- 关闭浏览器不会停止 Session
- 换设备仍能恢复 Session
- MCP 可以读取当前计时状态

---

# 9. Manual Sessions

必须允许事后补录。

Example：

用户对 ChatGPT 说：

> 我刚刚看了 25 分钟 Postgres。

MCP 可以调用：

```text
session_log
```

直接写入：

```text
duration = 25min
source = manual
```

无需真正启动 timer。

---

# 10. Current Next

这是产品最核心的数据。

每个 Track：

```text
currentTaskId
```

最多指向一个 Task。

Example:

```text
AI Agent
Current Next
→ 第 3 讲 Tool
```

---

# 11. Automatic Next Advancement

Task 有显式顺序：

```text
position
```

例如：

```text
1
2
3
4
5
```

当：

```text
completeTask(taskId)
```

且：

```text
taskId === track.currentTaskId
```

系统寻找：

```text
position > current.position
AND status = pending
```

的第一个 Task。

然后设置为：

```text
track.currentTaskId
```

如果不存在：

```text
currentTaskId = null
```

---

# 12. Manual Next Override

必须支持人工 / MCP 修改 Current Next。

例如用户对 ChatGPT 说：

> Postgres 那边我先跳过这一节，看 Query Plans。

AI 调用：

```text
next_set
```

即可。

自动推进不能阻止人工覆盖。

---

# 13. Task Completion and Session Completion Are Separate

结束 Session：

```text
session_finish()
```

不意味着完成 Task。

例如：

```text
学习 LangGraph 20min
```

但只完成 40%。

Session：

```text
completed
```

Task：

```text
pending
```

只有用户明确确认 Task 完成时：

```text
task_complete()
```

才修改 Task 状态。

---

# 14. Resource

Task 可以拥有一个简单资源。

MVP 只支持：

```text
URL
Text
```

Examples:

```text
https://databaseschool.com/...
```

或：

```text
《写给大家的设计书》第 42 页开始
```

不做：

- 图片
- 文件附件
- Markdown knowledge base
- PDF
- 富文本编辑器

---

# 15. Notes

MVP 有两种 Note。

## Task Note

长期保留在 Task 上。

例如：

```text
这里重点理解 MCP 和普通 Tool 的边界。
```

## Session Note

描述这一次具体执行。

例如：

```text
看完前半部分，理解了 EXPLAIN 的 cost。
```

Time OS 不试图成为 Notion / Obsidian。

---

# 16. Distraction

Focus 过程中提供：

```text
+ Distraction
```

点击后出现一个极轻输入框：

```text
What distracted you?
```

Example:

```text
突然想去看新的 AI 模型
```

Fields:

```ts
Distraction {
  id: UUID
  sessionId: UUID

  text?: string

  createdAt: timestamp
}
```

允许空文本。

空文本代表：

> 用户只是快速记录一次被打断。

MVP 不做：

- distraction category
- severity
- emotion
- productivity score

---

# 17. Information Architecture

MVP 只需要以下主要页面：

```text
/
Today

/goals
Goals

/tracks/:id
Track Detail

/focus/:sessionId
Focus

/history
History

/settings
Settings

/setup
First-run Setup
```

---

# 18. Today Page

Today 是产品首页，也是最重要页面。

目标：

> 打开网页后 5 秒内可以开始执行。

页面结构：

```text
Good evening

Today
82 min focused
3 sessions

──────────────

Current Focus

AI Agent
第 3 讲：Tool

Estimated 20 min

[ Start Focus ]

──────────────

Other Next

Postgres
1.2 Postgres vs Everyone
12 min

Design
继续阅读
20 min

AI Content
第一条视频脚本
30 min
```

Current Focus 可以默认：

- 最近使用 Track
- 或用户手动选择

但不能在 MVP 做复杂 AI ranking。

---

# 19. Track Cards

Today 展示 Active Tracks。

每张 Track Card 只显示：

```text
Track name

Current Next

Estimated Time

Start
```

禁止直接把整个 Task backlog 展开在首页。

---

# 20. Start Focus

点击：

```text
Start Focus
```

默认使用 Task 的：

```text
estimatedMinutes
```

如果没有预计时间：

提供：

```text
10
20
30
45
60
Custom
```

这些是计划时长。

Timer 到零后：

> 不自动结束 Session。

可以进入 overtime。

---

# 21. Focus Page

Focus Page 应极简。

Example：

```text
AI Agent

第 3 讲
Tool

18:42

Target
20 min

────────────────

[ Pause ]

[ + Distraction ]

────────────────

Quick note...

────────────────

[ Finish ]
```

不要显示：

- Sidebar
- Goals
- Statistics
- Backlog
- Dashboard

Focus 页面应该尽可能减少干扰。

---

# 22. Pause / Resume

支持：

```text
active
↓
paused
↓
active
```

Paused 时间：

不计入实际 Focus Duration。

---

# 23. Finish Session Flow

点击 Finish：

打开轻量 Review。

```text
Focus complete

Actual
24 min

What did you do?
[ Session note ]

Task progress

○ Continue later
● Completed
○ Skip

Next
第 4 讲 Mini Cursor

[ Save ]
```

如果选择：

```text
Completed
```

执行事务：

```text
finishSession()
completeTask()
advanceNext()
```

如果：

```text
Continue later
```

只执行：

```text
finishSession()
```

---

# 24. Goals Page

展示：

```text
Goal
 ├ Track
 ├ Track
 └ Track
```

例如：

```text
AI / Full-stack Builder

  AI Agent
  Mastering Postgres

Design

  写给大家的设计书

Content

  AI Video
```

Goals 页面主要用于：

- 浏览
- 创建
- 编辑
- Archive
- 调整顺序

不是主要执行入口。

---

# 25. Track Detail

Track 页面负责完整任务列表。

Example：

```text
Mastering Postgres

Current Next
1.2 Postgres vs Everyone

──────────────

✓ 1.1 Introduction
→ 1.2 Postgres vs Everyone
  1.3 Why Postgres
  1.4 ...
```

支持：

- Add Task
- Edit Task
- Complete
- Skip
- Archive
- Drag reorder
- Set as Next
- Open resource
- Edit note

---

# 26. History

History 按天展示真实 Session。

Example：

```text
September 21

AI Agent
21:02 – 21:27
25 min

Postgres
18:40 – 19:05
25 min

Design
13:20 – 13:40
20 min

Total
70 min
```

支持简单筛选：

```text
Date
Track
```

---

# 27. Statistics

MVP 只提供：

## Today Focus

```text
82 min
```

## Weekly Focus

```text
7h 24m
```

## Track Distribution

```text
Agent       3h 10m
Postgres    2h 25m
Design      1h 05m
Content     44m
```

## Completed Tasks

```text
8 this week
```

## Focus Days

```text
6 / 7 days
```

不提供：

```text
Productivity Score
Efficiency Score
AI Score
Focus Quality Score
```

---

# 28. Database Schema

Recommended tables:

```text
goals
tracks
tasks
sessions
distractions
app_settings
```

---

# 29. app_settings

单例配置。

```ts
AppSettings {
  id: "default"

  timezone: string

  defaultFocusMinutes: number

  weekStartsOn:
    | 0
    | 1

  createdAt: timestamp
  updatedAt: timestamp
}
```

Timezone 必须保存为 IANA timezone：

```text
Asia/Tokyo
Asia/Shanghai
America/Los_Angeles
```

统计日期必须基于用户 timezone，而不是数据库 UTC 日期直接切分。

数据库 timestamp 统一存 UTC。

---

# 30. Database Indexes

至少建立：

```text
tasks(track_id, position)

tasks(track_id, status)

sessions(track_id, started_at)

sessions(task_id)

sessions(started_at)

distractions(session_id)

tracks(goal_id, position)
```

---

# 31. Service Layer

业务逻辑禁止直接写在：

```text
React component
```

或：

```text
MCP tool handler
```

必须统一进入 Service Layer。

Recommended:

```text
src/
  services/
    goals.ts
    tracks.ts
    tasks.ts
    sessions.ts
    distractions.ts
    stats.ts
```

例如：

```ts
completeTask(taskId)
```

既被：

```text
Web UI
```

调用，也被：

```text
MCP task_complete
```

调用。

业务逻辑只能有一份。

---

# 32. Architecture

```text
                 ┌───────────────┐
                 │    Web UI     │
                 │   Next.js     │
                 └───────┬───────┘
                         │
                         ▼
                ┌────────────────┐
                │ Service Layer  │
                └───────┬────────┘
                        │
            ┌───────────┴──────────┐
            │                      │
            ▼                      ▼
      PostgreSQL              MCP Tools
        Neon                       │
                                   ▼
                              MCP Client
                                   │
                                   ▼
                              ChatGPT / AI
```

---

# 33. Tech Stack

Required:

```text
Next.js
TypeScript

PostgreSQL
Neon

Drizzle ORM
Drizzle Kit

Tailwind CSS
shadcn/ui

@modelcontextprotocol/server
Zod
```

MCP 使用官方 TypeScript SDK v2：

```text
@modelcontextprotocol/server
```

不使用旧版：

```text
@modelcontextprotocol/sdk
```

新项目使用 Streamable HTTP。

MCP 应设计为 stateless server。

所有真实状态存 PostgreSQL。

---

# 34. MCP Endpoint

Production endpoint：

```text
POST /mcp
```

推荐：

```text
app/mcp/route.ts
```

MCP handler 不保存：

- active user state
- timer state
- session memory

这些全部来自 PostgreSQL。

因此适合 Serverless 环境。

---

# 35. MCP Design Principle

MCP 是 Time OS 的一级接口。

Web UI 和 MCP 必须拥有基本相同的数据能力。

用户可以完全不打开网页，通过 AI 使用 Time OS。

Example：

```text
User:
我最近有哪些学习方向？

AI:
→ tracks_list
```

```text
User:
帮我给 Postgres 加三节任务。

AI:
→ tasks_create
```

```text
User:
刚刚学习了 25 分钟 Postgres。

AI:
→ session_log
```

---

# 36. MCP Tools — Read

## dashboard_get

最常用的上下文接口。

Returns:

```ts
{
  activeSession,
  todayFocusSeconds,
  tracks: [
    {
      id,
      title,
      currentNext,
      todayFocusSeconds
    }
  ]
}
```

典型请求：

> 我现在有 20 分钟，应该做什么？

AI 一次调用即可获得主要上下文。

---

## goals_list

Returns：

```text
Active goals
```

支持：

```ts
includeArchived?: boolean
```

---

## tracks_list

Input:

```ts
{
  goalId?: string
  status?: string
}
```

---

## tasks_list

Input:

```ts
{
  trackId: string
  status?: string
}
```

必须按：

```text
position ASC
```

返回。

---

## next_get

Input：

```ts
{
  trackId?: string
}
```

如果不传 Track：

返回所有 Active Tracks 的 Current Next。

---

## session_get_active

返回当前 active / paused session。

---

## sessions_list

Input：

```ts
{
  from?: datetime
  to?: datetime
  trackId?: UUID
  taskId?: UUID
}
```

---

## stats_get

Input:

```ts
{
  period:
    | "today"
    | "week"
    | "month"
    | "custom"

  from?: datetime
  to?: datetime
}
```

Returns:

```ts
{
  totalFocusSeconds,
  sessionCount,
  completedTaskCount,
  focusDays,
  byTrack
}
```

---

# 37. MCP Tools — Write

## goal_create

Input:

```ts
{
  title: string
  description?: string
}
```

---

## goal_update

Input:

```ts
{
  goalId: UUID
  title?: string
  description?: string
  status?: "active" | "completed" | "archived"
}
```

---

## track_create

Input:

```ts
{
  goalId: UUID
  title: string
  description?: string
}
```

---

## track_update

Input:

```ts
{
  trackId: UUID
  title?: string
  description?: string
  status?: "active" | "completed" | "archived"
}
```

---

# 38. Batch Task Creation

AI 拆解计划时，最常见操作不是创建一个 Task，而是一次创建多个。

因此必须提供：

## tasks_create

Input:

```ts
{
  trackId: UUID

  tasks: [
    {
      title: string
      description?: string
      estimatedMinutes?: number

      resourceType?: "url" | "text"
      resourceValue?: string

      note?: string
    }
  ]

  setFirstAsNext?: boolean
}
```

限制：

```text
1–50 tasks / call
```

写入必须保持数组顺序。

这是 AI 规划 → Time OS 的核心接口之一。

---

# 39. task_update

Input:

```ts
{
  taskId: UUID

  title?: string
  description?: string

  estimatedMinutes?: number | null

  resourceType?: "url" | "text" | null
  resourceValue?: string | null

  note?: string | null

  position?: number
}
```

---

# 40. task_complete

Input：

```ts
{
  taskId: UUID
}
```

Behaviour：

```text
mark completed

if currentNext:
    automatically advance currentNext
```

返回：

```ts
{
  completedTask,
  nextTask
}
```

---

# 41. task_skip

与 complete 类似：

```text
status = skipped
```

如果当前 Task：

自动推进 Next。

---

# 42. next_set

Input:

```ts
{
  trackId: UUID
  taskId: UUID | null
}
```

必须验证：

```text
task.trackId === trackId
```

否则拒绝。

---

# 43. session_start

Input:

```ts
{
  trackId: UUID
  taskId?: UUID
  plannedMinutes?: number
}
```

Validation：

```text
Track exists
Task belongs to Track
No active/paused session exists
```

Returns:

```text
Session
```

---

# 44. session_pause

无需 sessionId 也可以默认操作当前 Active Session。

Returns：

```text
paused session
```

---

# 45. session_resume

恢复当前 paused session。

---

# 46. session_finish

Input:

```ts
{
  sessionId?: UUID
  note?: string
}
```

如果不传：

结束当前 Active / Paused Session。

必须计算：

```text
actual duration
```

不自动完成 Task。

---

# 47. session_log

用于事后补录。

Input:

```ts
{
  trackId: UUID
  taskId?: UUID

  durationMinutes: number

  note?: string

  endedAt?: datetime
}
```

如果没传：

```text
endedAt = now
```

然后：

```text
startedAt =
endedAt - duration
```

source：

```text
manual / mcp
```

---

# 48. distraction_log

Input：

```ts
{
  sessionId?: UUID
  text?: string
}
```

未传 sessionId：

使用当前 Active / Paused Session。

没有当前 Session：

返回明确错误。

---

# 49. MCP Tool Metadata

所有 MCP Tools 必须：

- 有清晰名称
- 有明确 description
- 有严格 input schema
- 有结构化 output
- 不返回不必要的大段文本

Read tools：

```text
readOnlyHint = true
```

Write tools：

```text
readOnlyHint = false
```

MVP 不暴露 Hard Delete MCP tool。

因此不会有：

```text
goal_delete
track_delete
task_delete
```

使用：

```text
archive
```

代替。

---

# 50. Example MCP Conversation

User：

```text
我现在有 20 分钟，做什么比较合适？
```

ChatGPT：

```text
dashboard_get
```

Result：

```text
AI Agent
第 3 讲 Tool
estimated 18m

Postgres
1.2 Postgres vs Everyone
estimated 12m

Design
阅读下一部分
estimated 25m
```

AI 根据聊天上下文帮助用户选择。

Time OS 本身不做选择。

---

User：

```text
那我学 Postgres。
```

调用：

```text
session_start(
  trackId=postgres,
  taskId=1.2,
  plannedMinutes=20
)
```

---

20 分钟之后用户：

```text
看完了，实际上学了 23 分钟。
```

调用：

```text
session_finish()
```

然后：

```text
task_complete()
```

系统自动推进：

```text
Next → 1.3
```

---

# 51. Authentication — Web

MVP 不做 User Account。

使用单用户 deployment secret。

Environment variable：

```text
TIMEOS_WEB_PASSWORD
```

用户访问 Time OS：

```text
/login
```

输入密码。

成功后生成：

```text
Secure
HttpOnly
SameSite
```

session cookie。

密码不得发送给 Client JavaScript 保存。

禁止：

```text
localStorage password
```

---

# 52. Authentication — MCP

独立：

```text
TIMEOS_MCP_TOKEN
```

基础 MCP client 可以通过：

```text
Authorization: Bearer <token>
```

访问。

Web Password 和 MCP Token 必须分开。

原因：

MCP token 可能被配置在第三方 AI client 中。

泄漏 MCP token 不应该自动等同于获得 Web 登录密码。

---

# 53. ChatGPT Integration Constraint

Time OS MCP 本身按照完整：

```text
READ + WRITE
```

能力设计。

但 ChatGPT 是否允许某一用户使用自定义 MCP 的 write action，由当前 ChatGPT 产品权限决定。

截至 PRD 编写时，ChatGPT 的完整自定义 MCP write/modify 能力主要面向支持 full MCP 的 workspace 计划；其他客户端或 OpenAI API 可以独立支持 MCP。该限制属于 AI Client integration concern，不属于 Time OS Domain Model。

因此核心架构不得针对某个 ChatGPT 套餐做特殊设计。

---

# 54. Future Authentication Compatibility

为了未来公开传播，认证层必须可替换。

MVP：

```text
Bearer token
```

Future：

```text
OAuth 2.1
```

Service Layer 和 MCP tools 不应该知道具体 authentication mechanism。

应该只接受：

```ts
AuthenticatedContext
```

MCP OAuth 属于未来 enhancement，而非 MVP blocker。

---

# 55. Settings Page

显示：

```text
General

Timezone
Asia/Tokyo

Default Focus
20 min
```

以及：

```text
MCP

Endpoint
https://xxxx.vercel.app/mcp

Authentication
Bearer Token

[ Copy MCP config ]
```

出于安全原因：

网页不能读取并显示：

```text
TIMEOS_MCP_TOKEN
```

完整值。

Copy config 使用：

```text
YOUR_MCP_TOKEN
```

placeholder。

---

# 56. First-run Setup

第一次打开：

```text
/setup
```

检查：

```text
Database connected
✓

Schema ready
✓

Timezone
[ Asia/Tokyo ]

Default focus
[ 20 min ]

MCP endpoint
https://xxx.vercel.app/mcp

[ Finish Setup ]
```

不需要 AI 配置。

---

# 57. One-click Deployment

README 第一屏提供：

```text
Deploy with Vercel
```

目标流程：

```text
GitHub
↓
Deploy
↓
Create Vercel Project
↓
Connect / Create Neon Database
↓
Environment Variables
↓
Run migrations
↓
Deploy
↓
Time OS ready
```

Vercel 当前已有官方 Neon 模板，可在 Deploy 流程中建立 Project、连接 Neon integration 并 provision database，因此 Time OS 应遵循同类部署模式。

---

# 58. Required Environment Variables

```env
DATABASE_URL=

TIMEOS_WEB_PASSWORD=

TIMEOS_MCP_TOKEN=
```

Optional:

```env
NEXT_PUBLIC_APP_NAME=Time OS
```

MVP 不需要：

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
```

---

# 59. Database Migration

Repository 必须 commit Drizzle migrations。

Deployment pipeline：

```text
install
↓
db:migrate
↓
next build
```

首次部署必须自动建立：

```text
goals
tracks
tasks
sessions
distractions
app_settings
```

用户不应该需要：

- 打开 Neon SQL Editor
- 手动复制 SQL
- 手动创建表

---

# 60. Repository Structure

Recommended：

```text
src/
├── app/
│   ├── page.tsx
│   ├── goals/
│   ├── tracks/[id]/
│   ├── focus/[id]/
│   ├── history/
│   ├── settings/
│   ├── setup/
│   └── mcp/
│       └── route.ts
│
├── components/
│
├── db/
│   ├── index.ts
│   ├── schema.ts
│   └── migrations/
│
├── services/
│   ├── goals.ts
│   ├── tracks.ts
│   ├── tasks.ts
│   ├── sessions.ts
│   ├── distractions.ts
│   └── stats.ts
│
├── mcp/
│   ├── server.ts
│   ├── auth.ts
│   └── tools/
│
└── lib/
```

---

# 61. UI Style

Design goals:

```text
Calm
Minimal
Fast
Content-first
Keyboard-friendly
```

Avoid typical productivity dashboard clutter。

Prefer：

- large whitespace
- strong typography hierarchy
- restrained borders
- low visual noise
- clear primary action

Today 页面最多一个明显 Primary CTA：

```text
Start Focus
```

---

# 62. Responsive Design

Desktop 是主要使用场景。

必须同时保证 mobile usable。

Focus page 在 Mobile 上尤其重要。

最低支持：

```text
375px
```

---

# 63. Keyboard Interaction

Recommended MVP shortcuts：

```text
Space
Pause / Resume

D
Log Distraction

F
Finish

Esc
Close dialog
```

不能在用户输入 Note 时触发 shortcut。

---

# 64. Loading and Optimistic UI

Task update、Next update 等轻操作：

允许 optimistic UI。

以下操作必须等待服务器确认：

```text
session_start
session_finish
task_complete + auto advance
```

因为它们涉及重要状态。

---

# 65. Error Handling

Service Layer 返回统一 domain error。

Examples：

```text
ACTIVE_SESSION_EXISTS

SESSION_NOT_FOUND

TASK_NOT_IN_TRACK

TASK_ALREADY_COMPLETED

INVALID_NEXT_TASK

TRACK_ARCHIVED
```

Web UI：

转换为人类可理解的信息。

MCP：

返回明确 structured error。

禁止只返回：

```text
Something went wrong
```

---

# 66. Transactions

以下操作必须原子化：

## Complete Current Task

```text
mark task complete
+
find next
+
update currentTaskId
```

## Finish + Complete from Web Review

```text
finish session
+
complete task
+
advance next
```

任何一步失败：

整个事务回滚。

---

# 67. Data Integrity Rules

必须满足：

1. Track 必须属于 Goal。

2. Task 必须属于 Track。

3. Session 必须属于 Track。

4. 如果 Session 同时有 Task：
   
   ```text
   task.trackId === session.trackId
   ```

5. `currentTaskId` 必须属于对应 Track。

6. Completed / skipped / archived Task 不能成为 Current Next。

7. 同时最多一个 Active / Paused Session。

8. duration 不能为负。

9. estimatedMinutes 必须 > 0。

---

# 68. What MVP Explicitly Does NOT Include

不做：

- AI Chat
- AI model API
- AI automatic planning
- AI recommendation engine
- AI summary
- Calendar
- Deadline planning
- Google Calendar integration
- Habit tracking
- Pomodoro gamification
- XP
- Level
- Streak rewards
- Social
- Team
- Multi-user
- Public profile
- File attachments
- Image attachments
- Markdown knowledge base
- Rich text notes
- Nested subtasks
- Kanban
- Gantt
- Complex tagging
- Notifications
- Mobile app
- Browser extension

---

# 69. MVP Success Definition

MVP 成功不以“功能数量”衡量。

核心闭环必须非常顺：

```text
Create Track
↓
Create Tasks
↓
Set Next
↓
Start Focus
↓
Finish Session
↓
Complete Task
↓
Next automatically advances
↓
History records actual work
```

同时：

```text
ChatGPT / MCP client
```

能够执行相同操作。

---

# 70. Primary Acceptance Test

完成 MVP 后必须能够完成以下真实场景：

## Scenario A — Course

创建：

```text
Goal
AI / Full-stack

Track
Mastering Postgres
```

通过 MCP 一次写入：

```text
1.1 Introduction
1.2 Postgres vs Everyone
1.3 ...
```

Current Next：

```text
1.1 Introduction
```

用户点击：

```text
Start Focus
```

学习 17 分钟。

Finish。

选择：

```text
Completed
```

系统自动：

```text
1.1 completed
Next = 1.2
```

History 出现：

```text
Postgres — 17 min
```

---

# 71. Acceptance Test — MCP

AI client 可以：

```text
dashboard_get
```

获得当前状态。

调用：

```text
session_log
```

记录：

```text
25m Postgres
```

调用：

```text
task_complete
```

完成 Current Task。

再次：

```text
next_get
```

必须返回下一 Task。

整个过程无需打开 Web App。

---

# 72. Acceptance Test — Active Session

当已有：

```text
AI Agent session active
```

再次：

```text
session_start(Postgres)
```

必须失败：

```text
ACTIVE_SESSION_EXISTS
```

并返回现有 session 基本信息。

---

# 73. Acceptance Test — Refresh

用户启动 Focus。

10 分钟后刷新浏览器。

Timer 必须继续正确显示。

不能重新从：

```text
20:00
```

开始。

---

# 74. Acceptance Test — Distraction

Focus 中点击：

```text
+ Distraction
```

输入：

```text
想刷 Twitter
```

History / Session Detail 必须可以看到这条记录。

MCP 也必须可以查询。

---

# 75. Acceptance Test — One-click Deploy

全新用户：

```text
Click Deploy with Vercel
```

连接 Neon。

填写 required secrets。

Deployment success。

访问 URL。

登录。

完成 setup。

创建 Goal。

创建 Track。

开始 Focus。

过程中不需要执行任何手动 SQL。

---

# 76. Development Phases

## Phase 1 — Foundation

实现：

```text
Next.js
Tailwind
shadcn
Drizzle
Neon
schema
migration
single-user auth
```

完成后可以：

```text
login
create Goal
create Track
create Task
```

---

## Phase 2 — Execution Core

实现：

```text
Current Next
Task ordering
Start Session
Pause
Resume
Finish
Manual Session
Automatic Next
```

这是最重要 Phase。

---

## Phase 3 — Focus UX

实现：

```text
Today
Focus Page
Review
Distraction
```

到这里产品应该已经可以日常使用。

---

## Phase 4 — History

实现：

```text
History
Today stats
Weekly stats
Track distribution
```

---

## Phase 5 — MCP

使用：

```text
@modelcontextprotocol/server
```

实现：

```text
/mcp
```

以及所有核心 read/write tools。

MCP 使用现有 Service Layer。

禁止复制业务逻辑。

---

## Phase 6 — Self-host Experience

实现：

```text
README
Deploy with Vercel
Neon provisioning instructions
.env.example
automatic migrations
/setup
MCP setup instructions
```

---

# 77. Testing Requirements

至少：

## Unit Tests

重点测试 Service Layer：

```text
completeTask
advanceNext
startSession
pauseSession
resumeSession
finishSession
```

## Integration Tests

测试：

```text
DB constraints
transactions
MCP tool → service → DB
```

## E2E

至少一个完整：

```text
Create Track
→ Start
→ Finish
→ Complete
→ Next advances
```

流程。

---

# 78. README Requirements

README 顶部：

```text
Time OS

Your execution layer for AI-assisted planning.
```

然后：

```text
[ Deploy with Vercel ]
```

紧接：

```text
What it does
```

说明：

> Plan with ChatGPT. Execute with Time OS.

避免首先展示技术架构。

---

# 79. Product Positioning

对普通用户：

> A focus and progress system that always remembers what you should do next.

对技术用户：

> A self-hosted personal execution backend for AI assistants.

对开发者：

> A MCP-native productivity database with a lightweight execution UI.

---

# 80. North Star

产品最终希望形成的体验：

用户打开 ChatGPT：

> 我想把 Postgres 系统学一下。

AI 与用户讨论后：

```text
→ create Goal / Track
→ create Tasks
→ set Next
```

第二天用户问：

> 我现在只有 20 分钟。

AI：

```text
→ dashboard_get
```

然后结合上下文建议一个任务。

用户：

> 行，就这个。

AI：

```text
→ session_start
```

20 分钟后：

> 看完了。

AI：

```text
→ session_finish
→ task_complete
```

Time OS 自动推进下一项。

网页负责：

> 让用户执行时有一个安静、可靠、可计时的界面。

AI 负责：

> 和用户一起思考该做什么。

---

# 81. Core Product Sentence

所有实现决策都应该回到这一句话：

> **Time OS remembers the next action and records the work. The AI helps decide what that next action should be.**