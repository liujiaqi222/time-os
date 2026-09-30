import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "@/env/schema";
import { inferPublicOrigin } from "@/shared/public-origin";

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

describe("public origin inference", () => {
  it("uses the stable branch URL for Vercel previews", () => {
    expect(
      inferPublicOrigin({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "time-os-git-feature.example.vercel.app",
        VERCEL_URL: "time-os-random.example.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "time-os.vercel.app",
      }),
    ).toBe("https://time-os-git-feature.example.vercel.app");
  });

  it("uses the production URL for production deployments", () => {
    expect(
      inferPublicOrigin({
        VERCEL_ENV: "production",
        VERCEL_BRANCH_URL: "time-os-git-main.example.vercel.app",
        VERCEL_URL: "time-os-random.example.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "time-os.example.com",
      }),
    ).toBe("https://time-os.example.com");
  });
});
