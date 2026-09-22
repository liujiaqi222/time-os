# T01 — Foundation, authentication and setup

## Outcome

建立可持续开发的应用骨架。完成后，一个全新本地或部署实例可以自动执行 migration、通过单用户密码登录、完成首次 Setup，并通过受保护的 `/mcp` endpoint 做健康检查。后续 tickets 只需添加领域能力，不再重新设计认证、事务或 adapter 边界。

## Scope

### Application foundation

- 初始化 Next.js + TypeScript 项目，接入 Tailwind CSS、shadcn/ui、Zod、Drizzle ORM/Kit、PostgreSQL driver、测试框架、Playwright 和 MCP TypeScript SDK v2。
- 建立明确目录边界：app/UI、db、services、web adapters、mcp、auth、shared schemas、tests。
- 配置 lint、format、typecheck、unit、integration、E2E 和 migration scripts。
- 创建 `.env.example`，包含 `DATABASE_URL`、`TIMEOS_WEB_PASSWORD`、`TIMEOS_MCP_TOKEN`、`TIMEOS_SESSION_SECRET` 与可选 app name。
- 提供统一 result/domain error 类型、server-only 环境变量校验和日志入口；日志不得输出密码、Token、Session Secret 或完整 Authorization header。

### Database and migrations

- 实现 PRD 中所有 MVP tables：goals、tracks、tasks、sessions、distractions、app_settings、idempotency records。
- 字段、foreign keys、check constraints、timestamps 和 indexes 与 PRD 一致。
- 为全局最多一个 active/paused Session 设计数据库可保证的策略；不能只做“先查再插”的竞态实现。
- AppSettings 使用固定 singleton id，并支持 selectedTrackId 与 setupCompletedAt。
- 提交初始 Drizzle migration；migration 可重复执行且不依赖手动 SQL。
- 测试数据库有独立连接配置与可靠清理方式，不能误连生产库。

### Service and adapter architecture

- 定义 `AuthenticatedContext`，业务 service 不读取 Cookie、Bearer header 或环境变量。
- 定义 repository/transaction boundary，跨实体 service 可在一个数据库事务内执行。
- 定义统一 domain error 序列化协议：code、message、可选 context。
- 建立 Web server action/route adapter 与 MCP tool adapter 的共享 validation 模式。
- 建立 contract-test harness：同一个 service case 可以验证 Web 与 MCP adapter 的成功/失败映射。

### Web authentication

- `/login` 提供单用户密码登录。
- 密码只在服务端比较，禁止写入 localStorage/sessionStorage 或客户端 bundle。
- 登录成功签发由 `TIMEOS_SESSION_SECRET` 保护的 Cookie：HttpOnly、Secure（生产）、SameSite=Lax、path=/。
- 使用 90 天滑动有效期；实现清晰且可测试的续期窗口。
- 提供 Logout；Secret 轮换后旧 Cookie 校验失败。
- 未认证访问受保护页面时进入 login；登录后回到原目标或 Setup/Today。
- 登录失败不泄露配置状态，具备适合 Serverless 的基础速率限制或指数退避。
- 写请求采用同源校验或等价 CSRF 防护。

### MCP authentication and shell

- 建立 stateless Streamable HTTP `POST /mcp` endpoint。
- 使用 Bearer Token 与 `TIMEOS_MCP_TOKEN` 常量时间比较；缺失/错误 Token 返回明确未授权响应。
- 注册最小 `system_health` 或等价只读探测能力，仅用于验证 endpoint、认证和 server 初始化；该临时工具可在正式工具可用后删除或保留为 health tool。
- handler 不保存 Session 或用户状态，不直接访问数据库业务表。

### First-run setup and settings

- 登录后若 `setupCompletedAt` 为空，导航到 `/setup`。
- Setup 检查 DB connection 与 migration/schema 状态；失败时说明具体缺项。
- 浏览器 timezone 作为建议默认值，用户可修改为有效 IANA timezone。
- 设置 defaultFocusMinutes 和 weekStartsOn。
- 显示 MCP endpoint 与使用 `YOUR_MCP_TOKEN` 的配置示例；绝不回显真实 Token。
- Finish Setup 写入 singleton settings 与 setupCompletedAt，然后进入 Today 空状态。
- 已完成 Setup 的用户仍可访问 `/settings` 更新 timezone/default focus/week start；重复进入 `/setup` 只做检查和编辑，不破坏数据。
- 为 settings read/update 建立 service，Web 与 MCP 的正式 `settings_get/settings_update` 在本票完成。

### Minimal app shell

- 提供认证后的基础导航占位：Today、Goals、History、Settings。
- Today 在尚无 Goal/Track 时显示清晰空状态，不伪造示例数据。
- 全局 error boundary、not found、loading skeleton 和基础响应式容器就位。

## Required tests

### Unit

- 环境变量验证；
- Cookie 签发、校验、过期、续期和 Secret 轮换；
- domain error serialization；
- IANA timezone/default focus settings validation。

### Integration

- migration 在空数据库建立完整 schema；重复运行无破坏；
- active/paused Session 的数据库排他策略在并发下成立；
- AppSettings singleton 与 settings service；
- Bearer authentication success/failure；
- Web/MCP settings contract mapping。

### E2E

- 未登录访问 → login → Setup → Today；
- 登录 Cookie 跨刷新保留；Logout 后无法访问受保护页面；
- 错误 schema/DB connection 显示可操作错误；
- `/mcp` 无 Token、错误 Token、正确 Token 三种真实请求。

## Acceptance checklist

- [ ] 全新数据库不执行手动 SQL 即可启动。
- [ ] 每台设备首次登录后，刷新与重新打开浏览器不需要再次输入密码。
- [ ] Setup 能保存设置，并在后续登录中跳过。
- [ ] Settings 的 Web 与 MCP 写入得到相同校验和结果。
- [ ] Secret 不出现在 HTML、客户端 JS、日志或 Settings 页面。
- [ ] 后续领域 service 可以不感知 Web/MCP 认证方式。

## Out of scope

- Goal/Track/Task 实际管理；
- Focus workflow；
- 完整 MCP tool catalog；
- OAuth、用户账户、多租户。
