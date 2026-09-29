# T06 — 目标直连的执行首页与正计时闭环

**类型：**全栈功能重构。

**依赖：**当前代码基线；本票是 v3 开发起点。

**规范：**[PRD](../../prd.md) §3、§5、§6.1–6.2、§6.5、§9–11。

**后续：**T07 引导、T08 番茄钟、T09 足迹、T10 完整管理。

## 交付结果

已有一个目标时，用户在首页直接开始正计时，暂停 / 恢复、写笔记、结束；结束先保存，可选完成任务和留下接续提示。下次访问恢复当前计时或上次工作。整个流程无需 Track，也无需完整回顾表单。

本票同时建立新数据模型与共用领域契约。前后端可以重写，不添加旧数据迁移、旧 API adapter 或隐藏默认 Track。

## 当前代码入口

- `src/db/schema.ts`、`drizzle/`、`scripts/migrate.ts`：当前 Task / Session 强依赖 Track。
- `src/services/planning.ts`、`current-next.ts`、`session.ts`、`dashboard.ts`、`settings.ts`：改为目标归属与统一选择解析。
- `src/shared/session-timer.ts`、`focus-intervals.ts`、`schemas/`：新正计时、区间、请求与响应契约。
- `src/components/today-view.tsx`、`focus-view.tsx`、`focus/`、`app-shell.tsx`、`primary-nav.tsx`：合并执行体验。
- `src/app/(app)/today/page.tsx`、`session-actions.ts`、`src/app/focus/[id]/page.tsx`、`src/mcp/server.ts`。
- 现有 History、Goals、Settings 的查询必须接通新模型，不能因本票删 Track 导致其他页面编译失败或查询丢记录。完整视觉分别在 T09 / T10 交付。

路径只用于定位，允许重新划分模块。

## 实施步骤

### 1. 直接建立目标模型与初始化路径

- [ ] Task 增加必需 goalId，Session 增加必需 goalId 与可选 taskId；移除 Track 强依赖、Track 表 / 领域服务 / MCP 注册与按 Track 的 Current Next。
- [ ] 约束 Session.taskId 对应 Task.goalId 必须等于 Session.goalId。Task 位置改为目标内唯一、连续排序。
- [ ] Session 保留 timer/manual 与 web/mcp 两个维度，增加 intent、resumeHint、timerMode、timeBasis 与写入版本能力。
- [ ] 为 observed Session 存储真实 focus intervals。start 打开区间，pause / finish 关闭，resume 新开；不能延后到 T08 才精确记录。
- [ ] 全实例未结束 Session 排他，数据库 / 事务共同保证；Goal / Task 状态变更与开始使用一致锁顺序。
- [ ] 建立服务端持久化选择 `{goalId, taskId}`。请求省略 taskId 代表自动解析，显式 null 代表仅围绕目标；清空是独立操作。
- [ ] 保留目标状态、任务状态、资源、笔记、打断与鉴权能力；给这些领域建立新库 seed。开发数据库 schema 可直接更新，本票不写升级回填脚本。
- [ ] 记录新 schema 的建库方法，测试从空数据库初始化。不要为兼容旧数据保留第二套字段或写路径。

### 2. 最小计划能力与选择服务

- [ ] Goal create/get/list/update 与 Task create/list/update/complete 等基础服务使用新契约，创建支持 idempotencyKey。基础页面能建立一个目标和快速添加任务，T07 替换成完整三幕体验。
- [ ] 实现 PRD §5.2 的确定性解析，分清 active Session、有效显式选择、同目标下一任务、最近目标和首个目标。
- [ ] goal-only 选择不被后来新建任务或重排覆盖；不传 taskId 则采用自动规则。
- [ ] 完成当前选择的 Task 与推进选择原子执行；完成非当前 Task 不抢占。任务恢复不自动成为当前选择。
- [ ] 关联未结束 Session 的 Task 不允许完成 / 跳过 / 归档；Goal 同样不能完成 / 归档。先结束后再做这些动作。
- [ ] 任务目标不匹配、非 pending、非 active Goal 均返回领域错误，Web/MCP 行为一致。

### 3. 正计时与结束服务

- [ ] `session_start` 输入至少为 goalId、timerMode=stopwatch 与可选 taskId / intent / idempotencyKey；省略或 null taskId 都是 goal-only，关联任务须明确 id。它不沿用 selection_set 的省略自动选择语义。成功写入后才开始客户端显示。
- [ ] pause / resume / finish / cancel 支持重复调用与响应丢失后的重试，无重复 Session 或区间。
- [ ] start / finish 使用服务端时间；响应提供 serverNow、权威时长、status、可用操作与版本。
- [ ] `session_finish` 只结束并保存，不再接受默认 Task outcome。任务完成是独立动作。
- [ ] 完成后可独立保存 resumeHint；其失败不会撤销已保存时间。
- [ ] note 自动保存与 finish 提交采用内容版本 / 请求排序，不能让较早请求覆盖较新内容。并发客户端冲突保留输入并可恢复。
- [ ] 零有效时长可保留记录，不计有效次数；cancel 不物理删除，退出全局排他并从默认统计排除。
- [ ] 新版历史服务和今日摘要能读取 goal-direct 记录；统计从真实区间计算，T09 扩展视图。

### 4. 重写执行页与全局壳

- [ ] 主导航变为“执行 / 足迹”，设置为齿轮入口；未重做的真实维护页面从设置仍可达。
- [ ] 中央显示目标、可选任务 / intent、接续提示、大时间与唯一强主操作。正计时在本票真实可用；番茄模式未完成前不展示假可用按钮。
- [ ] 未运行时可切换目标 / 任务、明确选 goal-only、快速添加 Task。intent 输入不自动创建任务。
- [ ] 不要求先选一个“今日重点”，不展示所有目标的大卡片矩阵。少量待办置于计时器下方，执行时收起。
- [ ] 运行 / 暂停 / 结束保存中 / 失败清楚区分。结束直接提交，不弹 Review；成功反馈实际时长，提供可选“任务已完成”和接续输入。
- [ ] 拆除独立 Focus 页、Track 路由与旧 Review 组件；基础目标 / 任务入口直接使用新模型，所有开始入口指向同一 `/today` 状态。其他页面的紧凑提示返回执行首页；T10 补完整管理视觉与动作。
- [ ] 字体、间距、按钮层级、表单 / 抽屉样式建立一套基础变量与组件，由后续页面共用。
- [ ] 输入 / 对话框中不抢快捷键；移动端主动作不被底栏和键盘遮挡。

### 5. 返回与跨端接管

- [ ] 浏览器刷新、恢复前台、重新联网重新读取服务端；不要只从 localStorage 恢复秒数。
- [ ] 另一端已结束或取消时，本页停止旧 UI，提示实际结果；不能继续操作已失效的 Session。
- [ ] 有 Task 的接续只来自同 Task 最近有效 completed 记录；goal-only 只取同 Goal 的 goal-only 记录。最近记录无 hint 不复活更早 hint。
- [ ] 正在计时时可浏览其他对象，但开始另一项要先结束保存当前项；后一项启动失败保留已保存前项。
- [ ] Web/MCP 的 start 成功后同步选择；纯查询、补录和历史时间编辑不抢占选择。

## MCP / Web 契约交付

至少接通 `dashboard_get`、`selection_set/clear`、Goal/Task 基础读写、`session_get_active/get/start/pause/resume/finish/cancel`、`session_note_update`、`session_resume_hint_update`。继续可用的历史 / 打断 / 设置工具改为新模型；删除 Track / track-next 注册。

在 PR 中附工具到服务 / Web action 的对应表。输入中旧 trackId 或 finish outcome 不得被静默忽略。工具返回结构化错误；创建请求严格校验归属、重复 key 与并发状态。

## 关键失败场景

| 场景 | 预期 |
| --- | --- |
| 双标签同时 start | 一个成功，另一个拿到当前 Session 与返回入口 |
| finish 已落库但响应丢失 | 重试得到同一已完成结果，不新增记录 |
| 结束卡标记完成失败 | 时间记录仍已完成，可单独重试任务动作 |
| note 请求乱序 / MCP 同时修改 | 不静默覆盖新文本，提供版本冲突恢复 |
| 目标在点击 start 前被归档 | 服务端拒绝，页面重新选合法目标 |
| 旧结束卡完成 Task 时已选其他任务 | 完成原 Task，但不改变新选择 |
| 最近 hint 被清空 | 首页不复活更早历史提示 |

## 测试与验收

- Unit：选择回退表、null / omitted 差异、有效区间、零时长、hint 范围、键盘 guard。
- PostgreSQL integration：关系约束、start 并发、Task 与选择原子更新、start 与归档竞态、结束幂等、文本版本冲突、空库初始化。
- E2E：目标 → 任务 / goal-only → start → refresh → pause/resume → finish → 可选完成 → 下次继续；结束后提示保存失败再重试；375px 完整操作。
- MCP：MCP start → Web pause / finish → MCP 读取；Web goal-only start 不需 Track 参数。
- 运行索引中的公共检查；提供实际桌面 / 手机执行页的空、运行、暂停、结束状态截图。

### Acceptance checklist

- [ ] 只建 Goal 即可执行，没有隐藏 Track。
- [ ] 首页一次点击开始，结束无需填写表单。
- [ ] 同一任务可多次执行，结束不默认完成任务。
- [ ] 周一结束留提示、周三回来直接接上；仅暂停时恢复同一 Session。
- [ ] 新模型已贯通所有仍存在的页面和工具，应用构建 / 查询可用。
- [ ] 未结束计时排他、记录幂等和笔记防覆盖有真实数据库证据。

## 不在本票范围

完整番茄阶段、三幕引导、AI 客户端连接教程、年度活动日历、全部管理页视觉。它们由后续票完成；本票不做旧数据或旧接口兼容。
