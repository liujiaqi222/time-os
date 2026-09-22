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
  const settings = await settingsService.get({ actor: "web" });
  if (!settings.setupCompletedAt) redirect("/setup");
  const activeSession = await sessionService.getActiveSession({ actor: "web" });
  return <AppShell activeSession={activeSession}>{children}</AppShell>;
}
