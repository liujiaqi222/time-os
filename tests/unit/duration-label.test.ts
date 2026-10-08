import { expect, it } from "vitest";
import { durationLabel } from "@/shared/duration-label";
import { formatHumanDuration } from "@/shared/session-timer";
it("uses existing summary precision while retaining precise record labels", () => {
  expect(formatHumanDuration(59)).toBe("59秒");
  expect(formatHumanDuration(125)).toBe("2分 5秒");
  expect(formatHumanDuration(3665)).toBe("1时 1分");
  expect(durationLabel(125)).toBe("2 分钟 5 秒");
});
