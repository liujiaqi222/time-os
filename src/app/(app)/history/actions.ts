"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sessionContract } from "@/adapters/session-contract";
import { readWebSession } from "@/auth/web-session";
import {
  distractionService,
  historyService,
  sessionService,
  settingsService,
  statisticsService,
} from "@/services";
import type { Distraction, Session } from "@/db/schema";
import type { HistorySessionDetail } from "@/services/history";
import { timezoneSchema } from "@/shared/schemas/timezone";
import { parsed } from "@/services/service-kit";
import { DomainError } from "@/shared/domain-error";
import type { Result } from "@/shared/result";
import {
  addLocalDays,
  localDateKey,
  localDateStart,
  parseLocalDateTime,
} from "@/shared/timezone";

const context = { actor: "web" } as const;

async function authorize() {
  if (!(await readWebSession())) redirect("/login");
}

function refreshHistory() {
  revalidatePath("/history");
  revalidatePath("/today");
  revalidatePath("/goals");
  revalidatePath("/goals/[id]", "page");
}

function parseHistoryTime(value: string, timezone: string): string {
  try {
    return parseLocalDateTime(value, timezone).toISOString();
  } catch {
    throw new DomainError(
      "INVALID_INPUT",
      "History times must be valid local date and time values.",
    );
  }
}

async function run<T>(work: () => Promise<T>): Promise<Result<T>> {
  await authorize();
  const result = await sessionContract(work);
  if (result.ok) refreshHistory();
  return result;
}

export async function getHistorySessionAction(
  id: string,
): Promise<Result<HistorySessionDetail>> {
  await authorize();
  return sessionContract(() => historyService.getSession(context, id));
}

export async function logSessionAction(input: {
  goalId: string;
  timezone?: string;
  taskId?: string | null;
  durationMinutes: number;
  startedAtLocal?: string;
  endedAtLocal?: string;
  intent?: string | null;
  resumeHint?: string | null;
  note?: string | null;
  allowOverlap?: boolean;
  idempotencyKey?: string;
}): Promise<Result<Session>> {
  return run(async () => {
    const timezone = input.timezone
      ? parsed(timezoneSchema.safeParse(input.timezone))
      : (await settingsService.get(context)).timezone;
    return historyService.logSession(context, {
      goalId: input.goalId,
      taskId: input.taskId,
      durationSeconds: Math.round(input.durationMinutes * 60),
      startedAt: input.startedAtLocal
        ? parseHistoryTime(input.startedAtLocal, timezone)
        : undefined,
      intent: input.intent,
      resumeHint: input.resumeHint,
      endedAt: input.endedAtLocal
        ? parseHistoryTime(input.endedAtLocal, timezone)
        : undefined,
      note: input.note,
      allowOverlap: input.allowOverlap,
      idempotencyKey: input.idempotencyKey,
    });
  });
}

export async function updateHistorySessionAction(input: {
  id: string;
  timezone?: string;
  expectedRevision: number;
  expectedNoteVersion?: number;
  expectedResumeHintVersion?: number;
  durationSeconds?: number;
  intent?: string | null;
  resumeHint?: string | null;
  goalId?: string;
  taskId?: string | null;
  startedAtLocal?: string;
  endedAtLocal?: string;
  note?: string | null;
  allowOverlap?: boolean;
}): Promise<Result<Session>> {
  return run(async () => {
    const timezone = input.timezone
      ? parsed(timezoneSchema.safeParse(input.timezone))
      : (await settingsService.get(context)).timezone;
    return historyService.updateSession(context, {
      id: input.id,
      expectedRevision: input.expectedRevision,
      expectedNoteVersion: input.expectedNoteVersion,
      expectedResumeHintVersion: input.expectedResumeHintVersion,
      durationSeconds: input.durationSeconds,
      intent: input.intent,
      resumeHint: input.resumeHint,
      goalId: input.goalId,
      taskId: input.taskId,
      startedAt: input.startedAtLocal
        ? parseHistoryTime(input.startedAtLocal, timezone)
        : undefined,
      endedAt: input.endedAtLocal
        ? parseHistoryTime(input.endedAtLocal, timezone)
        : undefined,
      note: input.note,
      allowOverlap: input.allowOverlap,
    });
  });
}

export async function cancelHistorySessionAction(
  id: string,
): Promise<Result<Session>> {
  return run(() => sessionService.cancelSession(context, id));
}

export async function updateHistoryDistractionAction(
  id: string,
  text: string | null,
): Promise<Result<Distraction>> {
  return run(() => distractionService.updateDistraction(context, id, { text }));
}

export async function archiveHistoryDistractionAction(
  id: string,
): Promise<Result<Distraction>> {
  return run(() => distractionService.archiveDistraction(context, id));
}

export async function getHistoryDayAction(input: {
  date: string;
  timezone: string;
  weekStartsOn: number;
  goalId?: string;
  cursor?: string;
  taskCursor?: string;
  now: string;
}) {
  await authorize();
  return sessionContract(async () => {
    const timezone = parsed(timezoneSchema.safeParse(input.timezone));
    let from: string;
    let to: string;
    try {
      from = localDateStart(input.date, timezone).toISOString();
      to = localDateStart(addLocalDays(input.date, 1), timezone).toISOString();
    } catch {
      throw new DomainError("INVALID_INPUT", "日期无效，请重新选择。");
    }
    const [stats, page, completed] = await Promise.all([
      statisticsService.getStatistics(context, {
        period: "custom",
        timezone,
        weekStartsOn: input.weekStartsOn,
        from,
        to,
        goalId: input.goalId,
        now: input.now,
      }),
      historyService.listSessions(context, {
        from,
        to,
        dateMode: "focus",
        goalId: input.goalId,
        cursor: input.cursor,
        now: input.now,
      }),
      historyService.listCompletedTasks(context, {
        from,
        to,
        goalId: input.goalId,
        cursor: input.taskCursor,
        now: input.now,
      }),
    ]);
    return { stats, page, completed };
  });
}

export async function getFirstExecutionFeedbackAction(id: string) {
  await authorize();
  return sessionContract(async () => {
    const session = await historyService.getSession(context, id);
    if (session.status !== "completed" || (session.durationSeconds ?? 0) <= 0)
      return null;
    const now = new Date();
    const all = await statisticsService.getStatistics(context, {
      period: "all",
      now: now.toISOString(),
    });
    if (all.sessionCount !== 1) return null;
    const today = localDateKey(now, all.timezone);
    const calendar = await statisticsService.getStatistics(context, {
      period: "custom",
      from: addLocalDays(today, -6),
      to: addLocalDays(today, 1),
      timezone: all.timezone,
      weekStartsOn: all.weekStartsOn,
      now: now.toISOString(),
      daily: true,
    });
    return { today, calendar };
  });
}
