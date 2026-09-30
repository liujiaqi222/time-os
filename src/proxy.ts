import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth/auth";

export async function proxy(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/today/:path*",
    "/goals/:path*",
    "/tracks/:path*",
    "/history/:path*",
    "/settings/:path*",
    "/setup/:path*",
    "/onboarding/:path*",
  ],
};
