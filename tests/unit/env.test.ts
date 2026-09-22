import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "@/env/schema";

const validEnvironment = {
  DATABASE_URL: "postgresql://timeos:password@localhost:5432/timeos",
  TIMEOS_WEB_PASSWORD: "correct horse battery staple",
  TIMEOS_MCP_TOKEN: "mcp-token-that-is-at-least-32-characters",
  TIMEOS_SESSION_SECRET: "session-secret-that-is-at-least-32-characters",
};

describe("server environment", () => {
  it("accepts a complete server-only configuration", () => {
    expect(parseServerEnvironment(validEnvironment)).toMatchObject(
      validEnvironment,
    );
  });

  it.each(["TIMEOS_MCP_TOKEN", "TIMEOS_SESSION_SECRET"] as const)(
    "rejects a weak %s",
    (key) => {
      expect(() =>
        parseServerEnvironment({ ...validEnvironment, [key]: "too-short" }),
      ).toThrow();
    },
  );

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        DATABASE_URL: "file:local.db",
      }),
    ).toThrow();
  });
});
