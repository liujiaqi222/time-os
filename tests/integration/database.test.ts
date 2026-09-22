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
import { createPlanningService } from "@/services/planning";
import { planningContract } from "@/adapters/planning-contract";

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
const planningService = createPlanningService(database);

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
    await pool.query("delete from sessions");
  });
});

describe("planning service", () => {
  const web = { actor: "web" } as const;
  const mcp = { actor: "mcp" } as const;

  async function createPlan(label: string) {
    const goal = await planningService.createGoal(web, {
      title: `Goal ${label}`,
    });
    const track = await planningService.createTrack(web, {
      goalId: goal.id,
      title: `Track ${label}`,
    });
    return { goal, track };
  }

  it("assigns the first Task as Current Next and advances using the latest order", async () => {
    const { track } = await createPlan("advance");
    const [first, second, third] = await planningService.createTasks(web, {
      trackId: track.id,
      tasks: [{ title: "First" }, { title: "Second" }, { title: "Third" }],
    });
    expect(
      (
        (await planningService.getNext(web, track.id)) as
          typeof schema.tasks.$inferSelect | null
      )?.id,
    ).toBe(first?.id);

    await planningService.createTasks(web, {
      trackId: track.id,
      tasks: [{ title: "Fourth" }],
    });
    expect(
      (
        (await planningService.getNext(web, track.id)) as
          typeof schema.tasks.$inferSelect | null
      )?.id,
    ).toBe(first?.id);

    await planningService.reorderTasks(web, track.id, [
      third!.id,
      first!.id,
      second!.id,
      (
        await planningService.listTasks(web, track.id, {
          includeArchived: true,
        })
      ).items[3]!.id,
    ]);
    const completed = await planningService.completeTask(web, first!.id);
    expect(completed.nextTask?.id).toBe(second?.id);

    const reopened = await planningService.reopenTask(web, first!.id);
    expect(reopened.affectedTask.status).toBe("pending");
    expect(reopened.nextTask?.id).toBe(second?.id);
  });

  it("validates resource pairs and keeps idempotent batches stable", async () => {
    const { track } = await createPlan("idempotency");
    await expect(
      planningService.createTasks(web, {
        trackId: track.id,
        tasks: [
          {
            title: "Bad URL",
            resourceType: "url",
            resourceValue: "ftp://example.com",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const input = {
      trackId: track.id,
      tasks: [{ title: "Only once" }, { title: "Also once" }],
      idempotencyKey: `key-${randomUUID()}`,
    };
    const [left, right] = await Promise.all([
      planningService.createTasks(web, input),
      planningService.createTasks(mcp, input),
    ]);
    expect(right.map(({ id }) => id)).toEqual(left.map(({ id }) => id));
    expect(
      (
        await planningService.listTasks(web, track.id, {
          includeArchived: true,
        })
      ).items,
    ).toHaveLength(2);

    await expect(
      planningService.createTasks(web, {
        ...input,
        tasks: [{ title: "Different" }],
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("advances on skip/archive, ignores non-Next transitions, and preserves children across parent lifecycle", async () => {
    const { goal, track } = await createPlan("lifecycle");
    const [first, second, third] = await planningService.createTasks(web, {
      trackId: track.id,
      tasks: [{ title: "First" }, { title: "Second" }, { title: "Third" }],
    });

    expect((await planningService.skipTask(web, first!.id)).nextTask?.id).toBe(
      second!.id,
    );
    expect(
      (await planningService.archiveTask(web, third!.id)).nextTask?.id,
    ).toBe(second!.id);
    await planningService.reopenTask(web, first!.id);
    await planningService.setNext(web, track.id, first!.id);
    expect(
      (await planningService.archiveTask(web, first!.id)).nextTask?.id,
    ).toBe(second!.id);

    await planningService.updateTrack(web, {
      id: track.id,
      status: "completed",
    });
    await planningService.updateTrack(web, { id: track.id, status: "active" });
    await planningService.updateGoal(web, {
      id: goal.id,
      status: "archived",
    });
    await planningService.updateGoal(web, { id: goal.id, status: "active" });

    const restored = await planningService.getTrack(web, track.id);
    expect(restored).toMatchObject({
      status: "active",
      currentTaskId: second!.id,
    });
    expect(
      (
        await planningService.listTasks(web, track.id, {
          includeArchived: true,
        })
      ).items,
    ).toHaveLength(3);
  });

  it("rejects incomplete orders and keeps Current Next valid during concurrent mutations", async () => {
    const { track } = await createPlan("concurrency");
    const [first, second, third] = await planningService.createTasks(web, {
      trackId: track.id,
      tasks: [{ title: "A" }, { title: "B" }, { title: "C" }],
    });
    await expect(
      planningService.reorderTasks(web, track.id, [first!.id, second!.id]),
    ).rejects.toMatchObject({ code: "INVALID_POSITION_ORDER" });

    await Promise.all([
      planningService.completeTask(web, first!.id),
      planningService.setNext(mcp, track.id, third!.id),
    ]);
    const next = await planningService.getNext(web, track.id);
    expect(next).toMatchObject({
      id: third!.id,
      trackId: track.id,
      status: "pending",
    });
  });

  it("blocks parent lifecycle changes while its Session is running", async () => {
    const { goal, track } = await createPlan("session-guard");
    await pool.query(
      `insert into sessions (track_id, status, entry_mode, created_via, started_at)
       values ($1, 'active', 'timer', 'web', now())`,
      [track.id],
    );
    await expect(
      planningService.updateTrack(web, { id: track.id, status: "archived" }),
    ).rejects.toMatchObject({ code: "PARENT_HAS_ACTIVE_SESSION" });
    await expect(
      planningService.updateGoal(web, { id: goal.id, status: "completed" }),
    ).rejects.toMatchObject({ code: "PARENT_HAS_ACTIVE_SESSION" });
    await pool.query("delete from sessions where track_id = $1", [track.id]);
  });

  it("maps Web and MCP through the same structured contract", async () => {
    const webResult = await planningContract(() =>
      planningService.createGoal(web, { title: "Contract" }),
    );
    expect(webResult).toMatchObject({
      ok: true,
      data: { title: "Contract", status: "active" },
    });
    const mcpResult = await planningContract(() =>
      planningService.setNext(mcp, randomUUID(), null),
    );
    expect(mcpResult).toMatchObject({
      ok: false,
      error: { code: "TRACK_NOT_FOUND" },
    });
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
