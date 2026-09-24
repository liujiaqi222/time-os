import Link from "next/link";

import { logoutAction } from "@/app/actions";
import { ActiveSessionBanner } from "@/components/active-session-banner";
import { PrimaryNav } from "@/components/primary-nav";
import { Button } from "@/components/ui/button";
import type { SessionWithRelations } from "@/services/session";

export function AppShell({
  children,
  activeSession,
}: {
  children: React.ReactNode;
  activeSession?: SessionWithRelations | null;
}) {
  return (
    <div className="min-h-screen bg-[#f7f5ef] text-stone-950">
      {activeSession && <ActiveSessionBanner session={activeSession} />}
      <header className="border-b border-stone-200 bg-[#f7f5ef]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-5 py-4">
          <Link href="/today" className="font-semibold tracking-tight">
            Time OS
          </Link>
          <PrimaryNav variant="desktop" />
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              退出
            </Button>
          </form>
        </div>
      </header>
      <PrimaryNav variant="mobile" />
      <main className="mx-auto w-full max-w-6xl px-5 pt-8 pb-28 sm:py-10">
        {children}
      </main>
    </div>
  );
}
