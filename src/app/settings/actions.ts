"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";

import { settingsUpdateContract } from "@/adapters/settings-contract";
import { auth } from "@/auth/auth";
import { readWebSession } from "@/auth/web-session";
import { oauthAccessToken, oauthRefreshToken } from "@/db/auth-schema";
import { authDb } from "@/db/client";
import { settingsService } from "@/services";
import { updateSettingsSchema } from "@/shared/schemas/settings";

export type SettingsFormState =
  { status: "error" | "success"; message: string } | undefined;

export async function saveSettingsAction(
  _previous_state: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  if (!(await readWebSession())) redirect("/login");

  const parsed = updateSettingsSchema.safeParse({
    timezone: formData.get("timezone"),
    weekStartsOn: formData.get("weekStartsOn"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "设置无效。",
    };
  }

  const completeSetup = formData.get("mode") === "setup";
  const result = await settingsUpdateContract(
    settingsService,
    { actor: "web" },
    parsed.data,
    { completeSetup },
  );
  if (!result.ok) return { status: "error", message: result.error.message };

  if (completeSetup) redirect("/onboarding");
  revalidatePath("/settings");
  return { status: "success", message: "设置已保存。" };
}

export async function disconnectChatGptAction(
  consentId: string,
  clientId: string,
): Promise<void> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/login?next=/settings");

  const now = new Date();
  await authDb.transaction(async (tx) => {
    await tx
      .update(oauthAccessToken)
      .set({ revoked: now })
      .where(
        and(
          eq(oauthAccessToken.clientId, clientId),
          eq(oauthAccessToken.userId, session.user.id),
          isNull(oauthAccessToken.revoked),
        ),
      );
    await tx
      .update(oauthRefreshToken)
      .set({ revoked: now })
      .where(
        and(
          eq(oauthRefreshToken.clientId, clientId),
          eq(oauthRefreshToken.userId, session.user.id),
          isNull(oauthRefreshToken.revoked),
        ),
      );
  });
  await auth.api.deleteOAuthConsent({
    body: { id: consentId },
    headers: requestHeaders,
  });
  revalidatePath("/settings");
}
