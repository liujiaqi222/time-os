import { sql } from "drizzle-orm";
import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
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
import { focusSecondsSql } from "@/services/focus-query";
import type { SettingsService } from "@/services/settings";

export interface GoalStatistics {
  goalId: string;
  title: string;
  status: "active" | "completed" | "archived";
  focusSeconds: number;
  sessionCount: number;
  completedTaskCount: number;
}
export interface DailyStatistics {
  date: string;
  focusSeconds: number;
  sessionCount: number;
  completedTaskCount: number;
}
export interface Statistics {
  serverNow: Date;
  timezone: string;
  weekStartsOn: number;
  unit: "seconds";
  period: {
    kind: "today" | "week" | "month" | "custom" | "all";
    start: Date;
    end: Date;
  };
  totalFocusSeconds: number;
  sessionCount: number;
  completedTaskCount: number;
  /** All-time summaries omit day enumeration; use a bounded daily query. */
  focusDays: number | null;
  daily: DailyStatistics[];
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
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) invalid("Invalid period boundary.");
    return date;
  } catch {
    invalid("Invalid period boundary.");
  }
}

/** One aggregate statement per query, independent of day count. Never sends
 * raw historical sessions to the browser, including for lifetime totals.
 * Web, dashboard and MCP share this exact read model and snapshot time.
 */
export function createStatisticsService(
  database: Database,
  deps: { settingsService: Pick<SettingsService, "get"> },
): StatisticsService {
  return {
    async getStatistics(context, input = {}) {
      const query = parsed(statsQuerySchema.safeParse(input));
      const settings = await deps.settingsService.get(context);
      const timezone = query.timezone ?? settings.timezone;
      const weekStartsOn = query.weekStartsOn ?? settings.weekStartsOn;
      const now = query.now ? new Date(query.now) : new Date();
      if (query.period === "all" && query.daily)
        invalid("Daily statistics require a bounded period.");
      const range =
        query.period === "all"
          ? { start: new Date("0001-01-01T00:00:00Z"), end: now }
          : query.period === "custom"
            ? {
                start: customBoundary(query.from!, timezone),
                end: customBoundary(query.to!, timezone),
              }
            : getLocalPeriodInterval(
                query.period,
                now,
                timezone,
                weekStartsOn as 0 | 1,
              );
      if (range.start >= range.end) invalid("from must be before to.", "from");
      const days: { date: string; start: Date; end: Date }[] = [];
      // Summary-only queries still compute focusDays within the bounded range.
      if (query.period !== "all") {
        let key = localDateKey(range.start, timezone);
        while (localDateStart(key, timezone) < range.end) {
          if (days.length >= 366)
            invalid(
              "Statistics periods are limited to 366 local days. Use period=all for lifetime totals.",
            );
          const next = addLocalDays(key, 1);
          days.push({
            date: key,
            start: new Date(
              Math.max(
                localDateStart(key, timezone).getTime(),
                range.start.getTime(),
              ),
            ),
            end: new Date(
              Math.min(
                localDateStart(next, timezone).getTime(),
                range.end.getTime(),
              ),
            ),
          });
          key = next;
        }
      }
      const ranges = sql.join(
        [
          sql`('total'::text, ${range.start}::timestamptz, ${range.end}::timestamptz)`,
          ...days.map(
            (d) =>
              sql`(${d.date}, ${d.start}::timestamptz, ${d.end}::timestamptz)`,
          ),
        ],
        sql`, `,
      );
      const goalFilter = query.goalId
        ? sql`and goal_id = ${query.goalId}::uuid`
        : sql``;
      const contribution = focusSecondsSql(
        sql`s`,
        sql`r.start_at`,
        sql`r.end_at`,
        now,
      );
      const result = await database.execute<{
        key: string;
        seconds: string;
        count: number;
        completed: number;
        by_goal: GoalStatistics[];
      }>(sql`
        with ranges(key, start_at, end_at) as (values ${ranges}),
        candidates as materialized (
          select * from sessions where status <> 'cancelled' and started_at < ${range.end}
            and (ended_at > ${range.start} or status in ('active', 'paused')) ${goalFilter}
        ), contributions as materialized (
          select r.key, s.id, s.goal_id, ${contribution} as seconds
          from ranges r join candidates s on s.started_at < r.end_at
            and (s.ended_at > r.start_at or s.status in ('active', 'paused'))
        ), totals as (
          select key, sum(seconds) as seconds, count(*) filter (where seconds > 0)::int as count
          from contributions group by key
        ), completed as materialized (
          select r.key, t.goal_id, count(*)::int as count from ranges r join tasks t
          on t.completed_at >= r.start_at and t.completed_at < least(r.end_at, ${now}::timestamptz)
          and t.status = 'completed' ${query.goalId ? sql`and t.goal_id = ${query.goalId}::uuid` : sql``}
          group by r.key, t.goal_id
        ), goal_focus as (
          select goal_id, sum(seconds) as seconds, count(*) filter (where seconds > 0)::int as count
          from contributions where key = 'total' group by goal_id
        ), goal_totals as (
          select g.id as "goalId", g.title, g.status, coalesce(f.seconds, 0)::bigint as "focusSeconds",
            coalesce(f.count, 0) as "sessionCount", coalesce(c.count, 0) as "completedTaskCount"
          from goals g left join goal_focus f on f.goal_id = g.id
          left join completed c on c.goal_id = g.id and c.key = 'total'
          where coalesce(f.seconds, 0) > 0 or coalesce(c.count, 0) > 0
        )
        select r.key, coalesce(t.seconds, 0)::text as seconds, coalesce(t.count, 0) as count,
          coalesce((select sum(c.count) from completed c where c.key = r.key), 0)::int as completed,
          case when r.key = 'total' then coalesce((select jsonb_agg(g order by g."focusSeconds" desc, g."goalId") from goal_totals g), '[]'::jsonb) else '[]'::jsonb end as by_goal
        from ranges r left join totals t on t.key = r.key
      `);
      const total = result.rows.find((r) => r.key === "total")!;
      const daily = result.rows
        .filter((r) => r.key !== "total")
        .map((r) => ({
          date: r.key,
          focusSeconds: Number(r.seconds),
          sessionCount: r.count,
          completedTaskCount: r.completed,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      return {
        serverNow: now,
        timezone,
        weekStartsOn,
        unit: "seconds",
        period: { kind: query.period, ...range },
        totalFocusSeconds: Number(total.seconds),
        sessionCount: total.count,
        completedTaskCount: total.completed,
        focusDays:
          query.period === "all"
            ? null
            : daily.filter((d) => d.focusSeconds > 0).length,
        daily: query.daily ? daily : [],
        byGoal: total.by_goal,
      };
    },
  };
}
