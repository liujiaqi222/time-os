import { configOf } from "@/shared/pomodoro";
import type { TimerConfig } from "@/shared/schemas/session";
import type { AuthenticatedContext } from "@/auth/context";
import type { SettingsService } from "@/services/settings";
import {
  serializeDomainError,
  type SerializedDomainError,
} from "@/shared/domain-error";
import type { Result } from "@/shared/result";
import type { UpdateSettingsInput } from "@/shared/schemas/settings";

export type SettingsOutput = {
  timezone: string;
  weekStartsOn: number;
  timerMode: "stopwatch" | "pomodoro";
  timerPreferences: TimerConfig;
  setupCompleted: boolean;
};

function toOutput(
  settings: Awaited<ReturnType<SettingsService["get"]>>,
): SettingsOutput {
  return {
    timezone: settings.timezone,
    weekStartsOn: settings.weekStartsOn,
    timerMode: settings.timerMode,
    timerPreferences: configOf(settings.timerPreferences),
    setupCompleted: settings.setupCompletedAt !== null,
  };
}

async function mapResult<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return { ok: false, error: serializeDomainError(error) };
  }
}

export function settingsGetContract(
  service: SettingsService,
  context: AuthenticatedContext,
): Promise<Result<SettingsOutput>> {
  return mapResult(async () => toOutput(await service.get(context)));
}

export function settingsUpdateContract(
  service: SettingsService,
  context: AuthenticatedContext,
  input: UpdateSettingsInput,
  options?: { completeSetup?: boolean },
): Promise<Result<SettingsOutput>> {
  return mapResult(async () =>
    toOutput(await service.update(context, input, options)),
  );
}

export function errorMessage(error: SerializedDomainError): string {
  return `${error.code}: ${error.message}`;
}
