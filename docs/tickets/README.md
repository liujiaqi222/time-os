# Time OS MVP — Implementation Tickets

这些 tickets 从 [PRD](../prd.md) 派生。它们刻意采用较大的纵向范围，目标是让 AI agent 在一个 ticket 内交付可运行、可验证的完整能力，而不是留下互相等待的数据库/UI/MCP 半成品。

## 执行原则

1. 按依赖顺序实施；一个 ticket 完成后，产品必须处于可运行状态。
2. 每项领域能力同时落到 schema、Service Layer、Web adapter 和 MCP adapter；不得复制业务规则。
3. ticket 内允许拆内部 checklist，但不要再拆成跨层的小 issue。
4. 所有状态转换先写 service/integration tests，再接 UI 与 MCP。
5. 不以 mock 或静态页面代替验收；验收必须经过真实 PostgreSQL 和真实浏览器/MCP 调用。
6. 如果实现发现 PRD 冲突，先修订 PRD，再继续编码；不能由某一层私自发明新语义。

## Ticket map

| ID | Ticket | GitHub | 可见交付结果 | 依赖 |
|---|---|---|---|---|
| T01 | [Foundation, authentication and setup](T01-foundation-auth-setup.md) | [#1](https://github.com/liujiaqi222/time-os/issues/1) | 全新实例可迁移、登录、完成 Setup，并建立 Web/MCP 共用骨架 | 无 |
| T02 | [Planning system and Current Next](T02-planning-current-next.md) | [#2](https://github.com/liujiaqi222/time-os/issues/2) | Web 与 MCP 均可完整管理 Goal → Track → Task 与 Current Next | T01 |
| T03 | [Focus execution loop](T03-focus-execution.md) | [#3](https://github.com/liujiaqi222/time-os/issues/3) | Today → Focus → Pause/Resume → Finish/Cancel → Next 的日用闭环 | T02 |
| T04 | [History, manual records and statistics](T04-history-stats.md) | [#4](https://github.com/liujiaqi222/time-os/issues/4) | 可补录、纠错、查看 Distraction，并获得准确的时区统计 | T03 |
| T05 | [Parity hardening and self-hosted release](T05-release-hardening.md) | [#5](https://github.com/liujiaqi222/time-os/issues/5) | Web/MCP 契约完整、移动端可用、真实 Vercel+Neon 部署通过 | T04 |

## Recommended delivery strategy

- 一个 AI agent 一次只领取一个 ticket，并拥有该 ticket 的端到端实现权。
- 每张票结束时都运行该票列出的测试，并提供浏览器或协议级证据。
- T01–T03 完成后即可开始个人 dogfood；T04–T05 在真实使用反馈基础上修正可逆细节。
- 不为追求并行而让多个 agent 同时修改 schema、核心 service contract 或全局 UI shell。

## Definition of done for every ticket

- 代码、migration、测试和文档一起提交。
- 没有把业务规则放进 React component 或 MCP handler。
- Web 与 MCP 使用同一 Zod/service contract 或明确的 adapter。
- 失败路径返回规定的 domain error，而非通用错误。
- 新增环境变量同步到 `.env.example` 和 README。
- `lint`、typecheck、unit、integration 以及该票指定的 E2E 全部通过。
- 验收结果基于真实运行状态，不只基于 fixtures。
