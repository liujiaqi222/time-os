import { redirect } from "next/navigation";

import { readWebSession } from "@/auth/web-session";
import { FocusView } from "@/components/focus-view";
import { planningService, sessionService, settingsService } from "@/services";

export default async function FocusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!(await readWebSession())) redirect("/login");

  // Independent reads — run in parallel. The session result is captured so
  // the redirect order stays the same (setup first, then missing session).
  const [settings, sessionResult] = await Promise.all([
    settingsService.get({ actor: "web" }),
    sessionService.getSession({ actor: "web" }, id).then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    ),
  ]);
  if (!settings.setupCompletedAt) redirect("/setup");

  let session;
  if (sessionResult.ok) {
    session = sessionResult.value;
  } else {
    redirect("/today");
  }

  // Ensure target session is currently active or paused
  if (session.status !== "active" && session.status !== "paused") {
    redirect("/today");
  }

  // Look up expected next task title if there is a current task
  let nextTaskPreviewTitle: string | null = null;
  if (session.taskId) {
    try {
      const taskList = await planningService.listTasks(
        { actor: "web" },
        session.trackId,
        { status: "pending" },
      );
      const currentTask = session.task;
      if (currentTask) {
        const nextPending = taskList.items
          .filter(
            (t) => t.position > currentTask.position && t.status === "pending",
          )
          .sort((a, b) => a.position - b.position)[0];
        nextTaskPreviewTitle = nextPending?.title ?? null;
      }
    } catch {
      // Non-critical preview info
    }
  }

  return (
    <FocusView
      initialSession={session}
      nextTaskPreviewTitle={nextTaskPreviewTitle}
    />
  );
}
