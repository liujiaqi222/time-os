import { and, eq, gt, inArray, isNotNull, lt, ne, or, sql } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import { goals, sessions, tasks } from "@/db/schema";
import {
  computeFocusTotals,
  focusSecondsInRange,
  type SessionFocusSlice,
} from "@/shared/focus-intervals";
import {
  statsQuerySchema,
  type StatsQueryInput,
} from "@/shared/schemas/session";
import {
  addLocalDays,
  getLocalPeriodInterval,
  localDateKey,
  localDateStart,
} from "@/shared/timezone";
import { invalid, parsed } from "@/services/service-kit";
import { intervalsOfSessions } from "@/services/history";
import type { SettingsService } from "@/services/settings";

/**
 * Focus statistics (PRD §7.2). Today, History and stats_get all flow
 * through this one implementation: observed Sessions count their real
 * focus intervals; manual / corrected Sessions apportion the declared
 * duration; cancelled Sessions never contribute.
 */

export interface GoalStatistics {
  goalId: string;
  title: string;
  status: "active" | "completed" | "archived";
  focusSeconds: number;
}

export interface Statistics {
  timezone: string;
  period: {
    kind: "today" | "week" | "month" | "custom";
    start: Date;
    end: Date;
  };
  totalFocusSeconds: number;
  sessionCount: number;
  completedTaskCount: number;
  focusDays: number;
  byGoal: GoalStatistics[];
}

export interface StatisticsService {
  getStatistics(
    context: AuthenticatedContext,
    input?: StatsQueryInput,
  ): Promise<Statistics>;
}

function customBoundary(value: string, timezone: string): Date {
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
      return localDateStart(value, timezone);
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime()))
      invalid("Invalid custom period boundary.");
    return parsedDate;
  } catch {
    invalid("Invalid custom period boundary.");
  }
}

export function createStatisticsService(
  database: Database,
  deps: { settingsService: Pick<SettingsService, "get"> },
): StatisticsService {
  return {
    async getStatistics(context, input = {}) {
      const query = parsed(statsQuerySchema.safeParse(input));
      const settings = await deps.settingsService.get(context);
      const timezone = settings.timezone;
      const now = query.now ? new Date(query.now) : new Date();
      const range =
        query.period === "custom"
          ? {
              start: customBoundary(query.from!, timezone),
              end: customBoundary(query.to!, timezone),
            }
          : getLocalPeriodInterval(
              query.period,
              now,
              timezone,
              settings.weekStartsOn as 0 | 1,
            );

      if (range.start >= range.end) invalid("from must be before to.", "from");
      if (range.end.getTime() - range.start.getTime() > 3660 * 86_400_000) {
        invalid("Custom statistics are limited to ten years.");
      }

      const [sessionRows, completedTaskRows] = await Promise.all([
        database
          .select({ session: sessions, goal: goals })
          .from(sessions)
          .innerJoin(goals, eq(sessions.goalId, goals.id))
          .where(
            and(
              ne(sessions.status, "cancelled"),
              lt(sessions.startedAt, range.end),
              or(
                gt(sessions.endedAt, range.start),
                inArray(sessions.status, ["active", "paused"] as const),
              ),
            ),
          ),
        database
          .select({ count: sql<number>`count(*)` })
          .from(tasks)
          .where(
            and(
              isNotNull(tasks.completedAt),
              // completedAt is the event source of truth; a later reopen
              // clears it, so status need not be checked separately.
              sql`${tasks.completedAt} >= ${range.start}`,
              lt(tasks.completedAt, range.end),
            ),
          ),
      ]);

      // Real focus intervals for every observed Session in range — one
      // extra round trip, then pure interval math.
      const observedIds = sessionRows
        .filter((row) => row.session.timeBasis === "observed")
        .map((row) => row.session.id);
      const intervalMap = await intervalsOfSessions(database, observedIds);

      const slices: (SessionFocusSlice & {
        goalTitle: string;
        goalStatus: GoalStatistics["status"];
      })[] = sessionRows.map((row) => ({
        id: row.session.id,
        goalId: row.session.goalId,
        status: row.session.status,
        timeBasis: row.session.timeBasis,
        startedAt: row.session.startedAt,
        endedAt: row.session.endedAt,
        durationSeconds: row.session.durationSeconds,
        intervals: intervalMap.get(row.session.id) ?? [],
        goalTitle: row.goal.title,
        goalStatus: row.goal.status,
      }));

      const totals = computeFocusTotals(slices, range, now);
      const sessionCount = slices.filter(
        (slice) => focusSecondsInRange(slice, range, now) > 0,
      ).length;

      const byGoal = [...totals.goalFocusSeconds.entries()]
        .filter(([, focusSeconds]) => focusSeconds > 0)
        .map(([goalId, focusSeconds]) => {
          const row = slices.find((slice) => slice.goalId === goalId)!;
          return {
            goalId,
            title: row.goalTitle,
            status: row.goalStatus,
            focusSeconds,
          };
        })
        .sort((left, right) => right.focusSeconds - left.focusSeconds);

      let focusDays = 0;
      let dayKey = localDateKey(range.start, timezone);
      while (true) {
        const dayStart = localDateStart(dayKey, timezone);
        if (dayStart >= range.end) break;
        const nextKey = addLocalDays(dayKey, 1);
        const dayEnd = localDateStart(nextKey, timezone);
        const clipped = {
          start: new Date(Math.max(dayStart.getTime(), range.start.getTime())),
          end: new Date(Math.min(dayEnd.getTime(), range.end.getTime())),
        };
        if (
          clipped.start < clipped.end &&
          computeFocusTotals(slices, clipped, now).totalFocusSeconds > 0
        ) {
          focusDays += 1;
        }
        dayKey = nextKey;
      }

      return {
        timezone,
        period: { kind: query.period, ...range },
        totalFocusSeconds: totals.totalFocusSeconds,
        sessionCount,
        completedTaskCount: Number(completedTaskRows[0]?.count ?? 0),
        focusDays,
        byGoal,
      };
    },
  };
}
