import "server-only";

import { cookies } from "next/headers";

import { env } from "@/env";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  verifySessionToken,
} from "@/auth/session-token";

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

export async function readWebSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return (await verifySessionToken(token, env.TIMEOS_SESSION_SECRET)).valid;
}

export async function createWebSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE_NAME,
    await createSessionToken(env.TIMEOS_SESSION_SECRET),
    sessionCookieOptions,
  );
}

export async function clearWebSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}
