# Time OS — 领域与模块词汇

产品语言见 `docs/prd.md`;本文件记录代码里实际落地的领域术语和模块地图。架构评审、重构和新代码命名以这里为准。

## 领域术语(与 PRD §4 一致)

- **Goal / Track / Task** — 固定三级结构;不支持嵌套。用 archive,不用 hard delete。
- **Current Next** — Track 上唯一的显式执行指针(`tracks.currentTaskId`),指向本 Track 内 pending 的 Task。产品核心不变量:同一时间每条推进线只有一个"下一步"。
- **Session** — 一次真实执行计时。全局最多一个 active/paused(数据库唯一索引 + advisory lock 双保险)。
- **Distraction** — Session 期间的打断记录,可空文本,只 archive。
- **AppSettings** — 单行配置表(id 固定 `default`):timezone、默认专注时长、周起始、selectedTrackId。

## Service 层模块地图(2026-09 架构评审落地)

Web(server actions / pages)和 MCP(tools)都只通过下面的模块 interface 操作领域数据,不直接查表。

| 模块                       | interface 概要                                                                           | 职责边界                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `services/session`         | Session 状态机:get/start/pause/resume/finish/cancel/finishSessionReview/note             | Session 生命周期、事务、`session:`/`sessions:running`/`sessions:timeline` 锁;startSession 经幂等模块执行                         |
| `services/history`         | list/detail/log/update/listTargets                                                       | 历史读模型、手动补录/纠错、半开区间 cursor 分页、Task/Track 关系和 overlap 确认;session_log 复用幂等模块                         |
| `services/statistics`      | `getStatistics`                                                                          | today/week/month/custom 唯一统计口径;timezone/DST/跨午夜实时折算、Session/Task/Focus Days/Track 聚合                             |
| `services/distraction`     | 4 个方法                                                                                 | Distraction 读写;唯一实现「无 sessionId 时默认打到当前运行中 Session」的目标解析规则                                             |
| `services/dashboard`       | `getDashboard`                                                                           | Today 读模型;组合 Session、Settings 与 Statistics interface;Today 不另建统计口径                                                 |
| `services/current-next`    | `currentNextForTrack` / `transitionTask`                                                 | Current Next 指针的读与推进的唯一实现;自带 `track:` 锁纪律。Planning 的 complete/skip/archive 和 Session 的 finish review 都调它 |
| `services/planning`        | Goal/Track/Task CRUD、reorder、分页、`getNextForTrack` / `getNextForAllTracks`、next set | 计划维护;Task 状态转换只经 current-next;reorder 与分页经 positioned-list                                                         |
| `services/positioned-list` | `renumberPositions` / `listPositionPage`(内部实现模块)                                   | 三张 position 表的两段式重编号、完整性校验和 cursor 分页,各只有一份;泛型不进外部 interface                                       |
| `services/idempotency`     | `withIdempotency` / `requestHashOf`                                                      | 幂等操作的 claim / replay / record 纪律的唯一实现;session_start 和 tasks_create 在用,T04 的 session_log 直接复用                 |
| `services/settings`        | get/update/setSelectedTrack/checkSchema                                                  | appSettings 表的唯一主人(selectedTrackId 的写也在这里)                                                                           |
| `services/service-kit`     | `parsed` / `invalid` / `lockScope` / `Transaction`                                       | 服务层公共 plumbing,全仓库只有这一份                                                                                             |
| `shared/focus-intervals`   | `computeFocusIntervals`(纯函数)                                                          | 跨午夜折算、实时折算、按 Track 聚合的专注时长数学;T04 History/Stats 复用                                                         |

## 前端模块地图

- `components/focus-view.tsx` — Focus 页 composition:计时器、快捷键、Quick Note 卡片,以及各子模块的接线(约 340 行,原为 867 行单文件)。
- `components/focus/modal.tsx` — 弹窗外壳:overlay、aria、Esc 关闭、Tab focus trap,写一次全站复用。
- `components/focus/review-dialog.tsx` / `cancel-dialog.tsx` — 纯展示弹窗,受控 props。
- `components/focus/distraction-panel.tsx` — 打断卡片:快速记录表单 + 列表 + 行内编辑。
- `components/focus/use-focus-session.ts` / `use-note-autosave.ts` / `use-distractions.ts` / `use-session-review.ts` — 各关注点的状态 hook;server actions 全部注入,单测无需网络。

## 约定

- 实体类型(`Goal`/`Track`/`Task`/`Session`/`Distraction`/`AppSettings`)只在 `db/schema.ts` 定义一次,各模块按需 re-export。
- 跨模块组合读(如 dashboard、getSession)走对方的 interface,不绕过查表;例外是本模块自己拥有的表。
- 领域错误统一 `DomainError`(code 列表见 PRD §14),经 contract adapter 序列化为 `Result`。
- 前端 hook 不直接 import server action 之外的任何服务端代码;action 作为参数注入。

## 架构评审记录

2026-09-23 评审识别出六个深化候选,已全部落地;上表即落地后的模块地图。历史:session/planning 曾是各 900+ 行的巨型 module(Current Next 规则两份、reorder 三份、幂等两份),FocusView 曾是 867 行单文件。
