"use client";

import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { configOf } from "@/shared/pomodoro";
import { unlockTimerSound } from "./timer-sound";

export function SoundToggle({
  value,
  onChange,
  onSaved,
}: {
  value: unknown;
  onChange?: (enabled: boolean) => void;
  onSaved?: () => void;
}) {
  const serverEnabled = configOf(value).soundEnabled;
  const [lastServerEnabled, setLastServerEnabled] = useState(serverEnabled);
  const [enabled, setEnabled] = useState(serverEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  if (lastServerEnabled !== serverEnabled) {
    setLastServerEnabled(serverEnabled);
    setEnabled(serverEnabled);
  }
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="到时提示音"
              aria-pressed={enabled}
              disabled={saving}
              className={enabled ? "text-[#b54b35]" : "text-stone-400"}
              onClick={async () => {
                const next = !enabled;
                if (next) unlockTimerSound();
                setEnabled(next);
                onChange?.(next);
                setSaving(true);
                setError(false);
                try {
                  const response = await fetch("/api/settings/timer-sound", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ soundEnabled: next }),
                  });
                  const result = await response.json();
                  if (!response.ok || !result.ok)
                    throw new Error("Sound preference was not saved");
                  onSaved?.();
                } catch {
                  setEnabled(enabled);
                  onChange?.(enabled);
                  setError(true);
                } finally {
                  setSaving(false);
                }
              }}
            />
          }
        >
          {enabled ? (
            <Volume2 aria-hidden="true" />
          ) : (
            <VolumeX aria-hidden="true" />
          )}
        </TooltipTrigger>
        <TooltipContent>
          {enabled ? "关闭到时提示音" : "开启到时提示音"}
        </TooltipContent>
      </Tooltip>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          提示音设置未保存，请重试。
        </span>
      )}
    </TooltipProvider>
  );
}
