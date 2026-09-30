"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/auth/auth";

export async function logoutAction(): Promise<never> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
