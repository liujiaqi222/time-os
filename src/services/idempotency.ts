import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { idempotencyRecords } from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import type { Transaction } from "@/services/service-kit";

/**
 * One implementation of idempotent operations (PRD §4.7). Every caller —
 * session_start, tasks_create, and the upcoming session_log — goes through
 * this module instead of hand-rolling the claim/replay discipline.
 */

/** SHA-256 request digest for an idempotent operation payload. */
export function requestHashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export interface IdempotencyOutcome<T> {
  /** The value returned to the caller (domain type). */
  value: T;
  /** JSON persisted in the record so future retries can replay it. */
  result: unknown;
  /** Optional row reference stored alongside the result. */
  resultRef?: string | null;
}

/**
 * Run `operation` under idempotency key `key`:
 *
 * 1. Claim the key (`insert ... on conflict do nothing`). A successful
 *    claim means this transaction owns the operation: `run` executes and
 *    its outcome is recorded before commit.
 * 2. A failed claim means a previous run used the key: when the payload
 *    digest differs → IDEMPOTENCY_KEY_REUSED; otherwise `replay`
 *    rehydrates the recorded outcome. Replay returning null treats the
 *    record as unrecoverable and re-runs the operation (self-healing).
 *
 * When `key` is absent the operation runs unconditionally.
 */
export async function withIdempotency<T>(options: {
  tx: Transaction;
  operation: string;
  key: string | null | undefined;
  requestHash: string;
  run: () => Promise<IdempotencyOutcome<T>>;
  replay: (result: unknown) => Promise<T | null> | T | null;
}): Promise<T> {
  const { tx, operation, key, requestHash, run, replay } = options;

  if (!key) {
    const { value } = await run();
    return value;
  }

  const claimed = await tx
    .insert(idempotencyRecords)
    .values({ operation, key, requestHash })
    .onConflictDoNothing()
    .returning();

  if (claimed.length === 0) {
    const [record] = await tx
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.operation, operation),
          eq(idempotencyRecords.key, key),
        ),
      )
      .limit(1);

    if (!record || record.requestHash !== requestHash) {
      throw new DomainError(
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used with a different payload.",
      );
    }

    const replayed = await replay(record.result);
    if (replayed !== null && replayed !== undefined) {
      return replayed;
    }
    // Recorded result is unrecoverable (dangling reference): fall through
    // and re-run, overwriting the broken record on completion.
  }

  const { value, result, resultRef = null } = await run();
  await tx
    .update(idempotencyRecords)
    .set({ resultRef, result: result as never })
    .where(
      and(
        eq(idempotencyRecords.operation, operation),
        eq(idempotencyRecords.key, key),
      ),
    );
  return value;
}
