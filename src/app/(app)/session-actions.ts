"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sessionContract } from "@/adapters/session-contract";
import { readWebSession } from "@/auth/web-session";
import {
  distractionService,
  sessionService,
  settingsService,
} from "@/services";
import type { Result } from "@/shared/result";
import type {
  Session,
  SessionReviewResult,
  SessionWithRelations,
} from "@/services/session";
import type { Distraction } from "@/services/distraction";
import type {
  DistractionCreateInput,
  DistractionUpdateInput,
  SessionOutcome,
  SessionStartInput,
} from "@/shared/schemas/session";

const context = { actor: "web" } as const;

async function authorize(): Promise<void> {
  if (!(await readWebSession())) redirect("/login");
}

async function run<T>(work: () => Promise<T>): Promise<Result<T>> {
  await authorize();
  const result = await sessionContract(work);
  revalidatePath("/today");
  revalidatePath("/goals");
  revalidatePath("/tracks/[id]", "page");
  return result;
}

export async function startSessionAction(
  input: SessionStartInput,
): Promise<Result<Session>> {
  return run(() => sessionService.startSession(context, input));
}

export async function pauseSessionAction(
  sessionId: string,
): Promise<Result<Session>> {
  return run(() => sessionService.pauseSession(context, sessionId));
}

export async function resumeSessionAction(
  sessionId: string,
): Promise<Result<Session>> {
  return run(() => sessionService.resumeSession(context, sessionId));
}

export async function finishSessionAction(
  sessionId: string,
  note?: string | null,
): Promise<Result<Session>> {
  return run(() => sessionService.finishSession(context, sessionId, { note }));
}

export async function finishSessionReviewAction(input: {
  sessionId: string;
  note?: string | null;
  outcome: SessionOutcome;
}): Promise<Result<SessionReviewResult>> {
  return run(() => sessionService.finishSessionReview(context, input));
}

export async function cancelSessionAction(
  sessionId: string,
): Promise<Result<Session>> {
  return run(() => sessionService.cancelSession(context, sessionId));
}

export async function updateSessionNoteAction(
  sessionId: string,
  note: string | null,
): Promise<Result<Session>> {
  return run(() => sessionService.updateSessionNote(context, sessionId, note));
}

export async function createDistractionAction(
  input: DistractionCreateInput,
): Promise<Result<Distraction>> {
  return run(() => distractionService.createDistraction(context, input));
}

export async function updateDistractionAction(
  id: string,
  input: DistractionUpdateInput,
): Promise<Result<Distraction>> {
  return run(() => distractionService.updateDistraction(context, id, input));
}

export async function archiveDistractionAction(
  id: string,
): Promise<Result<Distraction>> {
  return run(() => distractionService.archiveDistraction(context, id));
}

export async function setSelectedTrackAction(
  trackId: string | null,
): Promise<Result<void>> {
  return run(() => settingsService.setSelectedTrack(context, trackId));
}

export async function getActiveSessionAction(): Promise<
  Result<SessionWithRelations | null>
> {
  return run(() => sessionService.getActiveSession(context));
}
