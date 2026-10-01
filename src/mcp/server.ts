import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  errorMessage,
  settingsGetContract,
  settingsUpdateContract,
} from "@/adapters/settings-contract";
import { sessionContract } from "@/adapters/session-contract";
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "@/auth/scopes";
import type { DashboardService } from "@/services/dashboard";
import type { DistractionService } from "@/services/distraction";
import type { PlanningService } from "@/services/planning";
import type { SelectionService } from "@/services/selection";
import type { SessionService } from "@/services/session";
import type { SettingsService } from "@/services/settings";
import type { HistoryService } from "@/services/history";
import type { StatisticsService } from "@/services/statistics";
import {
  goalCreateSchema,
  goalUpdateSchema,
  listSchema,
  taskUpdateSchema,
  tasksCreateSchema,
} from "@/shared/schemas/planning";
import {
  dashboardQuerySchema,
  distractionCreateSchema,
  distractionListSchema,
  distractionUpdateSchema,
  sessionCancelSchema,
  sessionFinishSchema,
  sessionListSchema,
  sessionLogSchema,
  sessionNoteUpdateSchema,
  sessionPauseSchema,
  sessionResumeHintUpdateSchema,
  sessionResumeSchema,
  sessionStartSchema,
  sessionUpdateSchema,
  statsQuerySchema,
} from "@/shared/schemas/session";
import { updateSettingsSchema } from "@/shared/schemas/settings";

const context = { actor: "mcp" } as const;
const oauthSecuritySchemes = [
  { type: "oauth2", scopes: [MCP_READ_SCOPE, MCP_WRITE_SCOPE] },
];
const oauthToolMeta = { securitySchemes: oauthSecuritySchemes };
const readOnlyTools = new Set([
  "system_health",
  "settings_get",
  "dashboard_get",
  "goals_list",
  "goal_get",
  "tasks_list",
  "distractions_list",
  "sessions_list",
  "stats_get",
]);

function toolAnnotations(name: string) {
  return {
    readOnlyHint: readOnlyTools.has(name),
    destructiveHint: false,
    openWorldHint: false,
  };
}

function toolResult(result: object, error?: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
    ...(error ? { isError: true } : {}),
  };
}

/**
 * The v3 MCP surface (PRD §9.2). Web and MCP call the same domain
 * services; every tool maps a domain error into a structured result.
 * Track / Current-Next registrations are gone — Goal, Task and Session
 * hang off each other directly.
 */
export function createTimeOsMcpServer(deps: {
  settingsService: SettingsService;
  planningService: PlanningService;
  selectionService: SelectionService;
  sessionService: SessionService;
  distractionService: DistractionService;
  dashboardService: DashboardService;
  historyService: HistoryService;
  statisticsService: StatisticsService;
}) {
  const {
    settingsService,
    planningService,
    selectionService,
    sessionService,
    distractionService,
    dashboardService,
    historyService,
    statisticsService,
  } = deps;
  const server = new McpServer({ name: "time-os", version: "0.3.0" });

  server.registerTool(
    "system_health",
    {
      title: "Time OS health",
      description:
        "Check that the authenticated Time OS endpoint and database schema are ready.",
      inputSchema: z.object({}).strict(),
      annotations: toolAnnotations("system_health"),
      _meta: oauthToolMeta,
    },
    async () => {
      try {
        await settingsService.checkSchema(context);
        return toolResult({ ok: true, data: { status: "ready" } });
      } catch {
        return toolResult(
          {
            ok: false,
            error: {
              code: "SCHEMA_NOT_READY",
              message: "The Time OS database schema is not ready.",
            },
          },
          "Schema is not ready",
        );
      }
    },
  );

  server.registerTool(
    "settings_get",
    {
      title: "Get settings",
      description:
        "Read Time OS timezone, week start, and preferred timer mode.",
      inputSchema: z.object({}).strict(),
      annotations: toolAnnotations("settings_get"),
      _meta: oauthToolMeta,
    },
    async () => {
      const result = await settingsGetContract(settingsService, context);
      return toolResult(
        result,
        result.ok ? undefined : errorMessage(result.error),
      );
    },
  );

  server.registerTool(
    "settings_update",
    {
      title: "Update settings",
      description: "Update Time OS timezone and week start.",
      inputSchema: updateSettingsSchema,
      annotations: toolAnnotations("settings_update"),
      _meta: oauthToolMeta,
    },
    async (input) => {
      const result = await settingsUpdateContract(
        settingsService,
        context,
        input,
      );
      return toolResult(
        result,
        result.ok ? undefined : errorMessage(result.error),
      );
    },
  );

  // One generic wrapper for every Result-shaped domain tool: structured
  // errors come back as { ok: false, error: { code, message } }.
  const domainTool = <T extends object>(
    name: string,
    options: {
      title: string;
      description: string;
      inputSchema: z.ZodType;
    },
    operation: (input: T) => Promise<unknown>,
  ) => {
    server.registerTool(
      name,
      {
        ...options,
        annotations: toolAnnotations(name),
        _meta: oauthToolMeta,
      },
      async (input) => {
        const result = await sessionContract(() => operation(input as T));
        return toolResult(
          result,
          result.ok ? undefined : errorMessage(result.error),
        );
      },
    );
  };

  // ---- Execution context -------------------------------------------------

  domainTool(
    "dashboard_get",
    {
      title: "Get dashboard",
      description:
        "Read serverNow, the unfinished Session, the effective selection with its resume hint, a few pending todos, active goals, and today's summary.",
      inputSchema: dashboardQuerySchema,
    },
    () => dashboardService.getDashboard(context),
  );

  domainTool(
    "selection_set",
    {
      title: "Set selection",
      description:
        "Set the execution selection to an active Goal. Omit taskId to auto-pick the Goal's next pending Task; pass null for explicit goal-only execution.",
      inputSchema: z
        .object({
          goalId: z.string().uuid(),
          taskId: z.string().uuid().nullable().optional(),
        })
        .strict(),
    },
    (input: { goalId: string; taskId?: string | null }) =>
      selectionService.set(context, input),
  );

  domainTool(
    "selection_clear",
    {
      title: "Clear selection",
      description: "Clear the stored execution selection entirely.",
      inputSchema: z.object({}).strict(),
    },
    () => selectionService.clear(context),
  );

  // ---- Goals --------------------------------------------------------------

  domainTool(
    "goals_list",
    {
      title: "List goals",
      description:
        "List active Goals by default, or include completed and archived Goals with filters.",
      inputSchema: listSchema,
    },
    (input) => planningService.listGoals(context, input),
  );

  domainTool(
    "goal_get",
    {
      title: "Get goal",
      description: "Read one Goal by id.",
      inputSchema: z.object({ id: z.string().uuid() }).strict(),
    },
    (input: { id: string }) => planningService.getGoal(context, input.id),
  );

  domainTool(
    "goal_create",
    {
      title: "Create goal",
      description: "Create an active Goal at the end of the Goal order.",
      inputSchema: goalCreateSchema,
    },
    (input: z.output<typeof goalCreateSchema>) =>
      planningService.createGoal(context, input),
  );

  domainTool(
    "goal_update",
    {
      title: "Update goal",
      description:
        "Edit or change Goal lifecycle status. A Goal with an unfinished Session cannot be completed or archived.",
      inputSchema: goalUpdateSchema,
    },
    (input: z.output<typeof goalUpdateSchema>) =>
      planningService.updateGoal(context, input),
  );

  domainTool(
    "goals_reorder",
    {
      title: "Reorder goals",
      description:
        "Replace the complete Goal order. Every Goal ID must appear exactly once.",
      inputSchema: z
        .object({ ids: z.array(z.string().uuid()).min(1) })
        .strict(),
    },
    (input: { ids: string[] }) =>
      planningService.reorderGoals(context, input.ids),
  );

  // ---- Tasks --------------------------------------------------------------

  domainTool(
    "tasks_list",
    {
      title: "List tasks",
      description:
        "List Tasks in a Goal with status filters and safe pagination.",
      inputSchema: listSchema.extend({ goalId: z.string().uuid() }).strict(),
    },
    ({ goalId, ...input }: { goalId: string } & z.output<typeof listSchema>) =>
      planningService.listTasks(context, goalId, input),
  );

  domainTool(
    "tasks_create",
    {
      title: "Create tasks",
      description:
        "Create 1–50 Tasks in order inside a Goal. Never changes the stored selection. An idempotency key makes retries safe.",
      inputSchema: tasksCreateSchema,
    },
    (input: z.output<typeof tasksCreateSchema>) =>
      planningService.createTasks(context, input),
  );

  domainTool(
    "tasks_reorder",
    {
      title: "Reorder tasks",
      description:
        "Replace the complete Task order within one Goal. A still-valid explicit selection survives.",
      inputSchema: z
        .object({
          goalId: z.string().uuid(),
          ids: z.array(z.string().uuid()).min(1),
        })
        .strict(),
    },
    (input: { goalId: string; ids: string[] }) =>
      planningService.reorderTasks(context, input.goalId, input.ids),
  );

  domainTool(
    "task_update",
    {
      title: "Update task",
      description:
        "Edit Task content, estimate, note, and paired resource fields. Only pending Tasks can be edited.",
      inputSchema: taskUpdateSchema,
    },
    (input: z.output<typeof taskUpdateSchema>) =>
      planningService.updateTask(context, input),
  );

  for (const [name, title, operation, description] of [
    [
      "task_complete",
      "Complete task",
      planningService.completeTask.bind(planningService),
      "Marks the Task completed. If it is the selected Task, the selection advances atomically (same-Goal next pending → first pending → goal-only); completing another Task never steals the selection. Blocked while an unfinished Session is attached.",
    ],
    [
      "task_skip",
      "Skip task",
      planningService.skipTask.bind(planningService),
      "Skips the pending Task with the same selection and Session rules as task_complete.",
    ],
    [
      "task_archive",
      "Archive task",
      planningService.archiveTask.bind(planningService),
      "Archives the pending Task with the same selection and Session rules as task_complete.",
    ],
    [
      "task_reopen",
      "Reopen task",
      planningService.reopenTask.bind(planningService),
      "Reopens a non-pending Task; never takes over the selection.",
    ],
  ] as const) {
    domainTool(
      name,
      {
        title,
        description,
        inputSchema: z.object({ id: z.string().uuid() }).strict(),
      },
      (input: { id: string }) => operation(context, input.id),
    );
  }

  // ---- Sessions (stopwatch execution loop) ---------------------------------

  domainTool(
    "session_get_active",
    {
      title: "Get active session",
      description:
        "Read the single unfinished (active or paused) Session with goal, task, intervals, serverNow and available actions, or null if none is running.",
      inputSchema: z.object({}).strict(),
    },
    () => sessionService.getActiveSession(context),
  );

  domainTool(
    "session_get",
    {
      title: "Get session",
      description:
        "Read complete Session details including Goal, optional Task, focus intervals and distractions.",
      inputSchema: z.object({ id: z.string().uuid() }).strict(),
    },
    (input: { id: string }) => sessionService.getSession(context, input.id),
  );

  domainTool(
    "session_start",
    {
      title: "Start session",
      description:
        "Start a stopwatch Session for a Goal. taskId omitted or null means goal-only execution; attaching a Task requires its exact id (never auto-picked). Fails with ACTIVE_SESSION_EXISTS if an unfinished Session already exists. On success the selection syncs to the started object.",
      inputSchema: sessionStartSchema,
    },
    (input: z.output<typeof sessionStartSchema>) =>
      sessionService.startSession(context, input),
  );

  domainTool(
    "session_pause",
    {
      title: "Pause session",
      description:
        "Pause the running Session, closing its open focus interval. Idempotent when already paused.",
      inputSchema: sessionPauseSchema,
    },
    (input: { id: string }) => sessionService.pauseSession(context, input.id),
  );

  domainTool(
    "session_resume",
    {
      title: "Resume session",
      description:
        "Resume a paused Session, opening a new focus interval. Idempotent when already running.",
      inputSchema: sessionResumeSchema,
    },
    (input: { id: string }) => sessionService.resumeSession(context, input.id),
  );

  domainTool(
    "session_finish",
    {
      title: "Finish session",
      description:
        "Finish the Session and save its authoritative focus time from the observed intervals. Idempotent retries return the same completed record. Task completion is a separate explicit action (task_complete), not part of finishing.",
      inputSchema: sessionFinishSchema,
    },
    (input: z.output<typeof sessionFinishSchema>) =>
      sessionService.finishSession(context, input.id, input),
  );

  domainTool(
    "session_cancel",
    {
      title: "Cancel session",
      description:
        "Cancel a Session as a mis-start or void record. The record is kept but excluded from default history and statistics; the exclusivity slot is released and it can never be revived.",
      inputSchema: sessionCancelSchema,
    },
    (input: { id: string }) => sessionService.cancelSession(context, input.id),
  );

  domainTool(
    "session_note_update",
    {
      title: "Update session note",
      description:
        "Save the Session note with an expected content version. A stale version returns VERSION_CONFLICT instead of overwriting newer text.",
      inputSchema: sessionNoteUpdateSchema,
    },
    (input: z.output<typeof sessionNoteUpdateSchema>) =>
      sessionService.updateNote(context, input),
  );

  domainTool(
    "session_resume_hint_update",
    {
      title: "Update resume hint",
      description:
        "Save the resume hint for the next continuation, with an expected content version. Allowed on active, paused and completed Sessions; its failure never rolls back saved time.",
      inputSchema: sessionResumeHintUpdateSchema,
    },
    (input: z.output<typeof sessionResumeHintUpdateSchema>) =>
      sessionService.updateResumeHint(context, input),
  );

  // ---- History / statistics ----------------------------------------------

  domainTool(
    "sessions_list",
    {
      title: "List sessions",
      description:
        "List Session history with half-open time boundaries and safe cursor pagination. Cancelled records are hidden unless explicitly requested.",
      inputSchema: sessionListSchema,
    },
    (input: z.output<typeof sessionListSchema>) =>
      historyService.listSessions(context, input),
  );

  domainTool(
    "session_log",
    {
      title: "Log manual session",
      description:
        "Log completed focus time against a Goal (Task and text optional). Overlap requires an explicit retry with allowOverlap=true; idempotencyKey makes retries safe. Manual logs never touch the selection.",
      inputSchema: sessionLogSchema,
    },
    (input: z.output<typeof sessionLogSchema>) =>
      historyService.logSession(context, input),
  );

  domainTool(
    "session_update",
    {
      title: "Correct session",
      description:
        "Correct a completed Session's ownership, times, or text. Time edits switch the statistics basis to corrected while keeping the original intervals. Overlap requires allowOverlap=true.",
      inputSchema: sessionUpdateSchema,
    },
    (input: z.output<typeof sessionUpdateSchema>) =>
      historyService.updateSession(context, input),
  );

  domainTool(
    "stats_get",
    {
      title: "Get focus statistics",
      description:
        "Get today, week, month, or custom focus totals by Goal, using the configured timezone and real interval math.",
      inputSchema: statsQuerySchema,
    },
    (input: z.output<typeof statsQuerySchema>) =>
      statisticsService.getStatistics(context, input),
  );

  // ---- Distractions -------------------------------------------------------

  domainTool(
    "distractions_list",
    {
      title: "List distractions",
      description:
        "List distractions logged for a Session (defaults to the currently unfinished Session).",
      inputSchema: distractionListSchema,
    },
    (input: z.output<typeof distractionListSchema>) =>
      distractionService.listDistractions(context, input),
  );

  domainTool(
    "distraction_log",
    {
      title: "Log distraction",
      description:
        "Record a quick distraction during a Session (defaults to the currently unfinished Session).",
      inputSchema: distractionCreateSchema,
    },
    (input: z.output<typeof distractionCreateSchema>) =>
      distractionService.createDistraction(context, input),
  );

  domainTool(
    "distraction_update",
    {
      title: "Update distraction",
      description: "Edit the text content of a distraction note.",
      inputSchema: distractionUpdateSchema,
    },
    (input: z.output<typeof distractionUpdateSchema>) =>
      distractionService.updateDistraction(context, input.id, {
        text: input.text,
      }),
  );

  domainTool(
    "distraction_archive",
    {
      title: "Archive distraction",
      description:
        "Soft-archive a distraction note so it is hidden from default view.",
      inputSchema: z.object({ id: z.string().uuid() }).strict(),
    },
    (input: { id: string }) =>
      distractionService.archiveDistraction(context, input.id),
  );

  return server;
}
