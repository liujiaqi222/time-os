import { eq } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import { appSettings, type AppSettings } from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import {
  updateSettingsSchema,
  type UpdateSettingsInput,
} from "@/shared/schemas/settings";

const SETTINGS_ID = "default" as const;

export interface SettingsService {
  get(context: AuthenticatedContext): Promise<AppSettings>;
  update(
    context: AuthenticatedContext,
    input: UpdateSettingsInput,
    options?: { completeSetup?: boolean },
  ): Promise<AppSettings>;
  checkSchema(context: AuthenticatedContext): Promise<void>;
}

export function createSettingsService(database: Database): SettingsService {
  async function ensureSettings(): Promise<void> {
    await database
      .insert(appSettings)
      .values({
        id: SETTINGS_ID,
        timezone: "UTC",
        defaultFocusMinutes: 25,
        weekStartsOn: 1,
      })
      .onConflictDoNothing({ target: appSettings.id });
  }

  async function getSettings(): Promise<AppSettings> {
    await ensureSettings();
    const [settings] = await database
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, SETTINGS_ID))
      .limit(1);

    if (!settings) {
      throw new DomainError(
        "SCHEMA_NOT_READY",
        "App settings could not be initialized. Run database migrations.",
      );
    }
    return settings;
  }

  return {
    async get(_context) {
      void _context;
      return getSettings();
    },
    async update(_context, input, options) {
      const validated = updateSettingsSchema.safeParse(input);
      if (!validated.success) {
        throw new DomainError("INVALID_SETTINGS", "Settings are invalid.", {
          field: validated.error.issues[0]?.path.join(".") || "settings",
        });
      }

      const current = await getSettings();
      const [settings] = await database
        .update(appSettings)
        .set({
          ...validated.data,
          ...(options?.completeSetup && {
            setupCompletedAt: current.setupCompletedAt ?? new Date(),
          }),
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, SETTINGS_ID))
        .returning();

      if (!settings) {
        throw new DomainError(
          "SCHEMA_NOT_READY",
          "App settings are unavailable.",
        );
      }
      return settings;
    },
    async checkSchema(_context) {
      void _context;
      try {
        await getSettings();
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError(
          "SCHEMA_NOT_READY",
          "Database is reachable, but the Time OS schema is missing. Run migrations.",
        );
      }
    },
  };
}
