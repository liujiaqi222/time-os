import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { createSettingsService } from "@/services/settings";
import { createPlanningService } from "@/services/planning";
import { createSelectionService } from "@/services/selection";
import { createDistractionService } from "@/services/distraction";
import { createDashboardService } from "@/services/dashboard";
import { createSessionService } from "@/services/session";
import { createHistoryService } from "@/services/history";
import { createStatisticsService } from "@/services/statistics";
import { planningContract } from "@/adapters/planning-contract";
import { createTimeOsMcpServer } from "@/mcp/server";
import { createMcpHandler } from "@modelcontextprotocol/server";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:55432/time_os_test";
const parsedUrl = new URL(databaseUrl);
const testSchema = process.env.TIMEOS_TEST_SCHEMA ?? "public";
const isolated = /^timeos_test_[a-f0-9]{32}$/.test(testSchema);
const migrationOptions = {
  migrationsFolder: process.env.TIMEOS_TEST_MIGRATIONS ?? "drizzle",
  migrationsSchema: isolated ? `${testSchema}_migrations` : "drizzle",
};

if (
  !isolated &&
  (!["localhost", "127.0.0.1"].includes(parsedUrl.hostname) ||
    !parsedUrl.pathname.endsWith("_test"))
) {
  throw new Error(
    "Integration tests refuse to clean a database unless it is local and ends with _test.",
  );
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 5,
  connectionTimeoutMillis: 15_000,
  query_timeout: 30_000,
  statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 30_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5000,
  maxLifetimeSeconds: 60,
});
const database = drizzle(pool, { schema });
const transitionQueries: string[] = [];
const transitionDatabase = drizzle(pool, {
  schema,
  logger: {
    logQuery(query) {
      transitionQueries.push(query);
    },
  },
});
const settingsService = createSettingsService(database);
const planningService = createPlanningService(database);
const selectionService = createSelectionService(database);
const distractionService = createDistractionService(database);
const sessionService = createSessionService(database, {
  distractionService,
});
const transitionDistractionService =
  createDistractionService(transitionDatabase);
const transitionSessionService = createSessionService(transitionDatabase, {
  distractionService: transitionDistractionService,
});
const historyService = createHistoryService(database);
const statisticsService = createStatisticsService(database, {
  settingsService,
});
const dashboardService = createDashboardService(database, {
  sessionService,
  selectionService,
  statisticsService,
});

beforeAll(async () => {
  await pool.query(`drop schema if exists "${testSchema}" cascade`);
  await pool.query(
    `drop schema if exists "${migrationOptions.migrationsSchema}" cascade`,
  );
  await pool.query(`create schema "${testSchema}"`);
  await migrate(database, migrationOptions);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    "truncate distractions, focus_intervals, sessions, tasks, goals, idempotency_records restart identity cascade",
  );
  await pool.query(
    "update app_settings set selected_goal_id = null, selected_task_id = null where id = 'default'",
  );
});

describe("committed migrations (empty-database initialization)", () => {
  it("create the complete v3 schema from an empty database and can run repeatedly", async () => {
    await migrate(database, migrationOptions);
    const result = await pool.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = '${testSchema}'
       order by table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "account",
      "app_settings",
      "distractions",
      "focus_intervals",
      "goals",
      "idempotency_records",
      "jwks",
      "oauth_access_token",
      "oauth_client",
      "oauth_client_assertion",
      "oauth_client_resource",
      "oauth_consent",
      "oauth_refresh_token",
      "oauth_resource",
      "session",
      "session_phases",
      "sessions",
      "tasks",
      "user",
      "verification",
    ]);
  });

  it("enforces the Session/Task/Goal ownership composite foreign key", async () => {
    const goalId = randomUUID();
    const otherGoalId = randomUUID();
    const taskId = randomUUID();
    await pool.query(
      `insert into goals (id, title, position) values ($1, 'Goal', 1), ($2, 'Other', 2)`,
      [goalId, otherGoalId],
    );
    await pool.query(
      `insert into tasks (id, goal_id, title, position) values ($1, $2, 'Task', 1)`,
      [taskId, goalId],
    );

    // A Session claiming the Task under another Goal is impossible.
    await expect(
      pool.query(
        `insert into sessions (goal_id, task_id, status, entry_mode, created_via, timer_mode, time_basis, started_at)
         values ($1, $2, 'active', 'timer', 'web', 'stopwatch', 'observed', now())`,
        [otherGoalId, taskId],
      ),
    ).rejects.toThrow(/sessions_task_goal_fk|foreign key/i);

    // Task positions are unique inside one Goal.
    await expect(
      pool.query(
        `insert into tasks (id, goal_id, title, position) values ($1, $2, 'Clash', 1)`,
        [randomUUID(), goalId],
      ),
    ).rejects.toThrow(/tasks_goal_position_unique|duplicate key/i);
  });

  it("allows only one unfinished session per instance under concurrency", async () => {
    const goalId = randomUUID();
    await pool.query(
      `insert into goals (id, title, position) values ($1, 'Goal', 1)`,
      [goalId],
    );

    const results = await Promise.allSettled([
      pool.query(
        `insert into sessions
          (goal_id, status, entry_mode, created_via, timer_mode, time_basis, started_at)
         values ($1, 'active', 'timer', 'web', 'stopwatch', 'observed', now())`,
        [goalId],
      ),
      pool.query(
        `insert into sessions
          (goal_id, status, entry_mode, created_via, timer_mode, time_basis, started_at)
         values ($1, 'paused', 'timer', 'mcp', 'stopwatch', 'observed', now())`,
        [goalId],
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

describe("planning service and selection", () => {
  const web = { actor: "web" } as const;
  const mcp = { actor: "mcp" } as const;

  async function createGoalWithTasks(label: string, titles: string[]) {
    const goal = await planningService.createGoal(web, {
      title: `Goal ${label}`,
    });
    const tasks = titles.length
      ? await planningService.createTasks(web, {
          goalId: goal.id,
          tasks: titles.map((title) => ({ title })),
        })
      : [];
    return { goal, tasks };
  }

  it("creates goals idempotently and appends tasks in order", async () => {
    const key = `goal-${randomUUID()}`;
    const [first, replay] = await Promise.all([
      planningService.createGoal(web, { title: "Once", idempotencyKey: key }),
      planningService.createGoal(mcp, { title: "Once", idempotencyKey: key }),
    ]);
    expect(replay.id).toBe(first.id);
    await expect(
      planningService.createGoal(web, {
        title: "Different",
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const { goal, tasks } = await createGoalWithTasks("order", [
      "First",
      "Second",
      "Third",
    ]);
    expect(tasks.map((task) => task.position)).toEqual([1, 2, 3]);
    void goal;
  });

  it("selection_set: omitted taskId auto-resolves, null is goal-only, a uuid pins the Task", async () => {
    const { goal, tasks } = await createGoalWithTasks("select", ["One", "Two"]);

    // Omitted → auto: first pending Task.
    const auto = await selectionService.set(web, { goalId: goal.id });
    expect(auto.task?.id).toBe(tasks[0]!.id);
    expect(auto.goalOnly).toBe(false);

    // Explicit null → goal-only, surviving new Tasks and reorders.
    const goalOnly = await selectionService.set(web, {
      goalId: goal.id,
      taskId: null,
    });
    expect(goalOnly.goalOnly).toBe(true);
    await planningService.createTasks(web, {
      goalId: goal.id,
      tasks: [{ title: "Later" }],
    });
    const stored = await selectionService.getStored(web);
    expect(stored).toEqual({ goalId: goal.id, taskId: null });

    // Explicit uuid pins that Task.
    const pinned = await selectionService.set(web, {
      goalId: goal.id,
      taskId: tasks[1]!.id,
    });
    expect(pinned.task?.id).toBe(tasks[1]!.id);

    // Cross-Goal and non-pending selections are domain errors.
    const other = await createGoalWithTasks("other", ["Other"]);
    await expect(
      selectionService.set(web, {
        goalId: goal.id,
        taskId: other.tasks[0]!.id,
      }),
    ).rejects.toMatchObject({ code: "TASK_NOT_IN_GOAL" });
    await planningService.completeTask(web, tasks[1]!.id);
    await expect(
      selectionService.set(web, { goalId: goal.id, taskId: tasks[1]!.id }),
    ).rejects.toMatchObject({ code: "TASK_NOT_PENDING" });

    await selectionService.clear(web);
    expect(await selectionService.getStored(web)).toBeNull();
  });

  it("completing the selected Task advances the selection atomically; other transitions never steal it", async () => {
    const { goal, tasks } = await createGoalWithTasks("advance", [
      "One",
      "Two",
      "Three",
    ]);
    await selectionService.set(web, { goalId: goal.id, taskId: tasks[0]!.id });

    await planningService.completeTask(web, tasks[0]!.id);
    expect(await selectionService.getStored(web)).toEqual({
      goalId: goal.id,
      taskId: tasks[1]!.id,
    });

    // Completing a non-selected Task leaves the selection alone.
    await planningService.completeTask(web, tasks[2]!.id);
    expect(await selectionService.getStored(web)).toEqual({
      goalId: goal.id,
      taskId: tasks[1]!.id,
    });

    // Reopen never takes over the selection.
    await planningService.reopenTask(web, tasks[0]!.id);
    expect(await selectionService.getStored(web)).toEqual({
      goalId: goal.id,
      taskId: tasks[1]!.id,
    });
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
      selectionService.set(mcp, { goalId: randomUUID() }),
    );
    expect(mcpResult).toMatchObject({
      ok: false,
      error: { code: "GOAL_NOT_FOUND" },
    });
  });
});

describe("session service: stopwatch loop, exclusivity, idempotency", () => {
  const web = { actor: "web" } as const;
  const mcp = { actor: "mcp" } as const;

  async function createGoalWithTasks(label: string, titles: string[]) {
    const goal = await planningService.createGoal(web, {
      title: `Goal ${label}`,
    });
    const tasks = titles.length
      ? await planningService.createTasks(web, {
          goalId: goal.id,
          tasks: titles.map((title) => ({ title })),
        })
      : [];
    return { goal, tasks };
  }

  it("runs the stopwatch loop with real focus intervals", async () => {
    const { goal, tasks } = await createGoalWithTasks("loop", ["Focus"]);
    const session = await sessionService.startSession(web, {
      goalId: goal.id,
      taskId: tasks[0]!.id,
      timerMode: "stopwatch",
      intent: "写初稿",
      idempotencyKey: "loop-1",
    });

    expect(session.status).toBe("active");
    expect(session.taskId).toBe(tasks[0]!.id);
    expect(session.timerMode).toBe("stopwatch");
    expect(session.timeBasis).toBe("observed");
    expect(session.intent).toBe("写初稿");
    expect(session.intervals).toHaveLength(1);
    expect(session.intervals[0]!.endedAt).toBeNull();
    expect(session.actions).toContain("pause");

    // A successful start syncs the selection (PRD §5.3).
    expect(await selectionService.getStored(web)).toEqual({
      goalId: goal.id,
      taskId: tasks[0]!.id,
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    const paused = await sessionService.pauseSession(web, session.id);
    expect(paused.status).toBe("paused");
    expect(paused.intervals).toHaveLength(1);
    expect(paused.intervals[0]!.endedAt).not.toBeNull();
    expect(paused.focusSeconds).toBeGreaterThanOrEqual(session.focusSeconds);
    expect(paused.focusSeconds).toBe(
      Math.floor(
        (paused.intervals[0]!.endedAt!.getTime() -
          paused.intervals[0]!.startedAt.getTime()) /
          1000,
      ),
    );

    // Idempotent pause.
    expect((await sessionService.pauseSession(web, session.id)).id).toBe(
      session.id,
    );

    const resumed = await sessionService.resumeSession(web, session.id);
    expect(resumed.status).toBe("active");
    expect(resumed.intervals).toHaveLength(2);
    expect(resumed.intervals[1]!.endedAt).toBeNull();

    // Idempotent resume.
    expect((await sessionService.resumeSession(web, session.id)).id).toBe(
      session.id,
    );

    await new Promise((resolve) => setTimeout(resolve, 60));
    const finished = await sessionService.finishSession(web, session.id, {
      note: "收尾",
      noteExpectedVersion: 0,
    });
    expect(finished.status).toBe("completed");
    expect(finished.endedAt).not.toBeNull();
    expect(finished.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(finished.note).toBe("收尾");
    expect(finished.noteVersion).toBe(1);
    expect(finished.intervals.every((interval) => interval.endedAt)).toBe(true);

    // Idempotent finish retry returns the same completed record.
    const retry = await sessionService.finishSession(web, session.id, {
      note: "迟到的旧请求",
      noteExpectedVersion: 0,
    });
    expect(retry.id).toBe(finished.id);
    expect(retry.note).toBe("收尾");
    expect(retry.noteVersion).toBe(1);

    // The exclusivity slot is released and the selection stays.
    expect(await sessionService.getActiveSession(web)).toBeNull();
    expect(await selectionService.getStored(web)).toEqual({
      goalId: goal.id,
      taskId: tasks[0]!.id,
    });
  });

  it("keeps a retry-safe pomodoro start to one database roundtrip", async () => {
    const { goal } = await createGoalWithTasks("fast pomodoro start", []);
    const input = {
      goalId: goal.id,
      timerMode: "pomodoro" as const,
      idempotencyKey: randomUUID(),
    };
    transitionQueries.length = 0;
    const before = performance.now();
    const started = await transitionSessionService.startSession(web, input);
    console.info(
      `Pomodoro start: ${Math.round(performance.now() - before)}ms, ${transitionQueries.length} database statements`,
    );
    expect(started.phase).toMatchObject({
      kind: "focus",
      state: "running",
      remainingSeconds: 1500,
    });
    expect(started.phases).toHaveLength(1);
    expect(transitionQueries).toHaveLength(1);
    const replay = await transitionSessionService.startSession(web, input);
    expect(replay.id).toBe(started.id);
    expect(replay.phases).toHaveLength(1);
    await expect(
      transitionSessionService.startSession(web, {
        ...input,
        intent: "different",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it.each(["stopwatch", "pomodoro"] as const)(
    "keeps %s pause and resume to one database roundtrip each",
    async (timerMode) => {
      const { goal } = await createGoalWithTasks("fast transitions", []);
      const session = await sessionService.startSession(web, {
        goalId: goal.id,
        taskId: null,
        timerMode,
      });

      transitionQueries.length = 0;
      const pauseStarted = performance.now();
      const paused = await transitionSessionService.pauseSession(
        web,
        session.id,
      );
      console.info(
        `${timerMode} pause: ${Math.round(performance.now() - pauseStarted)}ms, ${transitionQueries.length} statements`,
      );
      expect(paused.status).toBe("paused");
      expect(transitionQueries).toHaveLength(1);

      transitionQueries.length = 0;
      const resumeStarted = performance.now();
      const resumed = await transitionSessionService.resumeSession(
        web,
        session.id,
      );
      console.info(
        `${timerMode} resume: ${Math.round(performance.now() - resumeStarted)}ms, ${transitionQueries.length} statements`,
      );
      expect(resumed.status).toBe("active");
      expect(transitionQueries).toHaveLength(1);
    },
  );

  it.each(["stopwatch", "pomodoro"] as const)(
    "keeps %s cancellation to one database roundtrip",
    async (timerMode) => {
      const { goal } = await createGoalWithTasks("fast cancel", []);
      const session = await sessionService.startSession(web, {
        goalId: goal.id,
        timerMode,
      });
      transitionQueries.length = 0;
      const started = performance.now();
      const cancelled = await transitionSessionService.cancelSession(
        web,
        session.id,
      );
      console.info(
        `${timerMode} cancel: ${Math.round(performance.now() - started)}ms, ${transitionQueries.length} statements`,
      );
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.intervals.every((interval) => interval.endedAt)).toBe(
        true,
      );
      expect(cancelled.phases?.every((phase) => phase.endedAt) ?? true).toBe(
        true,
      );
      expect(transitionQueries).toHaveLength(1);
      const retry = await transitionSessionService.cancelSession(
        web,
        session.id,
      );
      expect(retry.revision).toBe(cancelled.revision);
      expect(retry.endedAt).toEqual(cancelled.endedAt);
    },
  );

  it("arbitrates concurrent fast starts and replays the winning key", async () => {
    const { goal } = await createGoalWithTasks("concurrent fast start", []);
    const input = { goalId: goal.id, timerMode: "pomodoro" as const };
    const keys = [randomUUID(), randomUUID()];
    const outcomes = await Promise.allSettled(
      keys.map((idempotencyKey) =>
        sessionService.startSession(web, { ...input, idempotencyKey }),
      ),
    );
    const winner = outcomes.findIndex(
      (result) => result.status === "fulfilled",
    );
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes[1 - winner]).toMatchObject({
      status: "rejected",
      reason: { code: "ACTIVE_SESSION_EXISTS" },
    });
    const started = (
      outcomes[winner] as PromiseFulfilledResult<
        Awaited<ReturnType<typeof sessionService.startSession>>
      >
    ).value;
    const replay = await sessionService.startSession(web, {
      ...input,
      idempotencyKey: keys[winner],
    });
    expect(replay.id).toBe(started.id);
    expect(replay.phases).toHaveLength(1);
  });

  it("rejects a second start while one is unfinished, from either surface", async () => {
    const { goal } = await createGoalWithTasks("exclusive", []);
    const first = await sessionService.startSession(web, {
      goalId: goal.id,
      timerMode: "stopwatch",
    });

    await expect(
      sessionService.startSession(mcp, {
        goalId: goal.id,
        timerMode: "stopwatch",
        intent: null,
      }),
    ).rejects.toMatchObject({
      code: "ACTIVE_SESSION_EXISTS",
      context: { sessionId: first.id },
    });

    await sessionService.cancelSession(web, first.id);
    const again = await sessionService.startSession(mcp, {
      goalId: goal.id,
      timerMode: "stopwatch",
    });
    expect(again.status).toBe("active");
    await sessionService.cancelSession(web, again.id);
  });

  it("serializes start against Goal lifecycle so an archived Goal can never own a live Session", async () => {
    const { goal } = await createGoalWithTasks("race", []);
    const results = await Promise.allSettled([
      sessionService.startSession(web, {
        goalId: goal.id,
        timerMode: "stopwatch",
      }),
      planningService.updateGoal(web, { id: goal.id, status: "archived" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const open = await pool.query(
      `select status from sessions where goal_id = $1 and status in ('active','paused')`,
      [goal.id],
    );
    if (results[0].status === "rejected") {
      expect(results[1].status).toBe("fulfilled");
      expect(open.rows).toHaveLength(0);
      expect(String(results[0].reason.code ?? results[0].reason)).toMatch(
        /GOAL_NOT_ACTIVE|INVALID/,
      );
    } else {
      // Start won the race: the archive must have failed with the guard.
      const reason = (results[1] as PromiseRejectedResult).reason;
      expect(String(reason.code ?? reason)).toMatch(
        /PARENT_HAS_ACTIVE_SESSION|GOAL_NOT_ACTIVE|INVALID/,
      );
      expect(open.rows).toHaveLength(1);
      const live = await pool.query<{ id: string }>(
        `select id from sessions where goal_id = $1 and status = 'active'`,
        [goal.id],
      );
      if (live.rows[0]) {
        await sessionService.cancelSession(web, live.rows[0].id);
      }
    }
  });

  it("validates execution targets before opening a Session", async () => {
    const { goal, tasks } = await createGoalWithTasks("validate", ["T1"]);
    await planningService.completeTask(web, tasks[0]!.id);

    await expect(
      sessionService.startSession(web, {
        goalId: goal.id,
        taskId: tasks[0]!.id,
        timerMode: "stopwatch",
      }),
    ).rejects.toMatchObject({ code: "TASK_NOT_PENDING" });

    const other = await createGoalWithTasks("validate-other", ["O1"]);
    await expect(
      sessionService.startSession(web, {
        goalId: goal.id,
        taskId: other.tasks[0]!.id,
        timerMode: "stopwatch",
      }),
    ).rejects.toMatchObject({ code: "TASK_NOT_IN_GOAL" });

    await planningService.updateGoal(web, { id: goal.id, status: "archived" });
    await expect(
      sessionService.startSession(web, {
        goalId: goal.id,
        timerMode: "stopwatch",
      }),
    ).rejects.toMatchObject({ code: "GOAL_NOT_ACTIVE" });
  });

  it("blocks Task and Goal lifecycle changes while their Session is unfinished", async () => {
    const { goal, tasks } = await createGoalWithTasks("guard", ["Busy"]);
    const session = await sessionService.startSession(web, {
      goalId: goal.id,
      taskId: tasks[0]!.id,
      timerMode: "stopwatch",
    });

    await expect(
      planningService.completeTask(web, tasks[0]!.id),
    ).rejects.toMatchObject({ code: "PARENT_HAS_ACTIVE_SESSION" });
    await expect(
      planningService.skipTask(web, tasks[0]!.id),
    ).rejects.toMatchObject({ code: "PARENT_HAS_ACTIVE_SESSION" });
    await expect(
      planningService.archiveTask(web, tasks[0]!.id),
    ).rejects.toMatchObject({ code: "PARENT_HAS_ACTIVE_SESSION" });
    await expect(
      planningService.updateGoal(web, { id: goal.id, status: "completed" }),
    ).rejects.toMatchObject({ code: "PARENT_HAS_ACTIVE_SESSION" });

    // Reopen (no Session attached) stays allowed during a run.
    const other = await createGoalWithTasks("guard-other", ["Free"]);
    await planningService.completeTask(web, other.tasks[0]!.id);
    await planningService.reopenTask(web, other.tasks[0]!.id);

    await sessionService.cancelSession(web, session.id);
  });

  it("guards note writes with content versions; stale writes never overwrite", async () => {
    const { goal } = await createGoalWithTasks("notes", []);
    const session = await sessionService.startSession(web, {
      goalId: goal.id,
      timerMode: "stopwatch",
    });

    const saved = await sessionService.updateNote(web, {
      id: session.id,
      note: "v1 text",
      expectedVersion: 0,
    });
    expect(saved.note).toBe("v1 text");
    expect(saved.noteVersion).toBe(1);

    // An out-of-order autosave with the old version is rejected.
    await expect(
      sessionService.updateNote(web, {
        id: session.id,
        note: "stale autosave",
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      context: { currentVersion: 1 },
    });

    const [sessionRow] = (
      await pool.query("select note from sessions where id = $1", [session.id])
    ).rows as { note: string }[];
    expect(sessionRow.note).toBe("v1 text");

    await sessionService.updateNote(web, {
      id: session.id,
      note: "v2 text",
      expectedVersion: 1,
    });
    await sessionService.cancelSession(web, session.id);
  });

  it("keeps the resume hint independent from finish; conflict retry recovers", async () => {
    const { goal, tasks } = await createGoalWithTasks("hint", ["H1"]);
    const session = await sessionService.startSession(web, {
      goalId: goal.id,
      taskId: tasks[0]!.id,
      timerMode: "stopwatch",
    });
    const finished = await sessionService.finishSession(web, session.id, {
      note: "done",
      noteExpectedVersion: 0,
    });
    expect(finished.status).toBe("completed");

    // Hint can still be saved after finish — its failure must never undo time.
    const hinted = await sessionService.updateResumeHint(web, {
      id: session.id,
      resumeHint: "下次先补第二段例子",
      expectedVersion: 0,
    });
    expect(hinted.resumeHint).toBe("下次先补第二段例子");
    expect(hinted.resumeHintVersion).toBe(1);

    // Conflict → rebase with the fresh version.
    await expect(
      sessionService.updateResumeHint(web, {
        id: session.id,
        resumeHint: "stale",
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const rebased = await sessionService.updateResumeHint(web, {
      id: session.id,
      resumeHint: null,
      expectedVersion: 1,
    });
    expect(rebased.resumeHint).toBeNull();
  });

  it("cancels as a kept-but-excluded record and frees the exclusivity slot", async () => {
    const { goal } = await createGoalWithTasks("cancel", []);
    const session = await sessionService.startSession(web, {
      goalId: goal.id,
      timerMode: "stopwatch",
    });
    await sessionService.cancelSession(web, session.id);
    // Idempotent cancel.
    await sessionService.cancelSession(web, session.id);

    const cancelledRow = await pool.query<{ status: string }>(
      "select status from sessions where id = $1",
      [session.id],
    );
    expect(cancelledRow.rows[0]?.status).toBe("cancelled");
    expect(await sessionService.getActiveSession(web)).toBeNull();

    await expect(
      sessionService.resumeSession(web, session.id),
    ).rejects.toMatchObject({ code: "INVALID_SESSION_STATE" });
  });

  it("preserves a zero-duration record without counting it as effective work", async () => {
    await settingsService.update(web, {
      timezone: "UTC",
      weekStartsOn: 1,
    });
    const before = await statisticsService.getStatistics(web, {
      period: "today",
    });

    const goal = await planningService.createGoal(web, { title: "Zero" });
    const sessionId = randomUUID();
    const now = new Date();
    await pool.query(
      `insert into sessions (id, goal_id, status, entry_mode, created_via, timer_mode, time_basis, started_at, ended_at, duration_seconds)
       values ($1, $2, 'completed', 'timer', 'web', 'stopwatch', 'observed', $3, $3, 0)`,
      [sessionId, goal.id, now],
    );

    const stats = await statisticsService.getStatistics(web, {
      period: "today",
    });
    expect(stats.totalFocusSeconds).toBe(before.totalFocusSeconds);
    expect(stats.sessionCount).toBe(before.sessionCount);

    const page = await historyService.listSessions(web, {});
    expect(page.items.map(({ id }) => id)).toContain(sessionId);
  });
});

describe("dashboard resolution and resume hints", () => {
  const web = { actor: "web" } as const;

  async function createGoalWithTasks(label: string, titles: string[]) {
    const goal = await planningService.createGoal(web, {
      title: `Goal ${label}`,
    });
    const tasks = titles.length
      ? await planningService.createTasks(web, {
          goalId: goal.id,
          tasks: titles.map((title) => ({ title })),
        })
      : [];
    return { goal, tasks };
  }

  async function runFinishedSession(input: {
    goalId: string;
    taskId?: string | null;
    durationSeconds?: number;
    resumeHint?: string | null;
    /** Minutes before now the Session ended; keeps recency deterministic. */
    endedMinutesAgo?: number;
  }) {
    const duration = input.durationSeconds ?? 120;
    const endedAt = input.endedMinutesAgo
      ? new Date(Date.now() - input.endedMinutesAgo * 60_000)
      : new Date();
    const sessionId = randomUUID();
    await pool.query(
      `insert into sessions (id, goal_id, task_id, status, entry_mode, created_via, timer_mode, time_basis, started_at, ended_at, duration_seconds, resume_hint)
       values ($1, $2, $3, 'completed', 'timer', 'web', 'stopwatch', 'observed', $4, $5, $6, $7)`,
      [
        sessionId,
        input.goalId,
        input.taskId ?? null,
        new Date(endedAt.getTime() - duration * 1000),
        endedAt,
        duration,
        input.resumeHint ?? null,
      ],
    );
    // Matching focus interval so the stats see real observed time.
    await pool.query(
      `insert into focus_intervals (session_id, phase, started_at, ended_at)
       values ($1, 'focus', $2, $3)`,
      [sessionId, new Date(endedAt.getTime() - duration * 1000), endedAt],
    );
    return sessionId;
  }

  it("falls back through the §5.2 rules and serves the scoped resume hint", async () => {
    // Rule 5: no selection, no history → first active Goal, first pending.
    const empty = await createGoalWithTasks("first", ["A", "B"]);
    const first = await dashboardService.getDashboard(web);
    expect(first.selection?.goal.id).toBe(empty.goal.id);
    expect(first.selection?.task?.id).toBe(empty.tasks[0]!.id);
    expect(first.resumeHint).toBeNull();

    // Build history on a second, newer Goal.
    const recent = await createGoalWithTasks("recent", ["R1", "R2"]);
    const stale = await createGoalWithTasks("stale", ["S1"]);
    await runFinishedSession({
      goalId: stale.goal.id,
      taskId: stale.tasks[0]!.id,
      resumeHint: "旧目标的提示",
      endedMinutesAgo: 60,
    });
    await runFinishedSession({
      goalId: recent.goal.id,
      taskId: recent.tasks[0]!.id,
      resumeHint: "下次从 R1 的第二步继续",
    });

    // Rule 4: most recent effective Session wins over the first Goal.
    const dashboard = await dashboardService.getDashboard(web);
    expect(dashboard.selection?.goal.id).toBe(recent.goal.id);
    expect(dashboard.selection?.task?.id).toBe(recent.tasks[0]!.id);
    expect(dashboard.selection?.reason).toBe("recent-goal");
    expect(dashboard.resumeHint).toBe("下次从 R1 的第二步继续");

    // The latest record's cleared hint is NOT resurrected from older ones.
    const latestId = await runFinishedSession({
      goalId: recent.goal.id,
      taskId: recent.tasks[0]!.id,
    });
    void latestId;
    await pool.query(
      "update sessions set resume_hint = null where goal_id = $1",
      [recent.goal.id],
    );
    const cleared = await dashboardService.getDashboard(web);
    expect(cleared.resumeHint).toBeNull();

    // Rule 2: an explicit stored selection beats recent history.
    await selectionService.set(web, {
      goalId: empty.goal.id,
      taskId: empty.tasks[1]!.id,
    });
    const explicit = await dashboardService.getDashboard(web);
    expect(explicit.selection?.goal.id).toBe(empty.goal.id);
    expect(explicit.selection?.task?.id).toBe(empty.tasks[1]!.id);
    expect(explicit.selection?.reason).toBe("explicit-selection");
    // A Task-scoped hint only reads that Task's records.
    expect(explicit.resumeHint).toBeNull();

    // Rule 1: an unfinished Session takes over entirely.
    const session = await sessionService.startSession(web, {
      goalId: recent.goal.id,
      taskId: recent.tasks[1]!.id,
      timerMode: "stopwatch",
    });
    const running = await dashboardService.getDashboard(web);
    expect(running.activeSession?.id).toBe(session.id);
    expect(running.selection?.task?.id).toBe(recent.tasks[1]!.id);
    expect(running.selection?.reason).toBe("active-session");
    expect(running.resumeHint).toBeNull();
    await sessionService.cancelSession(web, session.id);
  });

  it("summarizes today from real intervals and active goals", async () => {
    await settingsService.update(web, { timezone: "UTC", weekStartsOn: 1 });
    const { goal, tasks } = await createGoalWithTasks("summary", ["T"]);
    await runFinishedSession({
      goalId: goal.id,
      taskId: tasks[0]!.id,
      durationSeconds: 300,
    });

    const dashboard = await dashboardService.getDashboard(web);
    expect(dashboard.todayStats.totalFocusSeconds).toBe(300);
    expect(dashboard.todayStats.sessionCount).toBe(1);
    expect(dashboard.goals.map((item) => item.goal.id)).toContain(goal.id);
    expect(dashboard.todos.map((task) => task.id)).toContain(tasks[0]!.id);
    expect(dashboard.serverNow).toBeTruthy();
  });
});

describe("history service and statistics", () => {
  const web = { actor: "web" } as const;
  const mcp = { actor: "mcp" } as const;

  async function createGoalWithTasks(label: string, titles: string[]) {
    const goal = await planningService.createGoal(web, {
      title: `Goal ${label}`,
    });
    const tasks = titles.length
      ? await planningService.createTasks(web, {
          goalId: goal.id,
          tasks: titles.map((title) => ({ title })),
        })
      : [];
    return { goal, tasks };
  }

  it("logs manual records with idempotency, overlap confirmation, and corrections", async () => {
    const { goal, tasks } = await createGoalWithTasks("manual", ["Historic"]);
    const key = `manual-${randomUUID()}`;
    const firstInput = {
      goalId: goal.id,
      taskId: tasks[0]!.id,
      durationSeconds: 3600,
      endedAt: "2026-06-01T11:00:00.000Z",
      idempotencyKey: key,
    };

    const first = await historyService.logSession(web, firstInput);
    expect(first.timeBasis).toBe("manual");
    expect(first.entryMode).toBe("manual");
    const replay = await historyService.logSession(mcp, firstInput);
    expect(replay.id).toBe(first.id);

    await historyService.logSession(web, {
      goalId: goal.id,
      durationSeconds: 3600,
      endedAt: "2026-06-01T12:00:00.000Z",
    });
    await expect(
      historyService.logSession(web, {
        goalId: goal.id,
        durationSeconds: 3600,
        endedAt: "2026-06-01T11:30:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "SESSION_TIME_OVERLAP" });
    const overlapping = await historyService.logSession(mcp, {
      goalId: goal.id,
      durationSeconds: 3600,
      endedAt: "2026-06-01T11:30:00.000Z",
      allowOverlap: true,
    });

    // Corrections: ownership must stay consistent; time edits switch the
    // basis to corrected while the record stays manual-created.
    const other = await createGoalWithTasks("manual-other", ["O"]);
    await expect(
      historyService.updateSession(web, {
        id: first.id,
        goalId: other.goal.id,
        taskId: tasks[0]!.id,
      }),
    ).rejects.toMatchObject({ code: "TASK_NOT_IN_GOAL" });
    const corrected = await historyService.updateSession(web, {
      id: first.id,
      goalId: other.goal.id,
      taskId: null,
      startedAt: "2026-06-01T09:00:00.000Z",
      endedAt: "2026-06-01T10:00:00.000Z",
      note: "Corrected",
    });
    expect(corrected).toMatchObject({
      timeBasis: "corrected",
      createdVia: "web",
      durationSeconds: 3600,
      note: "Corrected",
    });

    // Manual logs and corrections never take over the selection.
    expect(await selectionService.getStored(web)).toBeNull();
    void overlapping;
  });

  it("serializes concurrent overlap checks so only one unconfirmed record is written", async () => {
    const { goal } = await createGoalWithTasks("manual-concurrency", []);
    const input = {
      goalId: goal.id,
      durationSeconds: 1800,
      endedAt: "2026-07-01T10:00:00.000Z",
    };
    const results = await Promise.allSettled([
      historyService.logSession(web, input),
      historyService.logSession(mcp, input),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
  });

  it("computes statistics from observed intervals and corrected declarations", async () => {
    await settingsService.update(web, { timezone: "UTC", weekStartsOn: 1 });
    const { goal } = await createGoalWithTasks("stats", []);

    // Observed: 09:00–10:00 with a 10-minute pause in the middle.
    const observedId = randomUUID();
    await pool.query(
      `insert into sessions (id, goal_id, status, entry_mode, created_via, timer_mode, time_basis, started_at, ended_at, duration_seconds)
       values ($1, $2, 'completed', 'timer', 'web', 'stopwatch', 'observed', $3, $4, $5)`,
      [
        observedId,
        goal.id,
        "2026-06-01T09:00:00Z",
        "2026-06-01T10:00:00Z",
        3000,
      ],
    );
    await pool.query(
      `insert into focus_intervals (session_id, phase, started_at, ended_at)
       values ($1, 'focus', $2, $3), ($1, 'focus', $4, $5)`,
      [
        observedId,
        "2026-06-01T09:00:00Z",
        "2026-06-01T09:30:00Z",
        "2026-06-01T09:40:00Z",
        "2026-06-01T10:00:00Z",
      ],
    );

    // Manual: 10:00–11:00 declared 45 effective minutes.
    const manualId = randomUUID();
    await pool.query(
      `insert into sessions (id, goal_id, status, entry_mode, created_via, timer_mode, time_basis, started_at, ended_at, duration_seconds)
       values ($1, $2, 'completed', 'manual', 'web', 'stopwatch', 'manual', $3, $4, $5)`,
      [manualId, goal.id, "2026-06-01T10:00:00Z", "2026-06-01T11:00:00Z", 2700],
    );

    // Cancelled intervals never count.
    const cancelledId = randomUUID();
    await pool.query(
      `insert into sessions (id, goal_id, status, entry_mode, created_via, timer_mode, time_basis, started_at, ended_at, duration_seconds)
       values ($1, $2, 'cancelled', 'timer', 'web', 'stopwatch', 'observed', $3, $4, $5)`,
      [
        cancelledId,
        goal.id,
        "2026-06-01T11:00:00Z",
        "2026-06-01T12:00:00Z",
        3600,
      ],
    );

    const stats = await statisticsService.getStatistics(web, {
      period: "custom",
      from: "2026-06-01T08:00:00Z",
      to: "2026-06-01T12:00:00Z",
      now: "2026-06-01T12:00:00Z",
    });
    expect(stats.totalFocusSeconds).toBe(3000 + 2700);
    expect(stats.sessionCount).toBe(2);
    expect(stats.focusDays).toBe(1);
    expect(stats.byGoal[0]).toMatchObject({
      goalId: goal.id,
      focusSeconds: 3000 + 2700,
    });

    // Correcting the observed record switches it to the corrected basis:
    // the original intervals stay, the declared value wins.
    await historyService.updateSession(web, {
      id: observedId,
      durationSeconds: 1800,
    });
    const corrected = await statisticsService.getStatistics(web, {
      period: "custom",
      from: "2026-06-01T08:00:00Z",
      to: "2026-06-01T12:00:00Z",
      now: "2026-06-01T12:00:00Z",
    });
    expect(corrected.totalFocusSeconds).toBe(1800 + 2700);
  });
});

describe("MCP server over the real protocol", () => {
  const web = { actor: "web" } as const;

  const handler = createMcpHandler(() =>
    createTimeOsMcpServer({
      settingsService,
      planningService,
      selectionService,
      sessionService,
      distractionService,
      dashboardService,
      historyService,
      statisticsService,
    }),
  );

  let nextId = 1;
  async function rpc(
    method: string,
    params?: unknown,
  ): Promise<{
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  }> {
    const response = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: nextId++,
          method,
          params,
        }),
      }),
    );
    const text = await response.text();
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const dataLine = text
        .split("\n")
        .filter((line: string) => line.startsWith("data:"))
        .at(-1);
      return JSON.parse(dataLine!.slice("data:".length).trim());
    }
    return JSON.parse(text);
  }

  async function callTool(name: string, args: unknown = {}) {
    const response = await rpc("tools/call", { name, arguments: args });
    if (response.error) {
      throw new Error(`Protocol error: ${JSON.stringify(response.error)}`);
    }
    const result = response.result as {
      isError?: boolean;
      structuredContent?: { ok: boolean; error?: { code: string } };
    };
    expect(result.structuredContent).toBeDefined();
    return result.structuredContent!;
  }

  it("walks initialize → tools/list → session tools with Web interleaving", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "integration-test", version: "1.0.0" },
    });
    expect(init.result).toBeDefined();
    const { serverInfo } = init.result as { serverInfo?: { name?: string } };
    expect(serverInfo?.name).toBe("time-os");

    const listed = await rpc("tools/list", {});
    const names = (
      (listed.result as { tools: { name: string }[] }).tools ?? []
    ).map((tool) => tool.name);
    for (const required of [
      "dashboard_get",
      "selection_set",
      "selection_clear",
      "goals_list",
      "goal_create",
      "tasks_list",
      "tasks_create",
      "task_complete",
      "session_start",
      "session_pause",
      "session_resume",
      "session_finish",
      "session_cancel",
      "session_note_update",
      "session_resume_hint_update",
      "sessions_list",
      "session_log",
      "session_update",
      "stats_get",
    ]) {
      expect(names).toContain(required);
    }
    // Track / Current-Next registrations are gone.
    for (const banned of ["track_create", "next_get", "next_set"]) {
      expect(names).not.toContain(banned);
    }

    // MCP creates a Goal + Task, starts a goal-only Session.
    const goalCreate = await callTool("goal_create", {
      title: "MCP 创建的目标",
    });
    expect(goalCreate.ok).toBe(true);
    const goalId = (goalCreate as unknown as { data: { id: string } }).data.id;
    await callTool("tasks_create", {
      goalId,
      tasks: [{ title: "MCP Task" }],
    });

    const start = await callTool("session_start", {
      goalId,
      timerMode: "stopwatch",
    });
    expect(start.ok).toBe(true);
    const sessionId = (start as unknown as { data: { id: string } }).data.id;
    expect((start as unknown as { data: { goalId: string } }).data.goalId).toBe(
      goalId,
    );

    // 运行中睡 1.1 秒，让时长真实超过 1 秒（零时长不计有效次数）。
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Web pauses; MCP reads the paused state back.
    const paused = await sessionService.pauseSession(web, sessionId);
    expect(paused.status).toBe("paused");
    const mcpActive = await callTool("session_get_active", {});
    expect(
      (mcpActive as unknown as { data: { status: string } }).data.status,
    ).toBe("paused");

    // Web finishes; the MCP note update on a completed Session still works.
    const finished = await sessionService.finishSession(web, sessionId, {});
    expect(finished.status).toBe("completed");
    const hint = await callTool("session_resume_hint_update", {
      id: sessionId,
      resumeHint: "MCP 留下的接续提示",
      expectedVersion: 0,
    });
    expect(hint.ok).toBe(true);

    const dash = await callTool("dashboard_get", {});
    expect(dash.ok).toBe(true);
    const dashData = dash as unknown as {
      data: {
        selection: { goal: { id: string }; reason: string };
        resumeHint: string | null;
        todayStats: { sessionCount: number };
      };
    };
    expect(dashData.data.selection.goal.id).toBe(goalId);
    // start 同步过选择：finish 后选择仍指向该 Goal（rule 2 explicit），
    // goal-only 上下文读取同 Goal 的 goal-only 接续提示。
    expect(dashData.data.selection.reason).toBe("explicit-selection");
    expect(dashData.data.resumeHint).toBe("MCP 留下的接续提示");
    expect(dashData.data.todayStats.sessionCount).toBe(1);

    // The legacy trackId input is rejected, not silently ignored: the
    // strict input schema surfaces an explicit tool error.
    const legacy = await rpc("tools/call", {
      name: "session_start",
      arguments: { trackId: goalId, goalId, timerMode: "stopwatch" },
    });
    const legacyResult = legacy.result as unknown as {
      isError?: boolean;
      content?: { text?: string }[];
    };
    expect(legacyResult.isError).toBe(true);
    expect(legacyResult.content?.[0]?.text ?? "").toMatch(/trackId/i);

    // Domain errors come back as structured results on the MCP surface.
    const conflict = await callTool("session_resume_hint_update", {
      id: sessionId,
      resumeHint: "stale",
      expectedVersion: 0,
    });
    expect(conflict.ok).toBe(false);
    expect(
      (conflict as unknown as { error: { code: string } }).error.code,
    ).toBe("VERSION_CONFLICT");
  });
});

describe("T08 pomodoro deadlines, concurrency and shared contracts", () => {
  const web = { actor: "web" } as const;
  const mcp = { actor: "mcp" } as const;
  let now = new Date("2026-10-01T00:00:00Z");
  const timer = createSessionService(database, {
    distractionService,
    clock: () => now,
  });
  const step = (seconds: number) => {
    now = new Date(now.getTime() + seconds * 1000);
  };
  async function start() {
    now = new Date("2026-10-01T00:00:00Z");
    await settingsService.update(web, {
      timerPreferences: {
        focusMinutes: 25,
        shortBreakMinutes: 5,
        longBreakMinutes: 15,
        longBreakEnabled: true,
        soundEnabled: false,
      },
    });
    const goal = await planningService.createGoal(web, { title: "Pomodoro" });
    return timer.startSession(web, { goalId: goal.id, timerMode: "pomodoro" });
  }
  it("starts and skips a break in two database roundtrips", async () => {
    const session = await start();
    const measured = createSessionService(transitionDatabase, {
      distractionService,
      clock: () => now,
    });
    step(1500);
    transitionQueries.length = 0;
    const before = performance.now();
    const rest = await measured.advanceSession(web, {
      id: session.id,
      expectedPhaseId: session.phase!.id,
      action: "start_break",
    });
    console.info(
      `Start break: ${Math.round(performance.now() - before)}ms, ${transitionQueries.length} statements`,
    );
    expect(rest.phase).toMatchObject({
      kind: "short_break",
      state: "running",
      remainingSeconds: 300,
    });
    expect(rest.focusSeconds).toBe(1500);
    expect(transitionQueries).toHaveLength(2);
    step(30);
    transitionQueries.length = 0;
    const skipStarted = performance.now();
    const next = await measured.advanceSession(web, {
      id: session.id,
      expectedPhaseId: rest.phase!.id,
      action: "start_next_focus",
    });
    console.info(
      `Skip break: ${Math.round(performance.now() - skipStarted)}ms, ${transitionQueries.length} statements`,
    );
    expect(next.phase).toMatchObject({
      kind: "focus",
      state: "running",
      remainingSeconds: 1500,
    });
    expect(next.focusSeconds).toBe(1500);
    expect(next.intervals).toHaveLength(3);
    expect(transitionQueries).toHaveLength(2);
  });
  it("cancels an overdue phase at its deadline without counting waiting time", async () => {
    const session = await start();
    step(7200);
    const cancelled = await timer.cancelSession(web, session.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.focusSeconds).toBe(1500);
    expect(cancelled.completedFocusCount).toBe(1);
    expect(cancelled.intervals[0].endedAt?.toISOString()).toBe(
      "2026-10-01T00:25:00.000Z",
    );
    const phase = await pool.query(
      "select ended_at, remaining_ms, complete from session_phases where session_id = $1",
      [session.id],
    );
    expect(phase.rows[0]).toMatchObject({
      ended_at: new Date("2026-10-01T00:25:00Z"),
      remaining_ms: 0,
      complete: true,
    });
  });
  it("cancels a paused phase without counting the paused time", async () => {
    const session = await start();
    step(60);
    await timer.pauseSession(web, session.id);
    step(7200);
    const cancelled = await timer.cancelSession(mcp, session.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.focusSeconds).toBe(60);
    expect(cancelled.completedFocusCount).toBe(0);
    const phase = await pool.query(
      "select remaining_ms, complete from session_phases where session_id = $1",
      [session.id],
    );
    expect(phase.rows[0]).toMatchObject({
      remaining_ms: 1440000,
      complete: false,
    });
    expect(await timer.getActiveSession(web)).toBeNull();
  });
  it("reads after two hours without writing and settles at the original deadline on finish", async () => {
    const session = await start();
    step(25 * 60 + 2 * 3600);
    const read = await timer.getSession(mcp, session.id);
    expect(read.focusSeconds).toBe(1500);
    expect(read.phase?.state).toBe("due");
    expect(read.completedFocusCount).toBe(1);
    const persisted = await pool.query(
      "select ended_at from focus_intervals where session_id = $1",
      [session.id],
    );
    expect(persisted.rows[0].ended_at).toBeNull();
    const finished = await timer.finishSession(web, session.id);
    expect(finished.durationSeconds).toBe(1500);
    expect(finished.intervals[0].endedAt?.toISOString()).toBe(
      "2026-10-01T00:25:00.000Z",
    );
    expect((await timer.finishSession(mcp, session.id)).revision).toBe(
      finished.revision,
    );
  });
  it("10 minutes focus, 7 paused, 15 resumed yields 25 minutes and a shifted deadline", async () => {
    const session = await start();
    step(600);
    const pauses = await Promise.all([
      timer.pauseSession(web, session.id),
      timer.pauseSession(mcp, session.id),
    ]);
    expect(pauses[0].phase?.remainingSeconds).toBe(900);
    for (const paused of pauses) {
      expect(paused.phase?.state).toBe("paused");
      expect(paused.intervals).toHaveLength(1);
      expect(paused.intervals[0].endedAt?.toISOString()).toBe(
        now.toISOString(),
      );
    }
    step(420);
    const resumes = await Promise.all([
      timer.resumeSession(mcp, session.id),
      timer.resumeSession(web, session.id),
    ]);
    expect(resumes[0].phase?.deadlineAt?.toISOString()).toBe(
      "2026-10-01T00:32:00.000Z",
    );
    for (const resumed of resumes) {
      expect(resumed.phase?.state).toBe("running");
      expect(resumed.intervals).toHaveLength(2);
      expect(resumed.intervals[1].endedAt).toBeNull();
    }
    step(900);
    const read = await timer.getSession(web, session.id);
    expect(read.focusSeconds).toBe(1500);
    expect(read.intervals).toHaveLength(2);
    expect(read.phase?.state).toBe("due");
  });
  it("excludes both waits and break, and preserves configuration across another device edit", async () => {
    const session = await start();
    step(1680);
    const rest = await timer.advanceSession(mcp, {
      id: session.id,
      expectedPhaseId: session.phase!.id,
      action: "start_break",
    });
    expect(rest.focusSeconds).toBe(1500);
    await settingsService.update(web, {
      timerPreferences: {
        focusMinutes: 50,
        shortBreakMinutes: 10,
        longBreakMinutes: 30,
        longBreakEnabled: false,
        soundEnabled: false,
      },
    });
    step(420);
    const next = await timer.advanceSession(web, {
      id: session.id,
      expectedPhaseId: rest.phase!.id,
      action: "start_next_focus",
    });
    expect(next.phase?.remainingSeconds).toBe(1500);
    expect(next.focusSeconds).toBe(1500);
    step(30);
    expect((await timer.finishSession(web, session.id)).durationSeconds).toBe(
      1530,
    );
    const subsequent = await timer.startSession(mcp, {
      goalId: session.goalId,
      timerMode: "pomodoro",
    });
    expect(subsequent.phase?.remainingSeconds).toBe(3000);
  });
  it("offers fourth-round long break once; skipping it makes the fifth break short", async () => {
    let session = await start();
    for (let round = 1; round <= 5; round++) {
      step(1500);
      const read = await timer.getSession(mcp, session.id);
      expect(read.completedFocusCount).toBe(round);
      expect(read.nextBreakKind).toBe(
        round === 4 ? "long_break" : "short_break",
      );
      expect(
        (await timer.getSession(web, session.id)).completedFocusCount,
      ).toBe(round);
      if (round < 5) {
        const input = {
          id: session.id,
          expectedPhaseId: read.phase!.id,
          action: "start_next_focus" as const,
        };
        session = await timer.advanceSession(web, input);
        const retry = await timer.advanceSession(mcp, input);
        expect(retry.phase!.id).toBe(session.phase!.id);
      }
    }
    expect((await timer.finishSession(web, session.id)).durationSeconds).toBe(
      7500,
    );
  });
  it("competing advance actions form one phase, and old phase cannot touch the new one", async () => {
    const session = await start();
    step(1500);
    const outcomes = await Promise.allSettled([
      timer.advanceSession(web, {
        id: session.id,
        expectedPhaseId: session.phase!.id,
        action: "start_break",
      }),
      timer.advanceSession(mcp, {
        id: session.id,
        expectedPhaseId: session.phase!.id,
        action: "start_next_focus",
      }),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "STALE_SESSION_PHASE" },
    });
    expect((await timer.getSession(web, session.id)).phases).toHaveLength(2);
  });
  it("pause exactly at deadline cannot create negative remaining or an extra interval", async () => {
    const session = await start();
    step(1500);
    await expect(timer.pauseSession(web, session.id)).rejects.toMatchObject({
      code: "INVALID_SESSION_STATE",
    });
    const read = await timer.getSession(mcp, session.id);
    expect(read.phase?.remainingSeconds).toBe(0);
    expect(read.focusSeconds).toBe(1500);
    expect(read.actions).not.toContain("resume");
    expect(read.intervals).toHaveLength(1);
  });
  it("break pause/resume and early next focus preserve prior focus and actual intervals", async () => {
    const session = await start();
    step(1500);
    const rest = await timer.advanceSession(web, {
      id: session.id,
      expectedPhaseId: session.phase!.id,
      action: "start_break",
    });
    step(100);
    const paused = await timer.pauseSession(mcp, session.id);
    expect(paused.phase).toMatchObject({
      kind: "short_break",
      remainingSeconds: 200,
      state: "paused",
    });
    step(700);
    await timer.resumeSession(web, session.id);
    step(20);
    const next = await timer.advanceSession(mcp, {
      id: session.id,
      expectedPhaseId: rest.phase!.id,
      action: "start_next_focus",
    });
    expect(next.focusSeconds).toBe(1500);
    expect(next.completedFocusCount).toBe(1);
    step(30);
    expect((await timer.finishSession(web, session.id)).durationSeconds).toBe(
      1530,
    );
  });
  it("finish in break saves prior focus; cancellation excludes the entire process", async () => {
    const session = await start();
    step(1500);
    await timer.advanceSession(web, {
      id: session.id,
      expectedPhaseId: session.phase!.id,
      action: "start_break",
    });
    step(180);
    expect((await timer.finishSession(mcp, session.id)).durationSeconds).toBe(
      1500,
    );
    await timer.cancelSession(web, session.id);
    const stats = await statisticsService.getStatistics(web, {
      period: "custom",
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-02T00:00:00Z",
      now: now.toISOString(),
    });
    expect(stats.totalFocusSeconds).toBe(0);
  });
  it("due and break still block goal completion and a second session", async () => {
    const session = await start();
    step(1500);
    await expect(
      timer.startSession(mcp, {
        goalId: session.goalId,
        timerMode: "stopwatch",
      }),
    ).rejects.toMatchObject({ code: "ACTIVE_SESSION_EXISTS" });
    await expect(
      planningService.updateGoal(web, {
        id: session.goalId,
        status: "completed",
      }),
    ).rejects.toMatchObject({ code: "PARENT_HAS_ACTIVE_SESSION" });
    await timer.advanceSession(web, {
      id: session.id,
      expectedPhaseId: session.phase!.id,
      action: "start_break",
    });
    await expect(
      planningService.updateGoal(web, {
        id: session.goalId,
        status: "archived",
      }),
    ).rejects.toMatchObject({ code: "PARENT_HAS_ACTIVE_SESSION" });
  });
  it("finish racing start_break and cancel racing next_focus never leave open intervals", async () => {
    const session = await start();
    step(1500);
    await Promise.allSettled([
      timer.finishSession(web, session.id),
      timer.advanceSession(mcp, {
        id: session.id,
        expectedPhaseId: session.phase!.id,
        action: "start_break",
      }),
    ]);
    const view = await timer.getSession(web, session.id);
    expect(view.status).toBe("completed");
    expect(view.durationSeconds).toBe(1500);
    expect(view.intervals.every((i) => i.endedAt)).toBe(true);
    const second = await timer.startSession(web, {
      goalId: session.goalId,
      timerMode: "pomodoro",
    });
    step(1500);
    await Promise.allSettled([
      timer.advanceSession(mcp, {
        id: second.id,
        expectedPhaseId: second.phase!.id,
        action: "start_next_focus",
      }),
      timer.cancelSession(web, second.id),
    ]);
    const cancelled = await timer.getSession(web, second.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.intervals.every((i) => i.endedAt)).toBe(true);
  });
  it("cross-midnight real intervals allocate focus across days without paused time", async () => {
    await settingsService.update(web, { timezone: "UTC", weekStartsOn: 1 });
    const session = await start();
    // Test clock starts five minutes before midnight using a fresh session.
    await timer.cancelSession(web, session.id);
    now = new Date("2026-10-01T23:55:00Z");
    const late = await timer.startSession(web, {
      goalId: session.goalId,
      timerMode: "pomodoro",
    });
    step(600);
    await timer.pauseSession(web, late.id);
    step(420);
    await timer.resumeSession(web, late.id);
    step(900);
    await timer.finishSession(web, late.id);
    const first = await statisticsService.getStatistics(web, {
      period: "custom",
      from: "2026-10-01",
      to: "2026-10-02",
      now: now.toISOString(),
    });
    const second = await statisticsService.getStatistics(web, {
      period: "custom",
      from: "2026-10-02",
      to: "2026-10-03",
      now: now.toISOString(),
    });
    expect(first.totalFocusSeconds).toBe(300);
    expect(second.totalFocusSeconds).toBe(1200);
  });
});
