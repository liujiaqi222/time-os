import { isSameOriginRequest } from "@/auth/same-origin";
import { readWebSession } from "@/auth/web-session";
import { sessionContract } from "@/adapters/session-contract";
import { sessionService } from "@/services";
import { sessionStartSchema } from "@/shared/schemas/session";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return Response.json({ ok: false }, { status: 403 });
  const authorizationStarted = performance.now();
  if (!(await readWebSession()))
    return Response.json({ ok: false }, { status: 401 });
  const authorizationMs = performance.now() - authorizationStarted;
  const input = sessionStartSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) return Response.json({ ok: false }, { status: 400 });
  const startStarted = performance.now();
  const result = await sessionContract(() =>
    sessionService.startSession({ actor: "web" }, input.data),
  );
  return Response.json(result, {
    status: result.ok ? 200 : 400,
    headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": `auth;dur=${authorizationMs.toFixed(1)}, start;dur=${(performance.now() - startStarted).toFixed(1)}`,
    },
  });
}
