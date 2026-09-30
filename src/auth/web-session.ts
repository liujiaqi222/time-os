import "server-only";

import { headers } from "next/headers";

import { auth } from "@/auth/auth";

export async function readWebSession(): Promise<boolean> {
  return Boolean(await auth.api.getSession({ headers: await headers() }));
}
