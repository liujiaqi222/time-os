"use client";
import { useState, useSyncExternalStore } from "react";
import { timerDisplay } from "@/shared/pomodoro";
import type { SessionView } from "@/services/session";

function subscribe(tick: () => void) {
  const timer = setInterval(tick, 500);
  return () => clearInterval(timer);
}
const snapshot = () => Math.floor(performance.now() / 1000);
const serverSnapshot = (): number | null => null;

export function useTimerDisplay(session: SessionView) {
  const now = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [anchor, setAnchor] = useState({ key: session.serverNow, at: now });
  if (anchor.key !== session.serverNow || (anchor.at === null && now !== null))
    setAnchor({ key: session.serverNow, at: now });
  return timerDisplay(
    session,
    anchor.key === session.serverNow && now !== null && anchor.at !== null
      ? now - anchor.at
      : 0,
  );
}
