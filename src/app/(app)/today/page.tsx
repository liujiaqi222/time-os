import { redirect } from "next/navigation";

import { dashboardService } from "@/services";
import { TodayView } from "@/components/today/today-view";
import { pickTodayHeadline } from "@/shared/today-headlines";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string | string[] }>;
}) {
  const context = { actor: "web" } as const;
  const dashboard = await dashboardService.getDashboard(context);
  if (dashboard.goals.length === 0) redirect("/onboarding");
  const query = await searchParams;
  const first = Array.isArray(query.first) ? query.first[0] : query.first;
  return (
    <TodayView
      initialDashboard={dashboard}
      initialHeadline={pickTodayHeadline(Boolean(dashboard.activeSession))}
      firstRun={first === "1" && dashboard.todayStats.sessionCount === 0}
    />
  );
}
