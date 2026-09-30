import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "@/env/schema";

const validEnvironment = {
  DATABASE_URL: "postgresql://timeos:password@localhost:5432/timeos",
  BETTER_AUTH_SECRET: "auth-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "https://time-os.example.com",
};

describe("server environment", () => {
  it("accepts a complete server-only configuration", () => {
    expect(parseServerEnvironment(validEnvironment)).toMatchObject(
      validEnvironment,
    );
  });

  it("rejects a weak BETTER_AUTH_SECRET", () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        BETTER_AUTH_SECRET: "too-short",
      }),
    ).toThrow();
  });

  it("allows HTTP only for local development", () => {
    expect(
      parseServerEnvironment({
        ...validEnvironment,
        BETTER_AUTH_URL: "http://127.0.0.1:3010",
      }).BETTER_AUTH_URL,
    ).toBe("http://127.0.0.1:3010");
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        BETTER_AUTH_URL: "http://time-os.example.com",
      }),
    ).toThrow();
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      parseServerEnvironment({
        ...validEnvironment,
        DATABASE_URL: "file:local.db",
      }),
    ).toThrow();
  });
});
