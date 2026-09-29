import Link from "next/link";
import { Settings } from "lucide-react";

import { logoutAction } from "@/app/actions";
import { ActiveSessionBanner } from "@/components/active-session-banner";
import { PrimaryNav } from "@/components/primary-nav";
import { Button } from "@/components/ui/button";
import type { SessionView } from "@/services/session";

export function AppShell({
  children,
  activeSession,
}: {
  children: React.ReactNode;
  activeSession?: SessionView | null;
}) {
  return (
    <div className="min-h-screen bg-[#f7f5ef] text-stone-950">
      <ActiveSessionBanner initialSession={activeSession ?? null} />
      <header className="border-b border-stone-200 bg-[#f7f5ef]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-5 py-4">
          <Link href="/today" className="font-semibold tracking-tight">
            Time OS
          </Link>
          <PrimaryNav variant="desktop" />
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="设置"
              nativeButton={false}
              render={<Link href="/settings" />}
            >
              <Settings aria-hidden="true" />
            </Button>
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm">
                退出
              </Button>
            </form>
          </div>
        </div>
      </header>
      <PrimaryNav variant="mobile" />
      <main className="mx-auto w-full max-w-3xl px-5 pt-8 pb-28 sm:py-10">
        {children}
      </main>
    </div>
  );
}
