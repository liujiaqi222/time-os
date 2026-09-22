"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authenticatePassword } from "@/auth/login-service";
import { safeReturnPath } from "@/auth/secrets";
import { createWebSession } from "@/auth/web-session";
import { DomainError } from "@/shared/domain-error";

export type LoginState = { error?: string } | undefined;

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const password = formData.get("password");
  if (typeof password !== "string" || !password)
    return { error: "请输入密码。" };

  const requestHeaders = await headers();
  const identity =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    requestHeaders.get("x-real-ip") ??
    "unknown";

  try {
    await authenticatePassword(password, identity);
  } catch (error) {
    if (error instanceof DomainError && error.code === "TOO_MANY_ATTEMPTS") {
      return { error: "尝试次数过多，请稍后再试。" };
    }
    if (error instanceof DomainError && error.code === "UNAUTHORIZED") {
      return { error: "密码不正确。" };
    }
    return { error: "暂时无法登录，请检查数据库连接与 migration。" };
  }

  await createWebSession();
  redirect(safeReturnPath(String(formData.get("next") ?? "/today")));
}
