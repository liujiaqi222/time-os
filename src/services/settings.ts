import { eq } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import { appSettings, tracks, type AppSettings } from "@/db/schema";
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
  setSelectedTrack(
    context: AuthenticatedContext,
    trackId: string | null,
  ): Promise<void>;
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
    // Fast path: one round trip when the row already exists (the common
    // case). Only fall back to the idempotent insert when it is missing.
    const [settings] = await database
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, SETTINGS_ID))
      .limit(1);
    if (settings) return settings;

    await ensureSettings();
    const [created] = await database
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, SETTINGS_ID))
      .limit(1);

    if (!created) {
      throw new DomainError(
        "SCHEMA_NOT_READY",
        "App settings could not be initialized. Run database migrations.",
      );
    }
    return created;
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
    // selectedTrackId lives in appSettings (PRD §4.6): this module owns the
    // table, so it owns the write. Callers no longer reach past the seam.
    async setSelectedTrack(_context, trackId) {
      void _context;
      if (trackId) {
        const [track] = await database
          .select({ id: tracks.id })
          .from(tracks)
          .where(eq(tracks.id, trackId))
          .limit(1);
        if (!track) {
          throw new DomainError("TRACK_NOT_FOUND", "Track was not found.", {
            trackId,
          });
        }
      }

      await database
        .update(appSettings)
        .set({
          selectedTrackId: trackId,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, SETTINGS_ID));
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
