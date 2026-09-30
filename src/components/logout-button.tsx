"use client";

import { logoutAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { onboardingDraftStorageKey } from "@/shared/onboarding";

export function LogoutButton() {
  return (
    <form
      action={logoutAction}
      onSubmit={() => {
        localStorage.removeItem(
          onboardingDraftStorageKey(window.location.origin),
        );
      }}
    >
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="rounded-full text-stone-500"
      >
        退出
      </Button>
    </form>
  );
}
