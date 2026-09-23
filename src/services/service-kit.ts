import { sql } from "drizzle-orm";

import type { Database } from "@/db/client";
import { DomainError } from "@/shared/domain-error";

/**
 * Shared plumbing for the service layer: zod bridging, advisory locking and
 * the transaction type every service composes with. One home, no copies.
 */

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function invalid(message: string, field?: string): never {
  throw new DomainError(
    "INVALID_INPUT",
    message,
    field ? { field } : undefined,
  );
}

export function parsed<T>(
  result:
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: Array<{ message: string; path: PropertyKey[] }> };
      },
): T {
  if (!result.success) {
    invalid(
      result.error.issues[0]?.message ?? "Invalid input.",
      result.error.issues[0]?.path.join("."),
    );
  }
  return result.data;
}

export async function lockScope(tx: Transaction, scope: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope}))`);
}
