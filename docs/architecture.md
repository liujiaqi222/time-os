# Time OS 模块与架构地图

本文件记录代码里实际落地的架构模块与接口约定，供架构评审、重构与新功能开发参考。领域语言定义请见根目录 `CONTEXT.md`，产品规格请见 `docs/prd.md`。

## Service 层模块地图

Web（server actions / pages）和 MCP（tools）都只通过模块 interface 操作领域数据，不直接查表。

| 模块 | interface 概要 | 职责边界 |
| --- | --- | --- |
| `services/session` | Session 状态机：get/start/pause/resume/finish/cancel/note | Session 生命周期、事务、`session:` 锁；通过幂等模块执行 |
| `services/history` | list/detail/log/update/listTargets | 历史读模型、手动补录/纠错、半开区间 cursor 分页 |
| `services/statistics` | `getStatistics` | today/week/month/custom 唯一统计口径；时区折算、有效专注区间聚合 |
| `services/distraction` | create/list/update/archive | Distraction 读写；无 sessionId 时默认打到当前运行中 Session |
| `services/planning` | Goal/Task CRUD、reorder、分页 | 计划维护；Task 直接归属 Goal；reorder 与分页经 positioned-list |
| `services/positioned-list` | `renumberPositions` / `listPositionPage` | position 表的两段式重编号、完整性校验和 cursor 分页 |
| `services/idempotency` | `withIdempotency` / `requestHashOf` | 幂等操作的 claim / replay / record 纪律实现 |
| `services/settings` | get/update/checkSchema | appSettings 表的统一维护 |
| `services/service-kit` | `parsed` / `invalid` / `lockScope` / `Transaction` | 服务层公共 plumbing |
| `shared/focus-intervals` | `computeFocusIntervals`（纯函数） | 跨午夜折算、实时折算、专注时长数学 |

## 前端模块地图

- `components/today/` — 执行首页 composition：计时器、阶段状态、目标选择与接续提示。
- `components/focus/` — 计时与专注交互组件：快捷键、状态同步、打断卡片。
- `components/goals/` — 目标与任务管理：列表、排序、行内编辑与归档。
- `components/history/` — 足迹与历史记录：活动日历、投入分布、补录纠错。

## 约定

- 实体类型（`Goal`/`Task`/`Session`/`Distraction`/`AppSettings`）只在 `db/schema.ts` 定义一次，各模块按需 re-export。
- 跨模块组合读走对方的 interface，不绕过查表；例外是本模块自己拥有的表。
- 领域错误统一使用 `DomainError`，经 contract adapter 序列化为 `Result`。
- 前端 hook 不直接 import server action 之外的任何服务端代码；action 作为参数注入。
