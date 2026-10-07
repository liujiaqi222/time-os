import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import { goals, sessions, tasks, type Goal, type Task } from "@/db/schema";
import { appSettings, type AppSettings } from "@/db/schema";
import type { SelectionReason } from "@/shared/selection";
import type { SessionService, SessionView } from "@/services/session";
import type { SelectionService } from "@/services/selection";
import type { StatisticsService } from "@/services/statistics";

/**
 * Read model for the execution home (PRD §5.1). Composes the Session,
 * Selection and Statistics interfaces; the only tables it reads directly
 * are the ones no other module owns: hint lookup, todos and goal counts.
 */

export interface DashboardSelection {
  goal: Goal;
  task: Task | null;
  goalOnly: boolean;
  reason: SelectionReason;
}

export interface DashboardGoalItem {
  goal: Goal;
  pendingTaskCount: number;
}

export interface TodayStats {
  totalFocusSeconds: number;
  sessionCount: number;
  completedTasksCount: number;
}

export interface DashboardData {
  timerSettings?: Pick<AppSettings, "timerMode" | "timerPreferences">;
  serverNow: string;
  activeSession: SessionView | null;
  selection: DashboardSelection | null;
  /** Resume hint for the idle continuation, null while a Session runs. */
  resumeHint: string | null;
  /** A few pending Tasks of the selected Goal (PRD §5.1). */
  todos: Task[];
  goals: DashboardGoalItem[];
  todayStats: TodayStats;
}

export interface DashboardService {
  getDashboard(context: AuthenticatedContext): Promise<DashboardData>;
}

/** The latest effective completed Session's resume hint (PRD §5.3). */
async function latestResumeHint(
  database: Database,
  target: { taskId: string } | { goalId: string; goalOnly: true },
): Promise<string | null> {
  const conditions = [
    eq(sessions.status, "completed"),
    isNotNull(sessions.endedAt),
    sql`${sessions.durationSeconds} > 0`,
  ];
  if ("taskId" in target) {
    conditions.push(eq(sessions.taskId, target.taskId));
  } else {
    // Goal-only continuation reads only goal-only records.
    conditions.push(eq(sessions.goalId, target.goalId));
    conditions.push(sql`${sessions.taskId} is null`);
  }
  const [row] = await database
    .select({ resumeHint: sessions.resumeHint })
    .from(sessions)
    .where(and(...conditions))
    .orderBy(desc(sessions.endedAt), desc(sessions.startedAt))
    .limit(1);
  return row?.resumeHint ?? null;
}

export function createDashboardService(
  database: Database,
  deps: {
    sessionService: Pick<SessionService, "getActiveSession">;
    selectionService: Pick<SelectionService, "resolve">;
    statisticsService: Pick<StatisticsService, "getStatistics">;
  },
): DashboardService {
  const { sessionService, selectionService, statisticsService } = deps;

  return {
    async getDashboard(context) {
      void context;
      const now = new Date();
      const [
        activeSession,
        resolved,
        todayStats,
        activeGoalRows,
        pendingCounts,
      ] = await Promise.all([
        sessionService.getActiveSession(context),
        selectionService.resolve(context),
        statisticsService.getStatistics(context, {
          period: "today",
          now: now.toISOString(),
        }),
        database
          .select({ goal: goals })
          .from(goals)
          .where(eq(goals.status, "active"))
          .orderBy(asc(goals.position)),
        // Pending Task counts for the switcher, one query for all goals.
        database
          .select({
            goalId: tasks.goalId,
            count: sql<number>`count(*)`,
          })
          .from(tasks)
          .where(eq(tasks.status, "pending"))
          .groupBy(tasks.goalId),
      ]);

      const pendingByGoal = new Map(
        pendingCounts.map((row) => [row.goalId, Number(row.count)]),
      );

      let selection: DashboardSelection | null = null;
      let resumeHint: string | null = null;
      let todos: Task[] = [];

      if (resolved) {
        const [goalRows, taskRows, pendingTasks, hint] = await Promise.all([
          database
            .select()
            .from(goals)
            .where(eq(goals.id, resolved.goalId))
            .limit(1),
          resolved.taskId
            ? database
                .select()
                .from(tasks)
                .where(eq(tasks.id, resolved.taskId))
                .limit(1)
            : Promise.resolve([] as Task[]),
          database
            .select()
            .from(tasks)
            .where(
              and(
                eq(tasks.goalId, resolved.goalId),
                eq(tasks.status, "pending"),
              ),
            )
            .orderBy(asc(tasks.position))
            .limit(8),
          activeSession
            ? Promise.resolve(null)
            : resolved.taskId
              ? latestResumeHint(database, { taskId: resolved.taskId })
              : latestResumeHint(database, {
                  goalId: resolved.goalId,
                  goalOnly: true,
                }),
        ]);
        const [goal] = goalRows;
        if (goal) {
          const [task] = taskRows;
          selection = {
            goal,
            task: task ?? null,
            goalOnly: resolved.taskId === null,
            reason: resolved.reason,
          };
          todos = pendingTasks;
          resumeHint = hint;
        }
      }

      const [settings] = await database
        .select()
        .from(appSettings)
        .where(eq(appSettings.id, "default"));
      return {
        timerSettings: settings
          ? {
              timerMode: settings.timerMode,
              timerPreferences: settings.timerPreferences,
            }
          : { timerMode: "pomodoro", timerPreferences: null },
        serverNow: now.toISOString(),
        activeSession,
        selection,
        resumeHint,
        todos,
        goals: activeGoalRows.map((row) => ({
          goal: row.goal,
          pendingTaskCount: pendingByGoal.get(row.goal.id) ?? 0,
        })),
        todayStats: {
          totalFocusSeconds: todayStats.totalFocusSeconds,
          sessionCount: todayStats.sessionCount,
          completedTasksCount: todayStats.completedTaskCount,
        },
      };
    },
  };
}
