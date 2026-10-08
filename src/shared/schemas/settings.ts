import { z } from "zod";
import { timerConfigSchema, timerModeSchema } from "./session";

import { timezoneSchema } from "./timezone";
export { timezoneSchema } from "./timezone";

export const updateSettingsSchema = z.object({
  timezone: timezoneSchema.optional(),
  weekStartsOn: z.coerce
    .number()
    .int()
    .pipe(z.union([z.literal(0), z.literal(1)]))
    .optional(),
  timerMode: timerModeSchema.optional(),
  timerPreferences: timerConfigSchema.optional(),
});

export const setupSettingsSchema = updateSettingsSchema.extend({
  timezone: timezoneSchema,
  weekStartsOn: z.coerce
    .number()
    .int()
    .pipe(z.union([z.literal(0), z.literal(1)])),
  setupCompleted: z.literal(true).default(true),
});

export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;
