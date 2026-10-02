import { z } from "zod";
import { readWebSession } from "@/auth/web-session";
import { settingsUpdateContract } from "@/adapters/settings-contract";
import { settingsService } from "@/services";
import { configOf } from "@/shared/pomodoro";

const inputSchema = z.object({ soundEnabled: z.boolean() }).strict();

export async function PATCH(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ ok: false }, { status: 403 });
  if (!(await readWebSession()))
    return Response.json({ ok: false }, { status: 401 });
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false }, { status: 400 });
  const context = { actor: "web" } as const;
  const settings = await settingsService.get(context);
  const result = await settingsUpdateContract(settingsService, context, {
    timerPreferences: {
      ...configOf(settings.timerPreferences),
      soundEnabled: input.data.soundEnabled,
    },
  });
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
