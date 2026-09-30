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
} from "@/services";
import type { Distraction, Session } from "@/db/schema";
import type { HistorySessionDetail } from "@/services/history";
import { DomainError } from "@/shared/domain-error";
import type { Result } from "@/shared/result";
import { parseLocalDateTime } from "@/shared/timezone";

const context = { actor: "web" } as const;

async function authorize() {
  if (!(await readWebSession())) redirect("/login");
}

function refreshHistory() {
  revalidatePath("/history");
  revalidatePath("/today");
  revalidatePath("/goals");
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
  taskId?: string | null;
  durationMinutes: number;
  endedAtLocal?: string;
  note?: string | null;
  allowOverlap?: boolean;
  idempotencyKey?: string;
}): Promise<Result<Session>> {
  return run(async () => {
    const settings = await settingsService.get(context);
    return historyService.logSession(context, {
      goalId: input.goalId,
      taskId: input.taskId,
      durationSeconds: Math.round(input.durationMinutes * 60),
      endedAt: input.endedAtLocal
        ? parseHistoryTime(input.endedAtLocal, settings.timezone)
        : undefined,
      note: input.note,
      allowOverlap: input.allowOverlap,
      idempotencyKey: input.idempotencyKey,
    });
  });
}

export async function updateHistorySessionAction(input: {
  id: string;
  goalId?: string;
  taskId?: string | null;
  startedAtLocal?: string;
  endedAtLocal?: string;
  note?: string | null;
  allowOverlap?: boolean;
}): Promise<Result<Session>> {
  return run(async () => {
    const settings = await settingsService.get(context);
    return historyService.updateSession(context, {
      id: input.id,
      goalId: input.goalId,
      taskId: input.taskId,
      startedAt: input.startedAtLocal
        ? parseHistoryTime(input.startedAtLocal, settings.timezone)
        : undefined,
      endedAt: input.endedAtLocal
        ? parseHistoryTime(input.endedAtLocal, settings.timezone)
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
