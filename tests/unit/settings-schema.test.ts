import { describe, expect, it } from "vitest";

import { updateSettingsSchema } from "@/shared/schemas/settings";

describe("settings validation", () => {
  it("accepts IANA timezone and week start", () => {
    expect(
      updateSettingsSchema.parse({
        timezone: "Asia/Shanghai",
        weekStartsOn: 1,
      }),
    ).toEqual({
      timezone: "Asia/Shanghai",
      weekStartsOn: 1,
    });
  });

  it.each([
    { timezone: "Not/A_Timezone", weekStartsOn: 1 },
    { timezone: "UTC", weekStartsOn: 2 },
  ])("rejects invalid settings: %j", (input) => {
    expect(updateSettingsSchema.safeParse(input).success).toBe(false);
  });
});
