import { jwtVerify, SignJWT } from "jose";

export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
export const SESSION_RENEWAL_WINDOW_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_COOKIE_NAME = "timeos_session";

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  secret: string,
  now = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);

  return new SignJWT({ authenticated: true })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_MAX_AGE_SECONDS)
    .setIssuer("time-os")
    .setAudience("time-os-web")
    .sign(secretKey(secret));
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  now = new Date(),
): Promise<{ valid: boolean; shouldRenew: boolean }> {
  if (!token) {
    return { valid: false, shouldRenew: false };
  }

  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      issuer: "time-os",
      audience: "time-os-web",
      currentDate: now,
    });
    const expiresAt = payload.exp;
    if (!expiresAt || payload.authenticated !== true) {
      return { valid: false, shouldRenew: false };
    }

    const secondsRemaining = expiresAt - Math.floor(now.getTime() / 1000);
    return {
      valid: true,
      shouldRenew: secondsRemaining <= SESSION_RENEWAL_WINDOW_SECONDS,
    };
  } catch {
    return { valid: false, shouldRenew: false };
  }
}
