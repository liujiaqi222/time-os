import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/auth/session-token";
import { sessionCookieOptions } from "@/auth/web-session";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(token, env.TIMEOS_SESSION_SECRET);

  if (!session.valid) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  const response = NextResponse.next();
  if (session.shouldRenew) {
    response.cookies.set(
      SESSION_COOKIE_NAME,
      await createSessionToken(env.TIMEOS_SESSION_SECRET),
      sessionCookieOptions,
    );
  }
  return response;
}

export const config = {
  matcher: [
    "/today/:path*",
    "/goals/:path*",
    "/tracks/:path*",
    "/history/:path*",
    "/settings/:path*",
    "/setup/:path*",
  ],
};
