import { z } from "zod";

import { readWebSession } from "@/auth/web-session";
import { sessionContract } from "@/adapters/session-contract";
import { sessionService } from "@/services";
import { sessionPauseSchema } from "@/shared/schemas/session";

const inputSchema = sessionPauseSchema
  .extend({ operation: z.enum(["pause", "resume", "cancel"]) })
  .strict();

// Timer controls must not wait in the client's Server Action queue for autosave or reads.
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ ok: false }, { status: 403 });
  if (!(await readWebSession()))
    return Response.json({ ok: false }, { status: 401 });
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false }, { status: 400 });
  const result = await sessionContract(() =>
    input.data.operation === "pause"
      ? sessionService.pauseSession({ actor: "web" }, input.data.id)
      : input.data.operation === "resume"
        ? sessionService.resumeSession({ actor: "web" }, input.data.id)
        : sessionService.cancelSession({ actor: "web" }, input.data.id),
  );
  return Response.json(result, {
    status: result.ok ? 200 : 400,
    headers: { "Cache-Control": "private, no-store" },
  });
}
