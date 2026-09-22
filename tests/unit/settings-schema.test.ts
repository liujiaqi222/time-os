import { describe, expect, it } from "vitest";

import { updateSettingsSchema } from "@/shared/schemas/settings";

describe("settings validation", () => {
  it("accepts IANA timezone, focus duration, and week start", () => {
    expect(
      updateSettingsSchema.parse({
        timezone: "Asia/Shanghai",
        defaultFocusMinutes: 25,
        weekStartsOn: 1,
      }),
    ).toEqual({
      timezone: "Asia/Shanghai",
      defaultFocusMinutes: 25,
      weekStartsOn: 1,
    });
  });

  it.each([
    { timezone: "Not/A_Timezone", defaultFocusMinutes: 25, weekStartsOn: 1 },
    { timezone: "UTC", defaultFocusMinutes: 0, weekStartsOn: 1 },
    { timezone: "UTC", defaultFocusMinutes: 25, weekStartsOn: 2 },
  ])("rejects invalid settings: %j", (input) => {
    expect(updateSettingsSchema.safeParse(input).success).toBe(false);
  });
});
