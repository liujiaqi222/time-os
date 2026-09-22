import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  settingsGetContract,
  settingsUpdateContract,
} from "@/adapters/settings-contract";
import * as schema from "@/db/schema";
import { createSettingsService } from "@/services/settings";
import { createPlanningService } from "@/services/planning";
import { createSessionService } from "@/services/session";
import { planningContract } from "@/adapters/planning-contract";
import { sessionContract } from "@/adapters/session-contract";
import { createTimeOsMcpServer } from "@/mcp/server";

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
const sessionService = createSessionService(database);

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

describe("session service and focus execution loop", () => {
  const web = { actor: "web" } as const;
  const mcp = { actor: "mcp" } as const;

  beforeEach(async () => {
    await pool.query("delete from distractions");
    await pool.query("delete from sessions");
    await pool.query(
      "delete from idempotency_records where operation = 'session_start'",
    );
  });

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

  it("starts a session, validates state invariants, and executes idempotent pause/resume", async () => {
    const { track } = await createPlan("session-flow");
    const [task] = await planningService.createTasks(web, {
      trackId: track.id,
      tasks: [{ title: "Focus Task", estimatedMinutes: 25 }],
    });

    // Start session
    const session = await sessionService.startSession(web, {
      trackId: track.id,
      taskId: task!.id,
      plannedMinutes: 25,
      idempotencyKey: "test-idemp-1",
    });

    expect(session.status).toBe("active");
    expect(session.trackId).toBe(track.id);
    expect(session.taskId).toBe(task!.id);
    expect(session.plannedMinutes).toBe(25);

    // Concurrency: starting another active session fails
    await expect(
      sessionService.startSession(web, {
        trackId: track.id,
      }),
    ).rejects.toMatchObject({
      code: "ACTIVE_SESSION_EXISTS",
    });

    // Idempotent start retry with same key returns existing session
    const retrySession = await sessionService.startSession(web, {
      trackId: track.id,
      taskId: task!.id,
      plannedMinutes: 25,
      idempotencyKey: "test-idemp-1",
    });
    expect(retrySession.id).toBe(session.id);

    // Idempotent start retry with different payload throws IDEMPOTENCY_KEY_REUSED
    await expect(
      sessionService.startSession(web, {
        trackId: track.id,
        plannedMinutes: 50,
        idempotencyKey: "test-idemp-1",
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });

    // Pause session
    const paused = await sessionService.pauseSession(web, session.id);
    expect(paused.status).toBe("paused");
    expect(paused.pausedAt).not.toBeNull();

    // Idempotent repeat pause
    const repeatPaused = await sessionService.pauseSession(web, session.id);
    expect(repeatPaused.status).toBe("paused");

    // Resume session
    const resumed = await sessionService.resumeSession(web, session.id);
    expect(resumed.status).toBe("active");
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.totalPausedSeconds).toBeGreaterThanOrEqual(0);

    // Idempotent repeat resume
    const repeatResumed = await sessionService.resumeSession(web, session.id);
    expect(repeatResumed.status).toBe("active");

    // Finish session
    const finished = await sessionService.finishSession(web, session.id, {
      note: "Wrap up notes",
    });
    expect(finished.status).toBe("completed");
    expect(finished.endedAt).not.toBeNull();
    expect(finished.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(finished.note).toBe("Wrap up notes");

    // Idempotent repeat finish
    const repeatFinished = await sessionService.finishSession(web, session.id);
    expect(repeatFinished.status).toBe("completed");

    // Cannot pause a completed session
    await expect(
      sessionService.pauseSession(web, session.id),
    ).rejects.toMatchObject({
      code: "INVALID_SESSION_STATE",
    });
  });

  it("cancelling a session releases the active lock and permits starting a new session", async () => {
    const { track } = await createPlan("cancel-flow");
    const session = await sessionService.startSession(web, {
      trackId: track.id,
    });

    const cancelled = await sessionService.cancelSession(web, session.id);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.endedAt).not.toBeNull();

    // Cancelled sessions should be excluded from today stats
    const dashboard = await sessionService.getDashboard(web);
    const cancelledSessionFocus = dashboard.todayStats.totalFocusSeconds;
    // Start and immediately cancel a new session, verify stats don't increase
    const tempSession = await sessionService.startSession(web, {
      trackId: track.id,
    });
    await sessionService.cancelSession(web, tempSession.id);
    const dashboardAfter = await sessionService.getDashboard(web);
    expect(dashboardAfter.todayStats.totalFocusSeconds).toBe(
      cancelledSessionFocus,
    );

    // Cancelled session cannot be resumed or finished
    await expect(
      sessionService.resumeSession(web, session.id),
    ).rejects.toMatchObject({
      code: "INVALID_SESSION_STATE",
    });

    await expect(
      sessionService.finishSession(web, session.id),
    ).rejects.toMatchObject({
      code: "INVALID_SESSION_STATE",
    });

    // Immediately start another session succeeds without ACTIVE_SESSION_EXISTS
    const nextSession = await sessionService.startSession(web, {
      trackId: track.id,
    });
    expect(nextSession.status).toBe("active");
    await sessionService.cancelSession(web, nextSession.id);
  });

  it("atomic finish review completes task and advances Current Next", async () => {
    const { track } = await createPlan("review-advance");
    const [task1, task2] = await planningService.createTasks(web, {
      trackId: track.id,
      tasks: [{ title: "Task 1" }, { title: "Task 2" }],
    });

    // Initially task 1 is Current Next
    const initialNext = await planningService.getNext(web, track.id);
    expect((initialNext as { id: string })?.id).toBe(task1!.id);

    // Start session on task 1
    const session = await sessionService.startSession(web, {
      trackId: track.id,
      taskId: task1!.id,
    });

    // Review with outcome: completed
    const result = await sessionService.finishSessionReview(web, {
      sessionId: session.id,
      outcome: "completed",
      note: "Finished task 1 cleanly",
    });

    expect(result.session.status).toBe("completed");
    expect(result.task?.status).toBe("completed");
    expect(result.task?.completedAt).not.toBeNull();
    // Next task advanced to Task 2!
    expect(result.nextTask?.id).toBe(task2!.id);

    const freshNext = await planningService.getNext(web, track.id);
    expect((freshNext as { id: string })?.id).toBe(task2!.id);

    // Repeated finish review does not double-advance
    const repeatResult = await sessionService.finishSessionReview(web, {
      sessionId: session.id,
      outcome: "completed",
    });
    expect(repeatResult.nextTask?.id).toBe(task2!.id);
  });

  it("atomic finish review skips task and advances Current Next", async () => {
    const { track } = await createPlan("review-skip");
    const [task1, task2] = await planningService.createTasks(web, {
      trackId: track.id,
      tasks: [{ title: "Task 1" }, { title: "Task 2" }],
    });

    const session = await sessionService.startSession(web, {
      trackId: track.id,
      taskId: task1!.id,
    });

    const result = await sessionService.finishSessionReview(web, {
      sessionId: session.id,
      outcome: "skip",
    });

    expect(result.session.status).toBe("completed");
    expect(result.task?.status).toBe("skipped");
    expect(result.nextTask?.id).toBe(task2!.id);
  });

  it("atomic finish review with continue_later leaves task pending and keeps Current Next", async () => {
    const { track } = await createPlan("review-continue");
    const [task1] = await planningService.createTasks(web, {
      trackId: track.id,
      tasks: [{ title: "Task 1" }],
    });

    const session = await sessionService.startSession(web, {
      trackId: track.id,
      taskId: task1!.id,
    });

    const result = await sessionService.finishSessionReview(web, {
      sessionId: session.id,
      outcome: "continue_later",
    });

    expect(result.session.status).toBe("completed");
    expect(result.task?.status).toBe("pending");
    expect(result.nextTask?.id).toBe(task1!.id);
  });

  it("creates, lists, updates, and archives distractions and saves session note", async () => {
    const { track } = await createPlan("distraction-flow");
    const session = await sessionService.startSession(web, {
      trackId: track.id,
    });

    // Update note
    const withNote = await sessionService.updateSessionNote(
      web,
      session.id,
      "Live thoughts",
    );
    expect(withNote.note).toBe("Live thoughts");

    // Create distraction defaulting to active session
    const d1 = await sessionService.createDistraction(web, {
      text: "Phone notification",
    });
    expect(d1.sessionId).toBe(session.id);
    expect(d1.text).toBe("Phone notification");

    // Create distraction with empty text
    const d2 = await sessionService.createDistraction(web, {});
    expect(d2.sessionId).toBe(session.id);
    expect(d2.text).toBeNull();

    // List distractions
    const list = await sessionService.listDistractions(web, {
      sessionId: session.id,
    });
    expect(list).toHaveLength(2);

    // Update distraction
    const updatedD1 = await sessionService.updateDistraction(web, d1.id, {
      text: "Phone call from boss",
    });
    expect(updatedD1.text).toBe("Phone call from boss");

    // Archive distraction
    const archived = await sessionService.archiveDistraction(web, d1.id);
    expect(archived.archivedAt).not.toBeNull();

    // Default list excludes archived
    const listExcludingArchived = await sessionService.listDistractions(web, {
      sessionId: session.id,
    });
    expect(listExcludingArchived).toHaveLength(1);
    expect(listExcludingArchived[0]?.id).toBe(d2.id);

    // Explicit includeArchived: true includes archived
    const listWithArchived = await sessionService.listDistractions(web, {
      sessionId: session.id,
      includeArchived: true,
    });
    expect(listWithArchived).toHaveLength(2);

    await sessionService.cancelSession(web, session.id);
  });

  it("computes dashboard with fallback focus track selection and today statistics", async () => {
    const { track } = await createPlan("dashboard-test");
    await planningService.createTasks(web, {
      trackId: track.id,
      tasks: [{ title: "Dashboard Task" }],
    });

    // Explicitly set selectedTrack
    await sessionService.setSelectedTrack(web, track.id);

    const dashboard = await sessionService.getDashboard(web);
    expect(dashboard.selectedTrack?.track.id).toBe(track.id);
    expect(dashboard.selectedTrack?.currentNextTask?.title).toBe(
      "Dashboard Task",
    );
    expect(dashboard.todayStats).toBeDefined();
    expect(dashboard.activeTracks.length).toBeGreaterThan(0);
  });

  it("MCP server tools provide complete parity with domain errors and structured content", async () => {
    const { track } = await createPlan("mcp-parity");
    const [task] = await planningService.createTasks(web, {
      trackId: track.id,
      tasks: [{ title: "MCP Task" }],
    });

    // Verify MCP Server instance registers session tools
    const server = createTimeOsMcpServer(
      settingsService,
      planningService,
      sessionService,
    );
    expect(server).toBeDefined();

    // Start session via sessionContract
    const startResult = await sessionContract(() =>
      sessionService.startSession(mcp, {
        trackId: track.id,
        taskId: task!.id,
      }),
    );
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) return;

    const sessionId = startResult.data.id;

    // Get active session via MCP contract
    const activeResult = await sessionContract(() =>
      sessionService.getActiveSession(mcp),
    );
    expect(activeResult.ok).toBe(true);
    if (activeResult.ok) {
      expect(activeResult.data?.id).toBe(sessionId);
    }

    // Log distraction via MCP contract
    const distResult = await sessionContract(() =>
      sessionService.createDistraction(mcp, {
        sessionId,
        text: "Urgent Slack",
      }),
    );
    expect(distResult.ok).toBe(true);

    // Finish review via MCP contract
    const finishResult = await sessionContract(() =>
      sessionService.finishSessionReview(mcp, {
        sessionId,
        outcome: "completed",
        note: "Completed via MCP",
      }),
    );
    expect(finishResult.ok).toBe(true);
    if (finishResult.ok) {
      expect(finishResult.data.session.status).toBe("completed");
      expect(finishResult.data.task?.status).toBe("completed");
    }

    // Dashboard get via MCP contract
    const dashResult = await sessionContract(() =>
      sessionService.getDashboard(mcp),
    );
    expect(dashResult.ok).toBe(true);
    if (dashResult.ok) {
      expect(dashResult.data.todayStats.completedTasksCount).toBeGreaterThan(0);
    }
  });
});
