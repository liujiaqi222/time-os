import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import {
  goals,
  sessions,
  tasks,
  tracks,
  type Goal,
  type Task,
  type Track,
} from "@/db/schema";
import type { SessionService, SessionWithRelations } from "@/services/session";
import type { SettingsService } from "@/services/settings";
import type { StatisticsService } from "@/services/statistics";

export interface TodayStats {
  totalFocusSeconds: number;
  completedTasksCount: number;
  sessionCount: number;
}

export interface ActiveTrackItem {
  track: Track;
  goal: Goal;
  currentNextTask: Task | null;
  todayFocusSeconds: number;
  lastSessionNote?: string | null;
  lastSessionAt?: Date | null;
}

export interface DashboardData {
  activeSession: SessionWithRelations | null;
  todayStats: TodayStats;
  selectedTrack: ActiveTrackItem | null;
  activeTracks: ActiveTrackItem[];
}

export interface DashboardService {
  getDashboard(
    context: AuthenticatedContext,
    options?: { manualTrackId?: string },
  ): Promise<DashboardData>;
}

/**
 * Read model for the Today page (PRD §8.1). Composes the Session and
 * Settings interfaces instead of re-querying their tables; the only tables
 * it touches directly are the ones no other module owns reads for:
 * today's sessions, completed tasks and active tracks.
 */
export function createDashboardService(
  database: Database,
  deps: {
    sessionService: Pick<SessionService, "getActiveSession">;
    settingsService: Pick<SettingsService, "get">;
    statisticsService: Pick<StatisticsService, "getStatistics">;
  },
): DashboardService {
  const { sessionService, settingsService, statisticsService } = deps;

  return {
    async getDashboard(context, options) {
      // The Settings module owns appSettings — timezone and selectedTrackId
      // cross its interface, not its table.
      // Today delegates all counting and interval math to StatisticsService;
      // History, Today and stats_get therefore cannot drift into separate
      // definitions of focus time.
      const [settings, activeSession, todayStats, activeTrackRows] =
        await Promise.all([
          settingsService.get(context),
          sessionService.getActiveSession(context),
          statisticsService.getStatistics(context, { period: "today" }),
          database
            .select({
              track: tracks,
              goal: goals,
            })
            .from(tracks)
            .innerJoin(goals, eq(tracks.goalId, goals.id))
            .where(and(eq(tracks.status, "active"), eq(goals.status, "active")))
            .orderBy(asc(goals.position), asc(tracks.position)),
        ]);
      const trackFocusSeconds = new Map(
        todayStats.byTrack.map((track) => [track.trackId, track.focusSeconds]),
      );

      const activeTracks: ActiveTrackItem[] = [];

      // Batch-fetch all current next tasks in a single query instead of
      // N+1. If the selected track can't be resolved from the request or
      // settings alone, also fetch the most recent session activity among
      // active tracks. Both queries run in parallel.
      const taskIds = activeTrackRows
        .map((row) => row.track.currentTaskId)
        .filter((id): id is string => id != null);

      const allActiveTrackIds = activeTrackRows.map((row) => row.track.id);

      const nextTasksPromise: Promise<Task[]> =
        taskIds.length > 0
          ? database.select().from(tasks).where(inArray(tasks.id, taskIds))
          : Promise.resolve([]);

      // Fetch recent sessions among active tracks to attach the last handover note
      // and determine the most recent active track fallback.
      const recentSessionsPromise =
        allActiveTrackIds.length > 0
          ? database
              .select({
                trackId: sessions.trackId,
                note: sessions.note,
                endedAt: sessions.endedAt,
                startedAt: sessions.startedAt,
              })
              .from(sessions)
              .where(
                and(
                  ne(sessions.status, "cancelled"),
                  inArray(sessions.trackId, allActiveTrackIds),
                ),
              )
              .orderBy(desc(sessions.startedAt))
          : Promise.resolve([]);

      const [nextTasks, recentSessions] = await Promise.all([
        nextTasksPromise,
        recentSessionsPromise,
      ]);

      const lastSessionMap = new Map<
        string,
        { note: string | null; at: Date }
      >();
      for (const s of recentSessions) {
        if (!lastSessionMap.has(s.trackId)) {
          lastSessionMap.set(s.trackId, {
            note: s.note,
            at: s.endedAt ?? s.startedAt,
          });
        }
      }

      const nextTaskMap = new Map<string, Task>();
      for (const t of nextTasks) {
        nextTaskMap.set(t.id, t);
      }

      for (const row of activeTrackRows) {
        const nextTask = row.track.currentTaskId
          ? (nextTaskMap.get(row.track.currentTaskId) ?? null)
          : null;
        const lastSession = lastSessionMap.get(row.track.id);

        activeTracks.push({
          track: row.track,
          goal: row.goal,
          currentNextTask: nextTask,
          todayFocusSeconds: trackFocusSeconds.get(row.track.id) ?? 0,
          lastSessionNote: lastSession?.note ?? null,
          lastSessionAt: lastSession?.at ?? null,
        });
      }

      // Current focus track selection fallback (PRD §8.1):
      // 0. options?.manualTrackId if valid and active
      // 1. selectedTrackId if valid and active
      // 2. Most recent active track with non-cancelled session activity
      // 3. First active track by Goal.position -> Track.position
      // 4. null
      let selectedTrack: ActiveTrackItem | null = null;

      if (options?.manualTrackId) {
        selectedTrack =
          activeTracks.find((t) => t.track.id === options.manualTrackId) ??
          null;
      }

      if (!selectedTrack && settings.selectedTrackId) {
        selectedTrack =
          activeTracks.find((t) => t.track.id === settings.selectedTrackId) ??
          null;
      }

      if (!selectedTrack) {
        const recentSession = recentSessions[0];
        if (recentSession) {
          selectedTrack =
            activeTracks.find((t) => t.track.id === recentSession.trackId) ??
            null;
        }
      }

      if (!selectedTrack && activeTracks.length > 0) {
        selectedTrack = activeTracks[0] ?? null;
      }

      return {
        activeSession,
        todayStats: {
          totalFocusSeconds: todayStats.totalFocusSeconds,
          completedTasksCount: todayStats.completedTaskCount,
          sessionCount: todayStats.sessionCount,
        },
        selectedTrack,
        activeTracks,
      };
    },
  };
}
