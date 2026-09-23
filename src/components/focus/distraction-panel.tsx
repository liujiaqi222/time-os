"use client";

import { useState } from "react";
import { Archive, Edit2 } from "lucide-react";

import type { useDistractions } from "@/components/focus/use-distractions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Distraction log card: quick-log form plus the list with inline editing
 * (PRD §4.5). State comes from the useDistractions hook; the input ref is
 * owned by the page so the D shortcut can focus it.
 */
export function DistractionPanel({
  sessionId,
  distractions,
  inputRef,
}: {
  sessionId: string;
  distractions: ReturnType<typeof useDistractions>;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState("");

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const ok = await distractions.create({
      sessionId,
      text: text.trim() || null,
    });
    if (ok) setText("");
  };

  return (
    <Card className="border-stone-200/80 bg-white/80 shadow-xs">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-medium tracking-wider text-stone-500 uppercase">
            Distractions (按 D 快速记录)
          </span>
          <span className="font-mono text-xs text-stone-400">
            {distractions.list.length} 条打断
          </span>
        </div>

        {/* Distraction Form */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="记录打断 (可留空)..."
            className="h-9 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" className="h-9">
            记录
          </Button>
        </form>

        {distractions.error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
          >
            {distractions.error}
          </div>
        )}

        {/* Distractions List */}
        {distractions.list.length > 0 && (
          <ul className="divide-y divide-stone-100 rounded-lg border border-stone-100 bg-stone-50/50">
            {distractions.list.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                {distractions.editingId === d.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      distractions.saveEdit(d.id);
                    }}
                    className="flex flex-1 items-center gap-2"
                  >
                    <Input
                      value={distractions.editingText}
                      onChange={(e) =>
                        distractions.setEditingText(e.target.value)
                      }
                      className="h-8 text-xs"
                      autoFocus
                    />
                    <Button type="submit" size="sm" className="h-8 text-xs">
                      保存
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={distractions.cancelEdit}
                    >
                      取消
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="truncate text-stone-700">
                      {d.text || "(快速打断记录)"}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-7 p-0 text-stone-400 hover:text-stone-700"
                        onClick={() => distractions.beginEdit(d)}
                        aria-label="编辑打断"
                      >
                        <Edit2 className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-7 p-0 text-stone-400 hover:text-stone-700"
                        onClick={() => distractions.archive(d.id)}
                        aria-label="归档打断"
                      >
                        <Archive className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
