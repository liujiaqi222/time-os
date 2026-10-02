import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import {
  createMcpAccessToken,
  loginAndSetup,
  mcpEnvelope,
  readMcpResponse,
  webPassword,
} from "./helpers";

test("first-run account, setup, onboarding, session persistence, and logout", async ({
  page,
}) => {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/login\?next=/);

  await page.getByLabel("设置实例密码").fill(webPassword);
  await page.getByRole("button", { name: "创建并进入 Time OS" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByText("数据库已就绪")).toBeVisible();

  await page.getByLabel("时区").fill("Asia/Shanghai");
  await page.getByRole("button", { name: "完成设置" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("目标标题").fill("完成 Time OS 首次验证");
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByLabel("我最期待的是").fill("验证第一次执行链路");
  await page.getByRole("button", { name: "保存目标，准备开始" }).click();

  await expect(page).toHaveURL(/\/today\?first=1$/);
  await expect(
    page.getByRole("button", { name: /开始第一次执行/ }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/today\?first=1$/);

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("OAuth discovery, bearer challenges, and scoped MCP access", async ({
  request,
}) => {
  const metadataResponse = await request.get(
    "/.well-known/oauth-protected-resource/mcp",
  );
  expect(metadataResponse.status()).toBe(200);
  await expect(metadataResponse.json()).resolves.toMatchObject({
    resource: "http://127.0.0.1:3010/mcp",
    authorization_servers: ["http://127.0.0.1:3010/api/auth"],
    scopes_supported: ["timeos:read", "timeos:write"],
  });

  const authorizationMetadataResponse = await request.get(
    "/.well-known/oauth-authorization-server/api/auth",
  );
  expect(authorizationMetadataResponse.status()).toBe(200);
  await expect(authorizationMetadataResponse.json()).resolves.toMatchObject({
    issuer: "http://127.0.0.1:3010/api/auth",
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    code_challenge_methods_supported: ["S256"],
  });

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: {
      _meta: mcpEnvelope,
    },
  };
  const headers = { accept: "application/json, text/event-stream" };

  const missing = await request.post("/mcp", { data: body, headers });
  expect(missing.status()).toBe(401);
  expect(missing.headers()["www-authenticate"]).toContain(
    "/.well-known/oauth-protected-resource/mcp",
  );

  const wrong = await request.post("/mcp", {
    data: body,
    headers: { ...headers, authorization: "Bearer wrong-token" },
  });
  expect(wrong.status()).toBe(401);

  const token = await createMcpAccessToken(request);
  const response = await request.post("/mcp", {
    data: body,
    headers: {
      ...headers,
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "server/discover",
    },
  });
  expect(response.status()).toBe(200);
  expect(await readMcpResponse(response)).toMatchObject({
    jsonrpc: "2.0",
    id: 1,
    result: { supportedVersions: ["2026-07-28"] },
  });

  const toolsResponse = await request.post("/mcp", {
    data: {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
      params: { _meta: mcpEnvelope },
    },
    headers: {
      ...headers,
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/list",
    },
  });
  expect(toolsResponse.status()).toBe(200);
  const toolsBody = await readMcpResponse(toolsResponse);
  const tools = toolsBody.result.tools as Array<{
    name: string;
    annotations?: { readOnlyHint?: boolean };
    _meta?: { securitySchemes?: unknown[] };
  }>;
  expect(tools.find((tool) => tool.name === "goals_list")).toMatchObject({
    annotations: { readOnlyHint: true },
    _meta: {
      securitySchemes: [
        {
          type: "oauth2",
          scopes: ["timeos:read", "timeos:write"],
        },
      ],
    },
  });
  expect(tools.find((tool) => tool.name === "goal_create")).toMatchObject({
    annotations: { readOnlyHint: false },
  });

  const health = await request.post("/mcp", {
    data: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "system_health",
        arguments: {},
        _meta: mcpEnvelope,
      },
    },
    headers: {
      ...headers,
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": "system_health",
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
        arguments: { timezone: "Asia/Tokyo", weekStartsOn: 0 },
        _meta: mcpEnvelope,
      },
    },
    headers: {
      ...headers,
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": "settings_update",
    },
  });
  expect(update.status()).toBe(200);
  expect(await readMcpResponse(update)).toMatchObject({
    jsonrpc: "2.0",
    id: 3,
    result: {
      structuredContent: {
        ok: true,
        data: { timezone: "Asia/Tokyo", weekStartsOn: 0 },
      },
    },
  });
});

test("setup shows an actionable error when the schema is incomplete", async ({
  page,
}) => {
  await loginAndSetup(page);

  const databaseUrl =
    process.env.TEST_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:55432/time_os_test";
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query("drop table app_settings");
  } finally {
    await pool.end();
  }

  await page.goto("/setup");
  await expect(page.getByText("数据库结构尚未就绪")).toBeVisible();
  await expect(page.getByText(/pnpm db:migrate/)).toBeVisible();

  const recoveryPool = new Pool({ connectionString: databaseUrl });
  try {
    const testSchema = process.env.TIMEOS_TEST_SCHEMA ?? "public";
    const migrationsSchema = process.env.TIMEOS_TEST_SCHEMA
      ? `${testSchema}_migrations`
      : "drizzle";
    await recoveryPool.query(`drop schema if exists "${testSchema}" cascade`);
    await recoveryPool.query(
      `drop schema if exists "${migrationsSchema}" cascade`,
    );
    await recoveryPool.query(`create schema "${testSchema}"`);
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(drizzle(recoveryPool), {
      migrationsFolder: process.env.TIMEOS_TEST_MIGRATIONS ?? "drizzle",
      migrationsSchema,
    });
  } finally {
    await recoveryPool.end();
  }

  // The next serial test recreates its owner and baseline through
  // loginAndSetup. Avoid navigating while the dev server is still releasing
  // connections to the schema that was just replaced.
});
