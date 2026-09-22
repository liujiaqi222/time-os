"use server";

import { redirect } from "next/navigation";
import { clearWebSession } from "@/auth/web-session";

export async function logoutAction(): Promise<never> {
  await clearWebSession();
  redirect("/login");
}
