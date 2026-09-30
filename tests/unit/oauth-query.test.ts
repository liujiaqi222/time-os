import { makeSignature } from "better-auth/crypto";
import { describe, expect, it } from "vitest";

import { verifySignedOAuthQuery } from "@/auth/oauth-query";

const secret = "test-secret-that-is-at-least-32-characters";

async function signedQuery(expiresAt: number) {
  const params = new URLSearchParams({
    client_id: "https://chatgpt.com/oauth/client.json",
    exp: String(expiresAt),
    scope: "timeos:read timeos:write",
  });
  params.set("sig", await makeSignature(params.toString(), secret));
  return params.toString();
}

describe("OAuth redirect query", () => {
  it("accepts a valid signature regardless of parameter order", async () => {
    const raw = await signedQuery(2_000_000_000);
    const reversed = new URLSearchParams(
      [...new URLSearchParams(raw)].reverse(),
    );
    expect(
      await verifySignedOAuthQuery(
        reversed.toString(),
        secret,
        new Date("2026-01-01"),
      ),
    ).toBe(true);
  });

  it("rejects modified, expired, and duplicate signatures", async () => {
    const raw = await signedQuery(2_000_000_000);
    expect(
      await verifySignedOAuthQuery(
        raw.replace("timeos%3Aread", "timeos%3Aadmin"),
        secret,
        new Date("2026-01-01"),
      ),
    ).toBe(false);
    expect(
      await verifySignedOAuthQuery(
        await signedQuery(1),
        secret,
        new Date("2026-01-01"),
      ),
    ).toBe(false);
    expect(
      await verifySignedOAuthQuery(
        `${raw}&sig=duplicate`,
        secret,
        new Date("2026-01-01"),
      ),
    ).toBe(false);
  });
});
