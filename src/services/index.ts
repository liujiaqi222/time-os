import "server-only";

import { db } from "@/db/client";
import { createSettingsService } from "@/services/settings";
import { createPlanningService } from "@/services/planning";
import { createSessionService } from "@/services/session";
import { createDistractionService } from "@/services/distraction";
import { createDashboardService } from "@/services/dashboard";
import { createHistoryService } from "@/services/history";
import { createStatisticsService } from "@/services/statistics";

export const settingsService = createSettingsService(db);
export const planningService = createPlanningService(db);
export const distractionService = createDistractionService(db);
export const sessionService = createSessionService(db, {
  distractionService,
});
export const historyService = createHistoryService(db);
export const statisticsService = createStatisticsService(db, {
  settingsService,
});
export const dashboardService = createDashboardService(db, {
  sessionService,
  settingsService,
  statisticsService,
});
