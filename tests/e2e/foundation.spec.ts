import { expect, test } from "@playwright/test";
import { Pool } from "pg";

const webPassword = "correct-horse-battery-staple";
const mcpToken = "mcp-token-that-is-at-least-32-characters";

async function readMcpResponse(response: {
  headers(): Record<string, string>;
  text(): Promise<string>;
}) {
  const text = await response.text();
  if (!response.headers()["content-type"]?.includes("text/event-stream")) {
    return JSON.parse(text);
  }
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6));
  return JSON.parse(data.at(-1) ?? "null");
}

test("login, setup, cookie persistence, and logout", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login\?next=/);

  await page.getByLabel("实例密码").fill(webPassword);
  await page.getByRole("button", { name: "进入 Time OS" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByText("数据库已就绪")).toBeVisible();

  await page.getByLabel("时区").fill("Asia/Shanghai");
  await page.getByLabel("默认专注时长").fill("30");
  await page.getByRole("button", { name: "完成设置" }).click();

  await expect(page).toHaveURL(/\/today$/);
  await expect(
    page.getByRole("heading", { name: "还没有可执行的推进线" }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/today$/);

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("MCP rejects missing and incorrect tokens and initializes with the configured token", async ({
  request,
}) => {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "time-os-e2e", version: "1.0.0" },
    },
  };
  const headers = { accept: "application/json, text/event-stream" };

  expect((await request.post("/mcp", { data: body, headers })).status()).toBe(
    401,
  );
  expect(
    (
      await request.post("/mcp", {
        data: body,
        headers: { ...headers, authorization: "Bearer wrong-token" },
      })
    ).status(),
  ).toBe(401);

  const response = await request.post("/mcp", {
    data: body,
    headers: { ...headers, authorization: `Bearer ${mcpToken}` },
  });
  expect(response.status()).toBe(200);
  expect(await readMcpResponse(response)).toMatchObject({
    jsonrpc: "2.0",
    id: 1,
    result: { serverInfo: { name: "time-os" } },
  });

  const health = await request.post("/mcp", {
    data: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "system_health", arguments: {} },
    },
    headers: {
      ...headers,
      authorization: `Bearer ${mcpToken}`,
      "mcp-protocol-version": "2025-11-25",
    },
  });
  expect(health.status()).toBe(200);
  expect(await readMcpResponse(health)).toMatchObject({
    jsonrpc: "2.0",
    id: 2,
    result: { structuredContent: { ok: true, data: { status: "ready" } } },
  });

  const update = await request.post("/mcp", {
    data: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "settings_update",
        arguments: {
          timezone: "Asia/Tokyo",
          defaultFocusMinutes: 45,
          weekStartsOn: 0,
        },
      },
    },
    headers: {
      ...headers,
      authorization: `Bearer ${mcpToken}`,
      "mcp-protocol-version": "2025-11-25",
    },
  });
  expect(update.status()).toBe(200);
  expect(await readMcpResponse(update)).toMatchObject({
    jsonrpc: "2.0",
    id: 3,
    result: {
      structuredContent: {
        ok: true,
        data: {
          timezone: "Asia/Tokyo",
          defaultFocusMinutes: 45,
          weekStartsOn: 0,
        },
      },
    },
  });
});

test("setup shows an actionable error when the schema is incomplete", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("实例密码").fill(webPassword);
  await page.getByRole("button", { name: "进入 Time OS" }).click();
  await expect(page).toHaveURL(/\/today$/);

  const pool = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:55432/time_os_test",
  });
  try {
    await pool.query("drop table app_settings");
  } finally {
    await pool.end();
  }

  await page.goto("/setup");
  await expect(page.getByText("数据库 schema 尚未就绪")).toBeVisible();
  await expect(page.getByText(/pnpm db:migrate/)).toBeVisible();

  const recoveryPool = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:55432/time_os_test",
  });
  try {
    await recoveryPool.query("drop schema if exists public cascade");
    await recoveryPool.query("drop schema if exists drizzle cascade");
    await recoveryPool.query("create schema public");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(drizzle(recoveryPool), { migrationsFolder: "drizzle" });
  } finally {
    await recoveryPool.end();
  }
});
