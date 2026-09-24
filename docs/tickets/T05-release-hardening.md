# T05 — Capability parity hardening and self-hosted release

## Outcome

把已经可日用的产品收敛为可公开自托管的 MVP：补齐 Web/MCP 契约缺口、可访问性与移动端质量、运行安全、部署文档和真实 Vercel+Neon 验证。完成后，README 中的部署承诺必须由一次全新实例实测支撑。

## Dependency

Depends on #4.

## Scope

### Capability inventory and parity audit

- 从 PRD 的领域能力清单生成 Web action ↔ service ↔ MCP tool 对照表。
- 检查 Goal、Track、Task、Next、Session、Distraction、Settings、Dashboard、History、Stats 的每个 read/write 操作。
- 任何只存在 Web 或只存在 MCP 的领域能力必须补齐，或在 PRD 中明确说明为何不是领域能力。
- 所有 tools 使用稳定名称、清晰 description、严格 Zod input、结构化 output、readOnly metadata 和一致 domain errors。
- 列表接口验证 cursor/limit、默认过滤和 includeArchived/includeCancelled 行为。
- 删除临时或重复 MCP tools；不为 UI gesture 创建无语义价值的工具。

### Contract and failure-path hardening

- 建立/补齐参数化 contract suite，对同一 service scenario 验证 Web/MCP adapter。
- 覆盖未授权、非法 UUID、错误父级、非法状态、并发、幂等 key 重用、overlap confirmation、空结果和 pagination。
- 审计所有跨实体写入均在事务内；注入中途失败验证 rollback。
- 审计所有时间计算使用服务端 clock abstraction，测试不依赖真实等待。
- 审计日志与错误，不泄露 secrets、DB URL、Authorization、Cookie 或用户 Note 内容。
- 验证 session cookie 属性、滑动续期、Logout、Secret 轮换、CSRF 防护和登录退避。

### UX completion

- 统一页面层级、导航、空状态、loading、error、retry 和成功反馈。
- Today 保持唯一强 Primary CTA；其他 Start/maintenance actions 为次级。
- Focus 页面保持无普通导航的低干扰布局；active banner 在其他页面一致工作。
- 所有 Dialog/Sheet 支持键盘焦点管理、Esc、可见 label 与 screen reader 名称。
- 拖拽排序必须有键盘或非拖拽替代方式。
- 375px、常见 desktop 宽度和长文本/长 URL/大量 Tasks 场景完成视觉检查。
- 尊重 reduced motion；颜色对比、点击区域和错误关联达到基础 WCAG AA 目标。

#### Confirmed Web product findings and direction

本节记录 2026-09-23 对真实 Web 运行界面的审视结论。实现前先以这些产品边界为准，不把它们降级成零散的视觉 polish。

**Page responsibilities**

- Today 是执行首页：回答“现在做什么”，并提供全站唯一最强的 Start/Return to Focus CTA。
- Goals / Track detail 用于组织计划，但 Track detail 也必须允许用户从 Current Next 或具体 Task 直接开始 Focus，不能强迫用户绕回 Today。
- History 默认首先回答“我做了什么”；统计、筛选、手动补录和审计是次级能力，不应把时间线压到页面末尾。
- Focus 保持低干扰，不引入普通全站导航；现有计时器与 Pause / Finish 主动作层级继续保留。

**Today visual direction**

- 移除 Current Focus 的大面积纯黑背景。它在当前暖白页面中形成突兀的“黑色块”，视觉重量明显超过内容本身。
- Current Focus 改为浅色主卡：白色或暖灰底、清晰边框/轻阴影，可使用一条低饱和暖色或自然色 accent rail、状态圆点或小面积 tinted header 表示焦点状态。
- 深色实心只保留给 Start Focus / Return to Focus 主按钮；层级来自排版、留白和单一 CTA，而不是整张卡片反色。
- Goal、Track、预计时长和今日投入作为安静的辅助信息，Task title 与主 CTA 构成视觉中心。

**Navigation and responsive behavior**

- Desktop 导航必须显示当前位置。
- 375px 不得依赖隐藏滚动条的横向导航；Today、Goals、History、Settings 四个入口都应无需探索即可发现。优先采用移动端底部四栏导航，顶部仅保留品牌、active Session 状态和账户动作。
- active Session banner 在窄屏可换行，但计时、任务和 Return to Focus 不得互相挤压或遮挡。

**Planning and forms**

- Goals / Track detail 从“所有管理工具同时展开”改为“先看状态与任务，再按需维护”。
- Track detail 首屏顺序应为 Current Next + Start Focus、Task list，再到新增/批量维护；不能让完整创建表单先于 Task list 占据主要空间。
- 新建 Goal / Track / Task 使用紧凑 composer、Dialog/Sheet 或明确的展开入口；批量粘贴、编辑、排序、完成与归档保持次级。
- Complete、Skip、Archive 依据语义与风险区分层级，不并排呈现为同等权重的常驻动作。
- Complete 属于正向生命周期操作，不能使用破坏性红色；状态确认统一使用站内 Dialog，不调用浏览器原生 confirm。若 active/paused Session 阻止 Goal 或 Track 状态变化，Dialog 应解释原因并直接提供返回当前 Focus 的恢复路径。
- Completed / Archived 的 Goal、Track、Task 默认只读；必须先显式重新启用或重新打开，才能继续编辑自身或其下级内容。Web 与 Service Layer 必须执行同一规则，不能只隐藏输入框。
- 所有字段提供持久可见 label，placeholder 只用于示例，不承担字段名称。

**History hierarchy**

- 默认内容顺序为简洁摘要、Session 时间线；用户首先能看到最近完成的工作。
- 页面首屏只保留 2–3 个最有用的统计，其余统计可进入 Insights 区域或次级视图。
- Filters 默认收敛为一个明确入口；Manual Session 使用次级按钮打开 Dialog/Sheet，不常驻为大表单。
- cancelled audit 与记录纠错保留，但作为记录详情中的维护能力，不与日常回顾争夺主层级。

**Language, feedback and accessibility**

- 界面以中文为主；Goal、Track、Task、Current Next、Focus、Session 等产品领域词可以保留英文，但普通动作、状态、说明和日期格式不得随意中英混排。
- 规划表单的可预期 domain error 必须在操作附近显示，并提供可恢复路径；不得把常规校验/状态冲突升级成整页错误。
- 排序失败必须提示并回滚或重新拉取权威顺序；切换当前 Track、自动保存 Note 等异步动作需要可感知的 pending/success/error 状态。
- Finish Review 与 Cancel Dialog 在 375px 矮屏完整可操作：限制高度、允许内部滚动、关闭按钮有可访问名称，关闭后恢复触发点焦点。
- 所有持续动画支持 reduced motion；长标题、长说明和长 URL 不造成横向溢出。

### Performance and operational checks

- Today、Track detail、History 和 Stats 查询避免明显 N+1；为真实查询计划补必要索引。
- 对 sessions/tasks 大列表执行有代表性的种子数据测试，确认分页和响应时间不随数据量失控。
- MCP server 保持 stateless，验证 Vercel serverless cold start 后仍能处理请求。
- migration 在并发/重复 deployment 中安全；记录采用的 migration lock/执行策略。
- 为关键服务提供最小可观察性：request correlation、domain error code、耗时；不采集敏感内容。
- 提供备份/恢复提示，但不在 MVP 内构建备份产品。

### README and operator documentation

README 第一屏包含：

```text
Time OS
Your execution layer for AI-assisted planning.
[Deploy with Vercel]
What it does
```

文档必须包含：

- 产品定位与真实截图；
- 本地开发 prerequisites、安装、环境变量、migration、测试；
- Vercel + Neon 部署步骤；
- 四个 required env vars 的用途与安全生成方式；
- 首次 Login/Setup；
- MCP endpoint 与至少一个客户端配置示例，Token 用占位符；
- upgrade/migration 流程；
- 常见故障：DB/schema、Cookie、MCP 401、active Session 卡住及 Cancel；
- 明确的非目标与单用户安全模型。

### Real fresh-deployment validation

- 从干净 clone/新 Vercel Project/新 Neon Database 开始，不复用开发数据库。
- 通过公开 README 的步骤完成 provision、env、migration、build 和 deploy。
- 登录、Setup、创建 Goal/Track/Tasks、开始并完成 Focus、History/Stats、MCP read/write 全部实测。
- 确认整个过程无需 Neon SQL Editor 或手动 SQL。
- 记录验证日期、commit SHA、关键结果和发现的文档修正；不要提交任何真实 secret。
- 如果 Vercel/Neon 当前集成与 PRD 假设不同，修正文档和部署实现，不伪造“一键”承诺。

### Release test matrix

- Chromium desktop 与 375px mobile viewport；必要时补 WebKit/Firefox smoke。
- PostgreSQL/Neon integration suite。
- Web authentication + MCP Bearer authentication。
- Web-only core flow、MCP-only core flow、Web/MCP cross-control flow。
- refresh/reopen、paused finish、cancel recovery、overlap confirmation、cross-midnight stats。

## Required tests

### Automated

- 全量 lint、typecheck、unit、integration、contract、E2E；
- migration from empty DB；
- concurrency suite 重复运行；
- production build 和 server start smoke；
- dependency/security scan并人工判断结果，不以零 warning 作为形式目标。

### Manual/runtime evidence

- Today/Focus/Track/History/Settings 的 desktop + 375px 截图或录屏；
- Today 浅色 Current Focus、移动端完整导航、Track 直接 Start Focus、History 首屏时间线均提供视觉证据；
- 375px 完成一次 Finish Review，证明内容、错误和操作按钮均可到达；
- 真实 MCP client 完成核心 read/write；
- 全新部署 URL 上完成 acceptance flow；
- 浏览器网络/存储检查证明 Secret 未暴露且 Cookie 属性正确；
- 数据库查询证明全局 active Session 与 Current Next 约束成立。

## Acceptance checklist

- [ ] PRD 中每项 Web 领域能力有等价 MCP 操作。
- [ ] 所有 acceptance scenarios 在 production-like 环境通过。
- [ ] README 部署步骤由全新实例逐步验证，而非根据记忆编写。
- [ ] Desktop 与 375px mobile 均可完成核心闭环。
- [ ] Today 不再使用大面积纯黑 Current Focus 卡；页面只有 Start/Return to Focus 是最强主动作。
- [ ] 375px 下四个主导航入口无需横向探索即可发现，并且有明确当前位置。
- [ ] Track detail 可从 Current Next 或 Task 直接开始 Focus，Task list 位于完整新增/批量表单之前。
- [ ] History 默认优先展示 Session 时间线；筛选、手动补录和审计为次级入口。
- [ ] Goals / Track 表单有持久 label、局部错误与恢复反馈，常规失败不进入整页错误。
- [ ] Goal / Track 的完成与归档使用符合风险的视觉层级和站内确认 Dialog；active Session 冲突不会触发整页错误。
- [ ] Completed / Archived 规划实体在 Web 与 Service Layer 都保持只读，重新启用后才恢复编辑能力。
- [ ] Finish Review 在 375px 矮屏可完整操作，Dialog 焦点与 reduced-motion 验收通过。
- [ ] Secrets、Notes 和 Authorization 不出现在不应出现的位置。
- [ ] migration、rollback、retry 和并发失败路径有自动化证据。
- [ ] 一个陌生开发者可以仅依赖 README 部署自己的实例。

## Out of scope

- Hosted SaaS、多租户和 OAuth；
- App 内 AI、自动计划或推荐；
- 原生 App、通知、日历集成；
- MVP 之后的增长、计费或社区功能。
