import { z } from "zod";

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .trim()
  .refine(isIanaTimezone, "Use a valid IANA timezone such as Asia/Shanghai.");

export const updateSettingsSchema = z.object({
  timezone: timezoneSchema,
  defaultFocusMinutes: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  weekStartsOn: z.coerce
    .number()
    .int()
    .pipe(z.union([z.literal(0), z.literal(1)])),
});

export const setupSettingsSchema = updateSettingsSchema.extend({
  setupCompleted: z.literal(true).default(true),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
