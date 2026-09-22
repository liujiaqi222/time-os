import { describe, expect, it } from "vitest";

import {
  constantTimeSecretEqual,
  hasValidBearerToken,
  safeReturnPath,
} from "@/auth/secrets";

describe("authentication secrets", () => {
  it("compares complete values without prefix matches", () => {
    expect(constantTimeSecretEqual("right-secret", "right-secret")).toBe(true);
    expect(constantTimeSecretEqual("right", "right-secret")).toBe(false);
    expect(constantTimeSecretEqual("wrong-secret", "right-secret")).toBe(false);
  });

  it("accepts only the configured Bearer token", () => {
    expect(hasValidBearerToken("Bearer mcp-secret", "mcp-secret")).toBe(true);
    expect(hasValidBearerToken("bearer mcp-secret", "mcp-secret")).toBe(false);
    expect(hasValidBearerToken("Basic mcp-secret", "mcp-secret")).toBe(false);
  });

  it("allows only local return paths", () => {
    expect(safeReturnPath("/settings?tab=mcp")).toBe("/settings?tab=mcp");
    expect(safeReturnPath("https://attacker.example")).toBe("/today");
    expect(safeReturnPath("//attacker.example")).toBe("/today");
  });
});
