import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { goals, tasks, tracks } from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import type { Database } from "@/db/client";
import type { Transaction } from "@/services/service-kit";

/**
 * Internal implementation module for the three positioned lists
 * (Goals, Tracks, Tasks). One implementation of two-phase renumbering and
 * cursor pagination; the generics stay inside the implementation — the
 * external Planning interface never sees them.
 */

type PositionedListTable = typeof goals | typeof tracks | typeof tasks;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Replace the complete position order of a container:
 *
 * 1. Validate that `ids` contains every item of the container exactly once.
 * 2. Park every row above the current maximum (no phase-2 collisions,
 *    including under the tasks (track_id, position) unique index).
 * 3. Renumber densely 1..n in the requested order.
 *
 * The caller owns the advisory lock and the final read-back.
 */
export async function renumberPositions(
  tx: Transaction,
  table: PositionedListTable,
  ids: string[],
  scope?: SQL,
): Promise<void> {
  if (new Set(ids).size !== ids.length) {
    throw new DomainError(
      "INVALID_POSITION_ORDER",
      "Order contains duplicate IDs.",
    );
  }

  const rows = await tx.select({ id: table.id }).from(table).where(scope);
  const actual = new Set(rows.map((row) => row.id));
  if (actual.size !== ids.length || ids.some((id) => !actual.has(id))) {
    throw new DomainError(
      "INVALID_POSITION_ORDER",
      "Order must contain every item in the container exactly once.",
    );
  }

  const [maxRow] = await tx
    .select({ value: sql<number>`coalesce(max(${table.position}), 0)` })
    .from(table)
    .where(scope);
  const offset = Number(maxRow?.value ?? 0);

  for (const [index, id] of ids.entries()) {
    await tx
      .update(table)
      .set({ position: offset + index + 1, updatedAt: new Date() })
      .where(eq(table.id, id));
  }
  for (const [index, id] of ids.entries()) {
    await tx
      .update(table)
      .set({ position: index + 1, updatedAt: new Date() })
      .where(eq(table.id, id));
  }
}

/**
 * Cursor pagination over a positioned list. `scope` pins the container
 * (and cursor resolution) — the parent id condition; `filters` are the
 * caller's status conditions and never affect cursor resolution, matching
 * the historical listGoals/listTracks/listTasks behavior.
 */
export async function listPositionPage<TTable extends PositionedListTable>(
  db: Database | Transaction,
  table: TTable,
  options: {
    scope?: SQL[];
    filters: SQL[];
    cursor?: string | null;
    limit: number;
  },
): Promise<Page<TTable["$inferSelect"]>> {
  const { scope = [], filters, cursor, limit } = options;
  const conditions = [...scope, ...filters];

  // Drizzle's select() cannot type-infer rows from a generic table
  // parameter; narrow to the union (which it handles) and cast once at
  // the single exit point.
  const unionTable = table as PositionedListTable;

  if (cursor) {
    // The cursor row is resolved inside the same container only.
    const [cursorRow] = await db
      .select({ position: unionTable.position })
      .from(unionTable)
      .where(and(eq(unionTable.id, cursor), ...scope))
      .limit(1);
    if (cursorRow) {
      conditions.push(gt(unionTable.position, cursorRow.position));
    }
  }

  const rows = (await db
    .select()
    .from(unionTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(unionTable.position))
    .limit(limit + 1)) as unknown as TTable["$inferSelect"][];

  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null,
  };
}
