import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { expect, type APIRequestContext, type Page } from "@playwright/test";

import * as authSchema from "@/db/auth-schema";

export const webPassword = "correct-horse-battery-staple";
export const mcpEnvelope = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "time-os-e2e",
    version: "1.0.0",
  },
};

const baseUrl = "http://127.0.0.1:3010";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:55432/time_os_test";

export async function loginAndSetup(page: Page) {
  await page.goto("/login");

  const createPassword = page.getByLabel("设置实例密码");
  if (await createPassword.isVisible()) {
    await createPassword.fill(webPassword);
    await page.getByRole("button", { name: "创建并进入 Time OS" }).click();
  } else {
    await page.getByLabel("实例密码").fill(webPassword);
    await page.getByRole("button", { name: "进入 Time OS" }).click();
  }

  await page.waitForURL((url) => url.pathname !== "/login");

  // Revisit setup explicitly instead of inferring state from a racing redirect.
  // Completing it is idempotent and makes this helper robust after a test has
  // rebuilt the database underneath an existing browser session.
  await page.goto("/setup");
  await page.getByLabel("时区").fill("Asia/Shanghai");
  await page.getByRole("button", { name: "完成设置" }).click();
  await page.waitForURL(/\/(onboarding|today)/);

  const destination = await expect
    .poll(async () => {
      if (new URL(page.url()).pathname === "/today") return "today";
      if (await page.getByLabel("目标标题").isVisible()) return "onboarding";
      return "waiting";
    })
    .toMatch(/^(today|onboarding)$/)
    .then(() =>
      new URL(page.url()).pathname === "/today" ? "today" : "onboarding",
    );

  if (destination === "onboarding") {
    await page.getByLabel("目标标题").fill("E2E baseline goal");
    await page.getByRole("button", { name: "继续" }).click();
    await page.getByRole("button", { name: "跳过并保存目标" }).click();
    await page.waitForURL(/\/today\?first=1/);
  }
}

/**
 * Sign a short-lived test access token with the same key exposed by the
 * authorization server. This exercises the production JWT verification,
 * issuer, audience, and scope checks without pretending to be ChatGPT.
 * The actual browser OAuth exchange is verified manually against ChatGPT.
 */
export async function createMcpAccessToken(request: APIRequestContext) {
  const resourceMetadata = await request.get(
    "/.well-known/oauth-protected-resource/mcp",
  );
  expect(resourceMetadata.status()).toBe(200);
  const resource = (await resourceMetadata.json()) as {
    resource: string;
    authorization_servers: string[];
  };

  const issuer = resource.authorization_servers[0];
  expect(issuer).toBeTruthy();

  const serverMetadata = await request.get(
    "/.well-known/oauth-authorization-server/api/auth",
  );
  expect(serverMetadata.status()).toBe(200);
  const server = (await serverMetadata.json()) as { jwks_uri: string };

  // Asking for JWKS lazily creates the provider signing key on a fresh DB.
  const jwksPath = new URL(server.jwks_uri).pathname;
  const jwksResponse = await request.get(jwksPath);
  expect(jwksResponse.status()).toBe(200);

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const signer = betterAuth({
      baseURL: baseUrl,
      secret: "better-auth-test-secret-that-is-at-least-32-characters",
      database: drizzleAdapter(drizzle(pool, { schema: authSchema }), {
        provider: "pg",
        schema: authSchema,
      }),
      plugins: [jwt()],
    });
    const signed = await signer.api.signJWT({
      body: {
        payload: {
          scope: "timeos:read timeos:write",
          client_id: "time-os-e2e",
          sub: "time-os-e2e-owner",
        },
        overrideOptions: {
          jwt: {
            issuer: issuer!,
            audience: resource.resource,
            expirationTime: "5m",
          },
        },
      },
    });
    return signed.token;
  } finally {
    await pool.end();
  }
}

export async function readMcpResponse(response: {
  headers(): Record<string, string>;
  text(): Promise<string>;
}) {
  const text = await response.text();
  if (!response.headers()["content-type"]?.includes("text/event-stream")) {
    return JSON.parse(text);
  }
  const data = text
    .split("\n")
    .filter((line: string) => line.startsWith("data: "))
    .map((line) => line.slice(6));
  return JSON.parse(data.at(-1) ?? "null");
}

export async function mcpCall(
  request: APIRequestContext,
  token: string,
  id: number,
  name: string,
  args: object,
) {
  const response = await request.post("/mcp", {
    data: {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args, _meta: mcpEnvelope },
    },
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
  });
  expect(response.status()).toBe(200);
  return readMcpResponse(response);
}
