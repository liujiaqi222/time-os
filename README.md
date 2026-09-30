# Time OS

Time OS 是一个 AI-native 的目标执行与时间管理工具。它记住目标的下一步，并记录你真正投入的时间；你也可以在 ChatGPT 网页端讨论计划，并通过 Plugin 写回当前实例。

> **AI is the planner. Time OS is the execution system.**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fliujiaqi222%2Ftime-os&project-name=time-os&repository-name=time-os&integration-ids=oac_3sK3gnG06emjIEVL09jjntDD&env=BETTER_AUTH_SECRET%2CNEXT_PUBLIC_APP_NAME&envDefaults=%7B%22NEXT_PUBLIC_APP_NAME%22%3A%22Time%20OS%22%7D&envDescription=Set%20one%20unique%20random%20authentication%20secret.%20Neon%20provides%20DATABASE_URL%20automatically.)

一键部署会克隆仓库、创建并连接 Neon、收集认证 Secret，并在构建阶段自动执行 committed Drizzle migrations。部署完成后访问应用，首次打开时设置实例密码，再完成时区与第一个目标引导。每个部署是一个独立的单用户实例。

## Local development

要求 Node.js 20+、pnpm，以及 PostgreSQL。复制环境变量模板并填写本地值：

```bash
cp .env.example .env.local
pnpm install
pnpm db:migrate
# 可选：向空的本地数据库写入 2 个示例目标和 5 个任务
pnpm db:seed
pnpm dev
```

`pnpm db:migrate` 使用已提交的 Drizzle migrations 建库；`pnpm db:seed` 仅允许连接 localhost/127.0.0.1，并在已有目标时默认跳过。v0.3 使用全新的 Goal → Task/Session 数据结构，不会自动转换旧版 Track 数据；升级旧实例前请另行备份并初始化新库。

环境变量：

- `DATABASE_URL`：Neon 或兼容 PostgreSQL 连接串；
- `BETTER_AUTH_SECRET`：Web Session 与 OAuth 令牌使用的服务端 Secret，至少 32 个字符；
- `BETTER_AUTH_URL`：实例公开 origin；生产必须是 HTTPS。Vercel 可从 `VERCEL_PROJECT_PRODUCTION_URL` 自动推导，自定义域名时应显式填写；
- `NEXT_PUBLIC_APP_NAME`：可选的公开应用名称。

ChatGPT Plugin 使用 OAuth 2.1 连接 `/mcp`。用户在 Time OS 登录并确认读写权限后，ChatGPT 才会获得限时 access token；网页不展示、复制或保存静态 MCP Token。

## Verification

```bash
pnpm test:unit
pnpm test:db:up
pnpm test:integration
pnpm test:e2e
pnpm lint
pnpm typecheck
```

集成与 E2E 测试只会清理主机为 localhost 且数据库名以 `_test` 结尾的数据库。

详细产品规格见 [docs/prd.md](docs/prd.md)，MVP tickets 见 [docs/tickets/README.md](docs/tickets/README.md)。
