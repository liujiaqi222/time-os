import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function constantTimeSecretEqual(
  candidate: string,
  expected: string,
): boolean {
  return timingSafeEqual(digest(candidate), digest(expected));
}

export function hasValidBearerToken(
  authorization: string | null,
  expectedToken: string,
): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  return constantTimeSecretEqual(authorization.slice(7), expectedToken);
}

export function safeReturnPath(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/today";
  return value;
}
