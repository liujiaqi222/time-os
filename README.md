# Time OS

Time OS 是一个 AI-native 的目标执行与时间管理工具。它记住每条推进线的下一步，并记录你真正投入的时间；你仍然可以在 ChatGPT、Claude 或 Codex 中讨论和调整计划。

> **AI is the planner. Time OS is the execution system.**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fliujiaqi222%2Ftime-os&project-name=time-os&repository-name=time-os&integration-ids=oac_3sK3gnG06emjIEVL09jjntDD&env=TIMEOS_WEB_PASSWORD%2CTIMEOS_MCP_TOKEN%2CTIMEOS_SESSION_SECRET%2CNEXT_PUBLIC_APP_NAME&envDefaults=%7B%22NEXT_PUBLIC_APP_NAME%22%3A%22Time%20OS%22%7D&envDescription=Set%20a%20web%20password%20and%20two%20unique%20random%20secrets.%20Neon%20provides%20DATABASE_URL%20automatically.)

一键部署会克隆仓库、创建并连接 Neon、收集实例 Secret，并在构建阶段自动执行 committed Drizzle migrations。部署完成后访问应用，使用 `TIMEOS_WEB_PASSWORD` 登录并完成 Setup。每个部署是一个独立的单用户实例。

## Local development

要求 Node.js 20+、pnpm，以及 PostgreSQL。复制环境变量模板并填写本地值：

```bash
cp .env.example .env.local
pnpm install
pnpm db:migrate
pnpm dev
```

环境变量：

- `DATABASE_URL`：Neon 或兼容 PostgreSQL 连接串；
- `TIMEOS_WEB_PASSWORD`：网页登录密码；
- `TIMEOS_MCP_TOKEN`：MCP Bearer Token，至少 32 个字符；
- `TIMEOS_SESSION_SECRET`：Cookie 签名 Secret，至少 32 个字符；
- `NEXT_PUBLIC_APP_NAME`：可选的公开应用名称。

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
