import { z } from "zod";

export const onboardingStepSchema = z.enum(["goal", "reason", "ai"]);

export const onboardingDraftSchema = z
  .object({
    version: z.literal(1),
    step: onboardingStepSchema,
    title: z.string().max(240),
    description: z.string().max(10_000),
    idempotencyKey: z.string().min(1).max(200),
  })
  .strict();

export type OnboardingStep = z.infer<typeof onboardingStepSchema>;
export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;

export function onboardingDraftStorageKey(origin: string): string {
  const instanceOrigin = new URL(origin).origin;
  return `time-os:onboarding:v1:${instanceOrigin}`;
}

export function parseOnboardingDraft(
  raw: string | null,
): OnboardingDraft | null {
  if (!raw) return null;
  try {
    const parsed = onboardingDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function onboardingRedirect(input: {
  surface: "execution" | "onboarding";
  setupCompleted: boolean;
  activeGoalCount: number;
}): "/setup" | "/today" | "/onboarding" | null {
  if (!input.setupCompleted) return "/setup";
  if (input.surface === "execution" && input.activeGoalCount === 0)
    return "/onboarding";
  if (input.surface === "onboarding" && input.activeGoalCount > 0)
    return "/today";
  return null;
}
