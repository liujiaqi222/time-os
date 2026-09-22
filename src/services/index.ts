import "server-only";

import { db } from "@/db/client";
import { createSettingsService } from "@/services/settings";

export const settingsService = createSettingsService(db);
