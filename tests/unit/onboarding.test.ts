import { describe, expect, it } from "vitest";

import {
  onboardingDraftStorageKey,
  onboardingRedirect,
  parseOnboardingDraft,
} from "@/shared/onboarding";

describe("onboarding state", () => {
  it("restores only a valid instance-scoped draft", () => {
    const draft = {
      version: 1,
      step: "reason",
      title: "Ship the first version",
      description: "Make daily progress visible",
      idempotencyKey: "onboarding-123",
    };

    expect(parseOnboardingDraft(JSON.stringify(draft))).toEqual(draft);
    expect(parseOnboardingDraft("not-json")).toBeNull();
    expect(
      parseOnboardingDraft(JSON.stringify({ ...draft, version: 2 })),
    ).toBeNull();
    expect(onboardingDraftStorageKey("https://one.example/path")).not.toBe(
      onboardingDraftStorageKey("https://two.example/path"),
    );
  });

  it("routes setup, first-use, and returning users deterministically", () => {
    expect(
      onboardingRedirect({
        surface: "execution",
        setupCompleted: false,
        activeGoalCount: 0,
      }),
    ).toBe("/setup");
    expect(
      onboardingRedirect({
        surface: "execution",
        setupCompleted: true,
        activeGoalCount: 0,
      }),
    ).toBe("/onboarding");
    expect(
      onboardingRedirect({
        surface: "onboarding",
        setupCompleted: true,
        activeGoalCount: 1,
      }),
    ).toBe("/today");
    expect(
      onboardingRedirect({
        surface: "execution",
        setupCompleted: true,
        activeGoalCount: 1,
      }),
    ).toBeNull();
  });
});
