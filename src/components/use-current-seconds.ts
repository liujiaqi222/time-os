"use client";

import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void) {
  const timer = setInterval(onStoreChange, 1000);
  return () => clearInterval(timer);
}

function getSnapshot() {
  // Second granularity keeps the snapshot stable within a tick.
  return Math.floor(Date.now() / 1000);
}

function getServerSnapshot() {
  return null;
}

/**
 * Ticking clock for live timers (seconds since the epoch), or `null` during
 * server render and the first hydration render. Using a server snapshot of
 * `null` keeps SSR output deterministic so live timestamps never break
 * hydration; components render a placeholder until the store ticks.
 */
export function useCurrentSeconds(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
