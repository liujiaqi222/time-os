import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  errorMessage,
  settingsGetContract,
  settingsUpdateContract,
} from "@/adapters/settings-contract";
import { planningContract } from "@/adapters/planning-contract";
import { sessionContract } from "@/adapters/session-contract";
import type { PlanningService } from "@/services/planning";
import type { SessionService } from "@/services/session";
import type { SettingsService } from "@/services/settings";
import {
  goalCreateSchema,
  goalUpdateSchema,
  listSchema,
  taskUpdateSchema,
  tasksCreateSchema,
  trackCreateSchema,
  trackUpdateSchema,
} from "@/shared/schemas/planning";
import {
  distractionCreateSchema,
  distractionListSchema,
  distractionUpdateSchema,
  sessionFinishSchema,
  sessionStartSchema,
} from "@/shared/schemas/session";
import { updateSettingsSchema } from "@/shared/schemas/settings";

const context = { actor: "mcp" } as const;

function toolResult(result: object, error?: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
    ...(error ? { isError: true } : {}),
  };
}

export function createTimeOsMcpServer(
  settingsService: SettingsService,
  planningService: PlanningService,
  sessionService?: SessionService,
) {
  const server = new McpServer({ name: "time-os", version: "0.1.0" });

  server.registerTool(
    "system_health",
    {
      title: "Time OS health",
      description:
        "Check that the authenticated Time OS endpoint and database schema are ready.",
      inputSchema: z.object({}),
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
        "Read Time OS timezone, default focus duration, and week start.",
      inputSchema: z.object({}),
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
      description:
        "Update Time OS timezone, default focus duration, and week start.",
      inputSchema: updateSettingsSchema,
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

  const planningTool = <T extends object>(
    name: string,
    options: {
      title: string;
      description: string;
      inputSchema: z.ZodType;
    },
    operation: (input: T) => Promise<unknown>,
  ) => {
    server.registerTool(name, options, async (input) => {
      const result = await planningContract(() => operation(input as T));
      return toolResult(
        result,
        result.ok ? undefined : errorMessage(result.error),
      );
    });
  };

  planningTool(
    "goals_list",
    {
      title: "List goals",
      description:
        "List active Goals by default, or include completed and archived Goals with filters.",
      inputSchema: listSchema,
    },
    (input) => planningService.listGoals(context, input),
  );
  planningTool(
    "goal_create",
    {
      title: "Create goal",
      description: "Create an active Goal at the end of the Goal order.",
      inputSchema: goalCreateSchema,
    },
    (input: z.input<typeof goalCreateSchema>) =>
      planningService.createGoal(context, input),
  );
  planningTool(
    "goal_update",
    {
      title: "Update goal",
      description:
        "Edit or change Goal lifecycle status. A Goal with a running Session cannot be completed or archived.",
      inputSchema: goalUpdateSchema,
    },
    (input: z.input<typeof goalUpdateSchema>) =>
      planningService.updateGoal(context, input),
  );
  planningTool(
    "goals_reorder",
    {
      title: "Reorder goals",
      description:
        "Replace the complete Goal order. Every Goal ID must appear exactly once.",
      inputSchema: z.object({ ids: z.array(z.string().uuid()).min(1) }),
    },
    (input: { ids: string[] }) =>
      planningService.reorderGoals(context, input.ids),
  );
  planningTool(
    "tracks_list",
    {
      title: "List tracks",
      description:
        "List Tracks in a Goal with lifecycle filters and safe pagination.",
      inputSchema: listSchema.extend({ goalId: z.string().uuid() }),
    },
    ({ goalId, ...input }: { goalId: string } & z.input<typeof listSchema>) =>
      planningService.listTracks(context, goalId, input),
  );
  planningTool(
    "track_create",
    {
      title: "Create track",
      description: "Create an active Track inside a Goal.",
      inputSchema: trackCreateSchema,
    },
    (input: z.input<typeof trackCreateSchema>) =>
      planningService.createTrack(context, input),
  );
  planningTool(
    "track_update",
    {
      title: "Update track",
      description:
        "Edit or change Track lifecycle status. A Track with a running Session cannot be completed or archived.",
      inputSchema: trackUpdateSchema,
    },
    (input: z.input<typeof trackUpdateSchema>) =>
      planningService.updateTrack(context, input),
  );
  planningTool(
    "tracks_reorder",
    {
      title: "Reorder tracks",
      description: "Replace the complete Track order within one Goal.",
      inputSchema: z.object({
        goalId: z.string().uuid(),
        ids: z.array(z.string().uuid()).min(1),
      }),
    },
    (input: { goalId: string; ids: string[] }) =>
      planningService.reorderTracks(context, input.goalId, input.ids),
  );
  planningTool(
    "tasks_list",
    {
      title: "List tasks",
      description:
        "List Tasks in a Track with status filters and safe pagination.",
      inputSchema: listSchema.extend({ trackId: z.string().uuid() }),
    },
    ({ trackId, ...input }: { trackId: string } & z.input<typeof listSchema>) =>
      planningService.listTasks(context, trackId, input),
  );
  planningTool(
    "tasks_create",
    {
      title: "Create tasks",
      description:
        "Create 1–50 Tasks in order. The first pending Task becomes Current Next only when the Track has none. An idempotency key makes retries safe.",
      inputSchema: tasksCreateSchema,
    },
    (input: z.input<typeof tasksCreateSchema>) =>
      planningService.createTasks(context, input),
  );
  planningTool(
    "task_update",
    {
      title: "Update task",
      description:
        "Edit Task content, estimate, note, and paired resource fields.",
      inputSchema: taskUpdateSchema,
    },
    (input: z.input<typeof taskUpdateSchema>) =>
      planningService.updateTask(context, input),
  );
  planningTool(
    "tasks_reorder",
    {
      title: "Reorder tasks",
      description:
        "Replace the complete Task order without changing Current Next.",
      inputSchema: z.object({
        trackId: z.string().uuid(),
        ids: z.array(z.string().uuid()).min(1),
      }),
    },
    (input: { trackId: string; ids: string[] }) =>
      planningService.reorderTasks(context, input.trackId, input.ids),
  );

  for (const [name, title, operation] of [
    [
      "task_complete",
      "Complete task",
      planningService.completeTask.bind(planningService),
    ],
    ["task_skip", "Skip task", planningService.skipTask.bind(planningService)],
    [
      "task_archive",
      "Archive task",
      planningService.archiveTask.bind(planningService),
    ],
    [
      "task_reopen",
      "Reopen task",
      planningService.reopenTask.bind(planningService),
    ],
  ] as const) {
    planningTool(
      name,
      {
        title,
        description: `${title}. If it is Current Next, the pointer advances atomically; reopening never takes over Current Next.`,
        inputSchema: z.object({ id: z.string().uuid() }),
      },
      (input: { id: string }) => operation(context, input.id),
    );
  }

  planningTool(
    "next_get",
    {
      title: "Get Current Next",
      description:
        "Read Current Next for one Track, or for every active Track when trackId is omitted.",
      inputSchema: z.object({ trackId: z.string().uuid().optional() }),
    },
    (input: { trackId?: string }) =>
      planningService.getNext(context, input.trackId),
  );
  planningTool(
    "next_set",
    {
      title: "Set Current Next",
      description:
        "Set Current Next to a pending Task in the same Track, or explicitly clear it with null.",
      inputSchema: z.object({
        trackId: z.string().uuid(),
        taskId: z.string().uuid().nullable(),
      }),
    },
    (input: { trackId: string; taskId: string | null }) =>
      planningService.setNext(context, input.trackId, input.taskId),
  );

  if (sessionService) {
    const sessionTool = <T extends object>(
      name: string,
      options: {
        title: string;
        description: string;
        inputSchema: z.ZodType;
      },
      operation: (input: T) => Promise<unknown>,
    ) => {
      server.registerTool(name, options, async (input) => {
        const result = await sessionContract(() => operation(input as T));
        return toolResult(
          result,
          result.ok ? undefined : errorMessage(result.error),
        );
      });
    };

    sessionTool(
      "dashboard_get",
      {
        title: "Get dashboard",
        description:
          "Read real-time today focus statistics, active session, selected focus track, and all active tracks with their current next task.",
        inputSchema: z.object({
          manualTrackId: z.string().uuid().optional(),
        }),
      },
      (input) => sessionService.getDashboard(context, input),
    );

    sessionTool(
      "session_get_active",
      {
        title: "Get active session",
        description:
          "Read the single active or paused Session, or return null if none is running.",
        inputSchema: z.object({}),
      },
      () => sessionService.getActiveSession(context),
    );

    sessionTool(
      "session_get",
      {
        title: "Get session",
        description:
          "Read complete Session details including Track, optional Task, and active Distractions.",
        inputSchema: z.object({ id: z.string().uuid() }),
      },
      (input: { id: string }) => sessionService.getSession(context, input.id),
    );

    sessionTool(
      "session_start",
      {
        title: "Start session",
        description:
          "Start a focus timer for a Track, optionally linked to a pending Task. Fails if another session is already active or paused.",
        inputSchema: sessionStartSchema,
      },
      (input: z.input<typeof sessionStartSchema>) =>
        sessionService.startSession(context, input),
    );

    sessionTool(
      "session_pause",
      {
        title: "Pause session",
        description:
          "Pause a currently active focus session. Idempotent if already paused.",
        inputSchema: z.object({ id: z.string().uuid() }),
      },
      (input: { id: string }) => sessionService.pauseSession(context, input.id),
    );

    sessionTool(
      "session_resume",
      {
        title: "Resume session",
        description:
          "Resume a paused focus session. Idempotent if already active.",
        inputSchema: z.object({ id: z.string().uuid() }),
      },
      (input: { id: string }) =>
        sessionService.resumeSession(context, input.id),
    );

    sessionTool(
      "session_finish",
      {
        title: "Finish session",
        description:
          "Finish a focus session, optionally reviewing and advancing the associated Task (continue_later, completed, or skip) atomically.",
        inputSchema: sessionFinishSchema,
      },
      (input: z.input<typeof sessionFinishSchema>) => {
        if (input.outcome) {
          return sessionService.finishSessionReview(context, {
            sessionId: input.id,
            note: input.note,
            outcome: input.outcome,
          });
        }
        return sessionService.finishSession(context, input.id, {
          note: input.note,
        });
      },
    );

    sessionTool(
      "session_cancel",
      {
        title: "Cancel session",
        description:
          "Cancel an active or paused session. Excluded from default history and stats; releases the active session lock.",
        inputSchema: z.object({ id: z.string().uuid() }),
      },
      (input: { id: string }) =>
        sessionService.cancelSession(context, input.id),
    );

    sessionTool(
      "distractions_list",
      {
        title: "List distractions",
        description:
          "List distractions logged for a session (defaults to the currently active or paused session).",
        inputSchema: distractionListSchema,
      },
      (input: z.input<typeof distractionListSchema>) =>
        sessionService.listDistractions(context, input),
    );

    sessionTool(
      "distraction_log",
      {
        title: "Log distraction",
        description:
          "Record a quick distraction during a focus session (defaults to the currently active or paused session).",
        inputSchema: distractionCreateSchema,
      },
      (input: z.input<typeof distractionCreateSchema>) =>
        sessionService.createDistraction(context, input),
    );

    sessionTool(
      "distraction_update",
      {
        title: "Update distraction",
        description: "Edit the text content of a distraction note.",
        inputSchema: distractionUpdateSchema,
      },
      (input: z.input<typeof distractionUpdateSchema>) =>
        sessionService.updateDistraction(context, input.id, {
          text: input.text,
        }),
    );

    sessionTool(
      "distraction_archive",
      {
        title: "Archive distraction",
        description:
          "Soft-archive a distraction note so it is hidden from default view.",
        inputSchema: z.object({ id: z.string().uuid() }),
      },
      (input: { id: string }) =>
        sessionService.archiveDistraction(context, input.id),
    );
  }

  return server;
}
