import { describe, expect, it } from "vitest";

import { databasePoolOptions } from "@/db/pool-options";

describe("database pool options", () => {
  it("limits each Vercel function instance to one pooled connection", () => {
    expect(databasePoolOptions({ VERCEL: "1" })).toMatchObject({
      max: 1,
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
