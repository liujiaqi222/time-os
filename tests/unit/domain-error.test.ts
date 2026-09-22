import { describe, expect, it } from "vitest";

import { DomainError, serializeDomainError } from "@/shared/domain-error";

describe("domain error serialization", () => {
  it("preserves the stable protocol fields", () => {
    const error = new DomainError("INVALID_SETTINGS", "Timezone is invalid", {
      field: "timezone",
    });

    expect(serializeDomainError(error)).toEqual({
      code: "INVALID_SETTINGS",
      message: "Timezone is invalid",
      context: { field: "timezone" },
    });
  });

  it("does not leak unexpected exception details", () => {
    expect(serializeDomainError(new Error("DATABASE_URL=secret"))).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  });
});
