import { dashboardService } from "@/services";
import { TodayView } from "@/components/today/today-view";

export default async function TodayPage() {
  const context = { actor: "web" } as const;
  const dashboard = await dashboardService.getDashboard(context);
  return <TodayView initialDashboard={dashboard} />;
}
