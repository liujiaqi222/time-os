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
- 真实 MCP client 完成核心 read/write；
- 全新部署 URL 上完成 acceptance flow；
- 浏览器网络/存储检查证明 Secret 未暴露且 Cookie 属性正确；
- 数据库查询证明全局 active Session 与 Current Next 约束成立。

## Acceptance checklist

- [ ] PRD 中每项 Web 领域能力有等价 MCP 操作。
- [ ] 所有 acceptance scenarios 在 production-like 环境通过。
- [ ] README 部署步骤由全新实例逐步验证，而非根据记忆编写。
- [ ] Desktop 与 375px mobile 均可完成核心闭环。
- [ ] Secrets、Notes 和 Authorization 不出现在不应出现的位置。
- [ ] migration、rollback、retry 和并发失败路径有自动化证据。
- [ ] 一个陌生开发者可以仅依赖 README 部署自己的实例。

## Out of scope

- Hosted SaaS、多租户和 OAuth；
- App 内 AI、自动计划或推荐；
- 原生 App、通知、日历集成；
- MVP 之后的增长、计费或社区功能。
