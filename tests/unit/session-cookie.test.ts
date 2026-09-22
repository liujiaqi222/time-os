import { describe, expect, it } from "vitest";

import {
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "@/auth/session-token";

const secret = "session-secret-that-is-at-least-32-characters";
const rotatedSecret = "a-different-session-secret-over-32-characters";

describe("web session token", () => {
  it("is valid for 90 days and renews inside the final 30 days", async () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const token = await createSessionToken(secret, issuedAt);

    expect(
      await verifySessionToken(
        token,
        secret,
        new Date("2026-02-01T00:00:00.000Z"),
      ),
    ).toMatchObject({ valid: true, shouldRenew: false });
    expect(
      await verifySessionToken(
        token,
        secret,
        new Date("2026-03-10T00:00:00.000Z"),
      ),
    ).toMatchObject({ valid: true, shouldRenew: true });
    expect(SESSION_MAX_AGE_SECONDS).toBe(90 * 24 * 60 * 60);
  });

  it("rejects expired and secret-rotated tokens", async () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const token = await createSessionToken(secret, issuedAt);

    expect(
      await verifySessionToken(
        token,
        secret,
        new Date("2026-04-02T00:00:00.000Z"),
      ),
    ).toEqual({ valid: false, shouldRenew: false });
    expect(
      await verifySessionToken(
        token,
        rotatedSecret,
        new Date("2026-01-02T00:00:00.000Z"),
      ),
    ).toEqual({ valid: false, shouldRenew: false });
  });
});
