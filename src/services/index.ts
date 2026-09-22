import "server-only";

import { db } from "@/db/client";
import { createSettingsService } from "@/services/settings";
import { createPlanningService } from "@/services/planning";
import { createSessionService } from "@/services/session";

export const settingsService = createSettingsService(db);
export const planningService = createPlanningService(db);
export const sessionService = createSessionService(db);
