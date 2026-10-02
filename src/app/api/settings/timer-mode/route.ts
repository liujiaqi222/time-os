import { z } from "zod";

import { readWebSession } from "@/auth/web-session";
import { settingsUpdateContract } from "@/adapters/settings-contract";
import { settingsService } from "@/services";

const inputSchema = z
  .object({ timerMode: z.enum(["pomodoro", "stopwatch"]) })
  .strict();

// Preference saving must not occupy the Server Action queue used to start a session.
export async function PATCH(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ ok: false }, { status: 403 });
  if (!(await readWebSession()))
    return Response.json({ ok: false }, { status: 401 });
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false }, { status: 400 });
  const result = await settingsUpdateContract(
    settingsService,
    { actor: "web" },
    input.data,
  );
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
