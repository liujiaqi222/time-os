import { describe, expect, it } from "vitest";

import { databasePoolOptions } from "@/db/pool-options";

describe("database pool options", () => {
  it("allows Vercel parallel queries while releasing idle connections quickly", () => {
    expect(databasePoolOptions({ VERCEL: "1" })).toMatchObject({
      max: 10,
      idleTimeoutMillis: 5_000,
      allowExitOnIdle: true,
      connectionTimeoutMillis: 20_000,
    });
  });

  it("keeps local parallel query capacity", () => {
    expect(databasePoolOptions({})).toMatchObject({
      max: 10,
      allowExitOnIdle: false,
    });
  });
});
