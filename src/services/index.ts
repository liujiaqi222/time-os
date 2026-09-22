import "server-only";

import { db } from "@/db/client";
import { createSettingsService } from "@/services/settings";
import { createPlanningService } from "@/services/planning";

export const settingsService = createSettingsService(db);
export const planningService = createPlanningService(db);
