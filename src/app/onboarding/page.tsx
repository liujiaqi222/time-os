import { redirect } from "next/navigation";

import { MCP_RESOURCE } from "@/auth/auth";
import { readWebSession } from "@/auth/web-session";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { planningService, settingsService } from "@/services";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  if (!(await readWebSession())) redirect("/login?next=/onboarding");

  const context = { actor: "web" } as const;
  const [settings, goals] = await Promise.all([
    settingsService.get(context),
    planningService.listGoals(context, { status: "active", limit: 1 }),
  ]);

  if (!settings.setupCompletedAt) redirect("/setup");
  if (goals.items.length > 0) redirect("/today");

  return <OnboardingFlow endpoint={MCP_RESOURCE} />;
}
