import { z } from "zod";
import { invalid } from "@/services/service-kit";
const schema = z
  .object({
    v: z.literal(1),
    kind: z.enum(["sessions", "tasks"]),
    id: z.string().uuid(),
    at: z.string().datetime({ offset: true }),
  })
  .strict();
/** Bookmark the sort values, so corrections or reopening the boundary row
 * cannot change the meaning of the next page or make the cursor disappear.
 */
export function historyCursor(
  kind: "sessions" | "tasks",
  id: string,
  at: Date,
): string {
  return Buffer.from(
    JSON.stringify({ v: 1, kind, id, at: at.toISOString() }),
  ).toString("base64url");
}
export function readHistoryCursor(
  cursor: string,
  kind: "sessions" | "tasks",
): { id: string; at: Date } {
  try {
    const value = schema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    if (value.kind !== kind)
      invalid("Cursor belongs to another list.", "cursor");
    return { id: value.id, at: new Date(value.at) };
  } catch {
    invalid("Invalid history cursor. Reload the first page.", "cursor");
  }
}
