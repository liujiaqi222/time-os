import { expect, it } from "vitest";
import { durationLabel } from "@/shared/duration-label";
it("shows cumulative effort through whole minutes without changing precise record labels", () => {
  expect(durationLabel(59, "minutes")).toBe("0 分钟");
  expect(durationLabel(125, "minutes")).toBe("2 分钟");
  expect(durationLabel(3665, "minutes")).toBe("1 小时 1 分钟");
  expect(durationLabel(125)).toBe("2 分钟 5 秒");
});
