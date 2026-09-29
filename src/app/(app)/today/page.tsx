import { dashboardService } from "@/services";
import { TodayView } from "@/components/today/today-view";
import { pickTodayHeadline } from "@/shared/today-headlines";

export default async function TodayPage() {
  const context = { actor: "web" } as const;
  const dashboard = await dashboardService.getDashboard(context);
  return (
    <TodayView
      initialDashboard={dashboard}
      initialHeadline={pickTodayHeadline(Boolean(dashboard.activeSession))}
    />
  );
}
