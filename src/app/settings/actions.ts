"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { settingsUpdateContract } from "@/adapters/settings-contract";
import { readWebSession } from "@/auth/web-session";
import { settingsService } from "@/services";
import { updateSettingsSchema } from "@/shared/schemas/settings";

export type SettingsFormState =
  { status: "error" | "success"; message: string } | undefined;

export async function saveSettingsAction(
  _previousState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  if (!(await readWebSession())) redirect("/login");

  const parsed = updateSettingsSchema.safeParse({
    timezone: formData.get("timezone"),
    defaultFocusMinutes: formData.get("defaultFocusMinutes"),
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

  if (completeSetup) redirect("/today");
  revalidatePath("/settings");
  return { status: "success", message: "设置已保存。" };
}
