"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Footprints, SunMedium } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "cn";

/**
 * Main navigation (PRD §5.1 / §8.3): only 今天 and 足迹. Settings lives
 * behind a gear; the remaining real maintenance pages stay reachable
 * from there.
 */

const links = [
  { href: "/today", label: "今天", icon: SunMedium },
  { href: "/history", label: "足迹", icon: Footprints },
];

function isCurrentPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNav({ variant }: { variant: "desktop" | "mobile" }) {
  const pathname = usePathname();

  if (variant === "desktop") {
    return (
      <nav
        aria-label="主导航"
        className="hidden items-center gap-1 rounded-xl border border-stone-200 bg-white p-1 sm:flex"
      >
        {links.map(({ href, label, icon: Icon }) => {
          const isCurrent = isCurrentPath(pathname, href);
          return (
            <Button
              key={href}
              variant="ghost"
              size="sm"
              nativeButton={false}
              className={cn(
                "rounded-lg px-3 text-stone-600",
                // hover:text-white beats the ghost variant's hover:text-foreground,
                // which would turn the label dark on the dark active pill.
                isCurrent &&
                  "bg-[#26231f] text-white shadow-sm hover:bg-stone-800 hover:text-white",
              )}
              render={
                <Link
                  href={href}
                  aria-current={isCurrent ? "page" : undefined}
                />
              }
            >
              <Icon aria-hidden="true" />
              {label}
            </Button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 grid grid-cols-2 rounded-2xl border border-stone-200 bg-white p-1.5 shadow-[0_10px_30px_rgba(28,25,23,0.12)] sm:hidden"
    >
      {links.map(({ href, label, icon: Icon }) => {
        const isCurrent = isCurrentPath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium text-stone-500 transition-colors",
              isCurrent && "bg-stone-900 text-white",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
