import "server-only";

import { createHmac } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { loginAttempts } from "@/db/schema";
import { env } from "@/env";
import { DomainError } from "@/shared/domain-error";
import { constantTimeSecretEqual } from "@/auth/secrets";

function identityHash(identity: string): string {
  return createHmac("sha256", env.TIMEOS_SESSION_SECRET)
    .update(identity)
    .digest("hex");
}

export async function authenticatePassword(
  password: string,
  identity: string,
  now = new Date(),
): Promise<void> {
  const hash = identityHash(identity);

  await db.transaction(async (transaction) => {
    const [attempt] = await transaction
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.identityHash, hash))
      .for("update")
      .limit(1);

    if (attempt?.blockedUntil && attempt.blockedUntil > now) {
      throw new DomainError(
        "TOO_MANY_ATTEMPTS",
        "Too many login attempts. Wait briefly and try again.",
      );
    }

    if (constantTimeSecretEqual(password, env.TIMEOS_WEB_PASSWORD)) {
      if (attempt) {
        await transaction
          .delete(loginAttempts)
          .where(eq(loginAttempts.identityHash, hash));
      }
      return;
    }

    const failedCount = (attempt?.failedCount ?? 0) + 1;
    const delaySeconds = Math.min(2 ** Math.min(failedCount - 1, 8), 300);
    const blockedUntil = new Date(now.getTime() + delaySeconds * 1000);
    await transaction
      .insert(loginAttempts)
      .values({
        identityHash: hash,
        failedCount,
        windowStartedAt: attempt?.windowStartedAt ?? now,
        blockedUntil,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: loginAttempts.identityHash,
        set: { failedCount, blockedUntil, updatedAt: now },
      });

    throw new DomainError("UNAUTHORIZED", "The password is incorrect.");
  });
}
