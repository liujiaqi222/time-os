# Time OS v0.3 — Implementation Tickets

当前依据：[PRD v0.3](../prd.md)。体验说明：[产品方向](../product-direction-v0.3.md)。

**状态：**T06–T10 是本地可发布的 issue 正文，尚未发布到 GitHub，也未开始代码实现。编号是文档编号，不预设未来 GitHub issue 号码。

**实施边界：**前端与服务端按 v3 直接重构；不做旧库迁移、Track 映射、接口兼容或旧路由跳转。新版本建库、数据约束、真实数据库测试仍属交付范围。

## 当前 ticket map

| ID | Issue 正文 | 完成后用户能做什么 | 硬依赖 |
| --- | --- | --- | --- |
| T06 | [目标直连的执行首页与正计时闭环](v0.3/T06-execution-foundation.md) | 有目标即可在首页开始、暂停、结束、留下提示，下次直接接着做 | 当前代码基线 |
| T07 | [三幕目标引导与 AI 写回](v0.3/T07-goal-onboarding.md) | 新用户手动或通过 AI 建立目标，带着目标进入第一次执行 | T06 |
| T08 | [完整番茄钟与跨端计时](v0.3/T08-pomodoro-timer.md) | 使用专注 / 休息循环，关页、重连或换设备后仍得到准确状态 | T06 |
| T09 | [足迹、目标投入与记录纠错](v0.3/T09-footprints-history.md) | 看活动日历、做过的事情，按目标回看并补录 / 修正 | T06、T08 |
| T10 | [完整目标维护、设置与全站收尾](v0.3/T10-management-completion.md) | 完全通过 Web 日常使用，AI 能完成同等操作，全站采用新流程 | T07、T09 |

推荐交付顺序：**T06 → T07 → T08 → T09 → T10**。T07 / T08 的逻辑依赖均为 T06，但共享执行页与设置契约，默认顺序开发，不要求并行。

T06 先以正计时交付真实可用的执行首页；T07 在此基础上完成引导；T08 再提供番茄钟并设置新实例默认模式。不能在中间阶段展示尚不可用的模式按钮或伪造足迹反馈。

## 开发方式

1. 一个 ticket 负责完整纵向能力：页面、数据模型 / 服务、Web 与 MCP、异常状态、测试、文档，不另拆成仅数据库或仅 UI 的悬空 issue。
2. 先读主 PRD 和当前 ticket，再核对当前代码；下文路径是当前修改入口，不要求保留原模块结构。
3. Next.js 代码编写前按根 AGENTS.md 阅读已安装版本的 `node_modules/next/dist/docs/` 相关指南。不得按旧版本记忆重建路由、Server Actions 或缓存行为。
4. 核心状态转换、时间区间和并发先验证 service / integration，再接 Web 与 MCP。UI 不能自行实现领域规则。
5. 不要求保留 Track、旧 Finish Review 或按推进线查询的 API。删除失效测试，改为覆盖新行为；不能只移除断言以追求通过。
6. 每票交付时应用可构建、该票能力真实可操作。未负责页面可先接通新契约，但最终全站视觉与流程覆盖不能遗漏。
7. PRD 已确定的产品规则必须遵守；表名、模块拆分和视觉细节采用简洁默认。若确实发现行为矛盾，先修正文档，不在某个 adapter 私自改语义。

## 覆盖与所有权

| 能力 / 页面 | 主负责票 | 说明 |
| --- | --- | --- |
| Goal → Task / Session 新模型、建库、移除 Track 依赖 | T06 | 不迁移旧数据 |
| UI 基础样式、主导航、执行页、全局计时提示 | T06 | T08 扩展阶段 UI |
| 正计时、结束保存、接续提示与下一步选择 | T06 | 三者有服务端与 MCP 等价能力 |
| 登录、Setup、首次目标引导、AI 写回确认 | T07 | 连接文档以实测为准 |
| 番茄阶段、偏好、到时反馈、跨端恢复 | T08 | 数据持久化与并发不可留到收尾票 |
| 活动日历、历史、完成事项、补录纠错 | T09 | T06 起就记录精确专注区间 |
| 完整目标 / 任务管理、排序、归档 / 恢复、设置 | T10 | T06 提供基础 CRUD，T07 提供目标创建体验 |
| 404、全局错误、loading、全站视觉与 MCP 清单核验 | T10 | 不替代各票的局部状态处理 |

## 每票 Definition of Done

- 所需代码、schema / 初始化脚本、测试与当前契约文档完整。
- Web/MCP 通过同一服务；正常冲突有明确 code 和可恢复 UI。
- 有写入的流程覆盖失败与重试，计时 / 选择 / 笔记不存在未处理的并发覆盖。
- 运行 `pnpm lint`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:integration`、受影响的 `pnpm test:e2e -- ...` 和 `pnpm build`。最后一票完成全量 E2E；无需反复运行与改动无关的额外矩阵。
- 用专用测试数据库，确认应用与测试连接同一预期环境；端口冲突或数据库不可用需如实报告，不能当作产品验证通过。
- 实际浏览器检查桌面与 375px 页面、长文本、空 / 错误 / 保存中状态，提供截图或录屏路径及验证步骤。
- MCP 有真实协议调用证据，不能只调用服务函数冒充 MCP 验证。
- 记录验收使用的代码版本、运行环境、通过项和未完成项；构建 / 单测通过不等于视觉通过。

## 发布与文档边界

当前任务只生成 PRD 与 issue 正文，不发布 GitHub issue、PR 或部署。后续需要发布时，先核对仓库、账号、已有 issue 和最终正文，再填回真实链接。

## 历史 tickets：v0.2

以下只记录上一轮范围，不能作为 v3 新开发的验收依据。GitHub 状态未在本轮重新核实。

| ID | 原票 | 历史链接 |
| --- | --- | --- |
| T01 | [Foundation, authentication and setup](T01-foundation-auth-setup.md) | [#1](https://github.com/liujiaqi222/time-os/issues/1) |
| T02 | [Planning system and Current Next](T02-planning-current-next.md) | [#2](https://github.com/liujiaqi222/time-os/issues/2) |
| T03 | [Focus execution loop](T03-focus-execution.md) | [#3](https://github.com/liujiaqi222/time-os/issues/3) |
| T04 | [History, manual records and statistics](T04-history-stats.md) | [#4](https://github.com/liujiaqi222/time-os/issues/4) |
| T05 | [Parity hardening and self-hosted release](T05-release-hardening.md) | [#5](https://github.com/liujiaqi222/time-os/issues/5) |
