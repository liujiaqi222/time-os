import { dashboardService, settingsService } from "@/services";
import { TodayView } from "@/components/today-view";

export default async function TodayPage({
  searchParams,
}: {
  searchParams?: Promise<{ trackId?: string }>;
}) {
  const params = await searchParams;
  const context = { actor: "web" } as const;
  const [dashboard, settings] = await Promise.all([
    dashboardService.getDashboard(context, { manualTrackId: params?.trackId }),
    settingsService.get(context),
  ]);

  return (
    <TodayView
      dashboard={dashboard}
      defaultFocusMinutes={settings.defaultFocusMinutes}
    />
  );
}
