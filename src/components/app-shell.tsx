import Link from "next/link";
import { History, ListTodo, Settings, SunMedium } from "lucide-react";

import { logoutAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { ActiveSessionBanner } from "@/components/active-session-banner";
import type { SessionWithRelations } from "@/services/session";

const links = [
  { href: "/today", label: "Today", icon: SunMedium },
  { href: "/goals", label: "Goals", icon: ListTodo },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

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
          <nav
            aria-label="Primary"
            className="flex items-center gap-1 overflow-x-auto"
          >
            {links.map(({ href, label, icon: Icon }) => (
              <Button
                key={href}
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href={href} />}
              >
                <Icon aria-hidden="true" />
                {label}
              </Button>
            ))}
          </nav>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              Logout
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-5 py-10">{children}</main>
    </div>
  );
}
