import { redirect } from "next/navigation";

import { readWebSession } from "@/auth/web-session";
import { AppShell } from "@/components/app-shell";
import { sessionService, settingsService } from "@/services";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await readWebSession())) redirect("/login");
  // Independent reads — run in parallel (saves a round trip on every page).
  const [settings, activeSession] = await Promise.all([
    settingsService.get({ actor: "web" }),
    sessionService.getActiveSession({ actor: "web" }),
  ]);
  if (!settings.setupCompletedAt) redirect("/setup");
  return <AppShell activeSession={activeSession}>{children}</AppShell>;
}
