import { describe, expect, it } from "vitest";

import { safeReturnPath } from "@/auth/secrets";

describe("authentication secrets", () => {
  it("allows only local return paths", () => {
    expect(safeReturnPath("/settings?tab=mcp")).toBe("/settings?tab=mcp");
    expect(safeReturnPath("https://attacker.example")).toBe("/today");
    expect(safeReturnPath("//attacker.example")).toBe("/today");
  });
});
