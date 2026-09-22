import { describe, expect, it } from "vitest";

import { getLocalDayRange } from "@/shared/timezone";

describe("timezone helper", () => {
  it("calculates exact start and end for UTC", () => {
    const testDate = new Date("2026-09-22T14:30:00Z");
    const { start, end } = getLocalDayRange(testDate, "UTC");

    expect(start.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-22T23:59:59.999Z");
  });

  it("calculates exact start and end for Asia/Shanghai (UTC+8)", () => {
    // 2026-09-22 14:00 UTC is 2026-09-22 22:00 in Shanghai
    const testDate = new Date("2026-09-22T14:00:00Z");
    const { start, end } = getLocalDayRange(testDate, "Asia/Shanghai");

    // Local 00:00 in UTC+8 is previous day 16:00 UTC
    expect(start.toISOString()).toBe("2026-09-21T16:00:00.000Z");
    // Local 23:59:59.999 is 15:59:59.999 UTC
    expect(end.toISOString()).toBe("2026-09-22T15:59:59.999Z");
  });

  it("calculates exact start and end for America/New_York (EDT UTC-4 in September)", () => {
    // 2026-09-22 14:00 UTC is 2026-09-22 10:00 in New York
    const testDate = new Date("2026-09-22T14:00:00Z");
    const { start, end } = getLocalDayRange(testDate, "America/New_York");

    // Local 00:00 in UTC-4 is 04:00 UTC
    expect(start.toISOString()).toBe("2026-09-22T04:00:00.000Z");
    // Local 23:59:59.999 is 2026-09-23 03:59:59.999 UTC
    expect(end.toISOString()).toBe("2026-09-23T03:59:59.999Z");
  });
});
