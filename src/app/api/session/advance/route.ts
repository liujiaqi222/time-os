import { readWebSession } from "@/auth/web-session";
import { sessionContract } from "@/adapters/session-contract";
import { sessionService } from "@/services";
import { sessionAdvanceSchema } from "@/shared/schemas/session";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ ok: false }, { status: 403 });
  if (!(await readWebSession()))
    return Response.json({ ok: false }, { status: 401 });
  const input = sessionAdvanceSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) return Response.json({ ok: false }, { status: 400 });
  const result = await sessionContract(() =>
    sessionService.advanceSession({ actor: "web" }, input.data),
  );
  return Response.json(result, {
    status: result.ok ? 200 : 400,
    headers: { "Cache-Control": "private, no-store" },
  });
}
