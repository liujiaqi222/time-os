"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, ListTodo, Settings, SunMedium } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "cn";

const links = [
  { href: "/today", label: "今天", icon: SunMedium },
  { href: "/goals", label: "计划", icon: ListTodo },
  { href: "/history", label: "回顾", icon: History },
  { href: "/settings", label: "设置", icon: Settings },
];

function isCurrentPath(pathname: string, href: string) {
  if (href === "/goals") {
    return pathname === href || pathname.startsWith("/tracks/");
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PrimaryNav({ variant }: { variant: "desktop" | "mobile" }) {
  const pathname = usePathname();

  if (variant === "desktop") {
    return (
      <nav aria-label="主导航" className="hidden items-center gap-1 sm:flex">
        {links.map(({ href, label, icon: Icon }) => {
          const isCurrent = isCurrentPath(pathname, href);

          return (
            <Button
              key={href}
              variant="ghost"
              size="sm"
              nativeButton={false}
              className={cn(
                "text-stone-600",
                isCurrent && "bg-stone-200/70 text-stone-950",
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
      className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-2xl border border-stone-200/90 bg-[#fffdf8]/95 p-1.5 shadow-[0_10px_35px_rgba(28,25,23,0.16)] backdrop-blur sm:hidden"
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
