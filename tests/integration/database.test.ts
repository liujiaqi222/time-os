import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  settingsGetContract,
  settingsUpdateContract,
} from "@/adapters/settings-contract";
import * as schema from "@/db/schema";
import { createSettingsService } from "@/services/settings";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:55432/time_os_test";
const parsedUrl = new URL(databaseUrl);

if (
  !["localhost", "127.0.0.1"].includes(parsedUrl.hostname) ||
  !parsedUrl.pathname.endsWith("_test")
) {
  throw new Error(
    "Integration tests refuse to clean a database unless it is local and ends with _test.",
  );
}

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const database = drizzle(pool, { schema });
const settingsService = createSettingsService(database);

beforeAll(async () => {
  await pool.query("drop schema if exists public cascade");
  await pool.query("drop schema if exists drizzle cascade");
  await pool.query("create schema public");
  await migrate(database, { migrationsFolder: "drizzle" });
});

afterAll(async () => {
  await pool.end();
});

describe("committed migrations", () => {
  it("create the complete schema and can be run repeatedly", async () => {
    await migrate(database, { migrationsFolder: "drizzle" });
    const result = await pool.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
       order by table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "app_settings",
      "distractions",
      "goals",
      "idempotency_records",
      "login_attempts",
      "sessions",
      "tasks",
      "tracks",
    ]);
  });

  it("allows only one active or paused session under concurrency", async () => {
    const goalId = randomUUID();
    const trackId = randomUUID();
    await pool.query(
      `insert into goals (id, title, position) values ($1, 'Goal', 1)`,
      [goalId],
    );
    await pool.query(
      `insert into tracks (id, goal_id, title, position) values ($1, $2, 'Track', 1)`,
      [trackId, goalId],
    );

    const results = await Promise.allSettled([
      pool.query(
        `insert into sessions
          (track_id, status, entry_mode, created_via, started_at)
         values ($1, 'active', 'timer', 'web', now())`,
        [trackId],
      ),
      pool.query(
        `insert into sessions
          (track_id, status, entry_mode, created_via, started_at)
         values ($1, 'paused', 'timer', 'mcp', now())`,
        [trackId],
      ),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });
});

describe("settings service and adapters", () => {
  it("keeps a singleton and maps Web/MCP contracts identically", async () => {
    const webResult = await settingsUpdateContract(
      settingsService,
      { actor: "web" },
      {
        timezone: "Asia/Shanghai",
        defaultFocusMinutes: 40,
        weekStartsOn: 1,
      },
      { completeSetup: true },
    );
    const mcpResult = await settingsGetContract(settingsService, {
      actor: "mcp",
    });

    expect(webResult).toEqual(mcpResult);
    expect(webResult).toMatchObject({
      ok: true,
      data: {
        timezone: "Asia/Shanghai",
        defaultFocusMinutes: 40,
        weekStartsOn: 1,
        setupCompleted: true,
      },
    });

    const count = await pool.query<{ count: string }>(
      "select count(*) from app_settings",
    );
    expect(count.rows[0]?.count).toBe("1");
  });
});
