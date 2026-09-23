import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import { distractions, sessions, type Distraction } from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import {
  distractionArchiveSchema,
  distractionCreateSchema,
  distractionListSchema,
  distractionUpdateInputSchema,
  type DistractionCreateInput,
  type DistractionListInput,
  type DistractionUpdateInput,
} from "@/shared/schemas/session";
import { parsed } from "@/services/service-kit";

export type { Distraction } from "@/db/schema";

export interface DistractionService {
  createDistraction(
    context: AuthenticatedContext,
    input: DistractionCreateInput,
  ): Promise<Distraction>;
  listDistractions(
    context: AuthenticatedContext,
    input?: DistractionListInput,
  ): Promise<Distraction[]>;
  updateDistraction(
    context: AuthenticatedContext,
    id: string,
    input: DistractionUpdateInput,
  ): Promise<Distraction>;
  archiveDistraction(
    context: AuthenticatedContext,
    id: string,
  ): Promise<Distraction>;
}

export function createDistractionService(
  database: Database,
): DistractionService {
  // One home for the target rule (PRD §4.5): an explicit sessionId must
  // exist; without one, the single running session is the target.
  async function resolveTargetSessionId(
    sessionId?: string | null,
  ): Promise<string> {
    if (sessionId) {
      const [existing] = await database
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (!existing) {
        throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
          sessionId,
        });
      }
      return sessionId;
    }

    const [active] = await database
      .select({ id: sessions.id })
      .from(sessions)
      .where(inArray(sessions.status, ["active", "paused"] as const))
      .limit(1);
    if (!active) {
      throw new DomainError(
        "SESSION_NOT_FOUND",
        "No active or paused session found.",
      );
    }
    return active.id;
  }

  return {
    async createDistraction(_context, input) {
      void _context;
      const value = parsed(distractionCreateSchema.safeParse(input));

      const targetSessionId = await resolveTargetSessionId(value.sessionId);

      const [created] = await database
        .insert(distractions)
        .values({
          sessionId: targetSessionId,
          text: value.text ?? null,
        })
        .returning();

      return created!;
    },

    async listDistractions(_context, input = {}) {
      void _context;
      const query = parsed(distractionListSchema.safeParse(input));

      const targetSessionId = await resolveTargetSessionId(query.sessionId);

      const conditions = [eq(distractions.sessionId, targetSessionId)];
      if (!query.includeArchived) {
        conditions.push(isNull(distractions.archivedAt));
      }
      if (query.cursor) {
        const [cursor] = await database
          .select({
            id: distractions.id,
            sessionId: distractions.sessionId,
            createdAt: distractions.createdAt,
          })
          .from(distractions)
          .where(eq(distractions.id, query.cursor))
          .limit(1);
        if (!cursor || cursor.sessionId !== targetSessionId) {
          throw new DomainError(
            "INVALID_INPUT",
            "Distraction cursor was not found in this Session.",
          );
        }
        conditions.push(
          or(
            gt(distractions.createdAt, cursor.createdAt),
            and(
              eq(distractions.createdAt, cursor.createdAt),
              gt(distractions.id, cursor.id),
            ),
          )!,
        );
      }

      return database
        .select()
        .from(distractions)
        .where(and(...conditions))
        .orderBy(asc(distractions.createdAt), asc(distractions.id))
        .limit(query.limit);
    },

    async updateDistraction(_context, id, input) {
      void _context;
      const value = parsed(distractionUpdateInputSchema.safeParse(input));

      const [updated] = await database
        .update(distractions)
        .set({
          text: value.text ?? null,
          updatedAt: new Date(),
        })
        .where(eq(distractions.id, id))
        .returning();

      if (!updated) {
        throw new DomainError(
          "DISTRACTION_NOT_FOUND",
          "Distraction was not found.",
        );
      }

      return updated;
    },

    async archiveDistraction(_context, id) {
      void _context;
      parsed(distractionArchiveSchema.safeParse({ id }));

      const [archived] = await database
        .update(distractions)
        .set({
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(distractions.id, id))
        .returning();

      if (!archived) {
        throw new DomainError(
          "DISTRACTION_NOT_FOUND",
          "Distraction was not found.",
        );
      }

      return archived;
    },
  };
}
