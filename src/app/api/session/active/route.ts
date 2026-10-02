import { readWebSession } from "@/auth/web-session";
import { sessionContract } from "@/adapters/session-contract";
import { sessionService } from "@/services";

/** Polling reads must not queue behind (or ahead of) timer mutation Actions. */
export async function GET() {
  if (!(await readWebSession()))
    return Response.json({ ok: false }, { status: 401 });
  const result = await sessionContract(() =>
    sessionService.getActiveSession({ actor: "web" }),
  );
  return Response.json(result, {
    status: result.ok ? 200 : 500,
    headers: { "Cache-Control": "private, no-store" },
  });
}
