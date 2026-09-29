"use client";

import { useState } from "react";
import { Archive, BellRing, ChevronDown, Edit2, Lightbulb } from "lucide-react";

import type { useDistractions } from "@/components/focus/use-distractions";
import type { NoteAutosaveStatus } from "@/components/today/use-note-autosave";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type CaptureMode = "note" | "distraction";

export function FocusCapture({
  sessionId,
  mode,
  onModeChange,
  inputRef,
  distractions,
  distractionsReady,
  note,
  noteStatus,
  onNoteChange,
  onResolveNoteConflict,
  onDismissNoteConflict,
}: {
  sessionId: string;
  mode: CaptureMode;
  onModeChange: (mode: CaptureMode) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  distractions: ReturnType<typeof useDistractions>;
  distractionsReady: boolean;
  note: string;
  noteStatus: NoteAutosaveStatus;
  onNoteChange: (note: string) => void;
  onResolveNoteConflict: () => Promise<void>;
  onDismissNoteConflict: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasContent = Boolean(note.trim()) || distractions.list.length > 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();

    if (mode === "note") {
      if (!text) return;
      onNoteChange([note.trimEnd(), text].filter(Boolean).join("\n"));
      setDraft("");
      return;
    }

    if (!distractionsReady) return;
    const ok = await distractions.create({
      sessionId,
      text: text || null,
    });
    if (ok) setDraft("");
  };

  return (
    <section className="mt-10 border-t border-stone-200 pt-5">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-stone-50 p-2 sm:flex-row sm:items-center"
      >
        <div className="grid shrink-0 grid-cols-2 rounded-lg bg-stone-200/70 p-0.5">
          <ModeButton
            active={mode === "note"}
            onClick={() => onModeChange("note")}
            icon={<Lightbulb aria-hidden="true" />}
          >
            想法
          </ModeButton>
          <ModeButton
            active={mode === "distraction"}
            onClick={() => onModeChange("distraction")}
            icon={<BellRing aria-hidden="true" />}
          >
            打断
          </ModeButton>
        </div>
        <Input
          ref={inputRef}
          aria-label="快速记录"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            mode === "note" ? "记下刚刚想到的…" : "刚才是什么打断了你？"
          }
          className="h-9 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-9 bg-white px-3"
          disabled={
            (mode === "note" && !draft.trim()) ||
            (mode === "distraction" && !distractionsReady)
          }
        >
          {mode === "distraction" && !distractionsReady ? "准备中…" : "记下"}
        </Button>
      </form>

      <div className="mt-2 flex min-h-7 flex-wrap items-center justify-between gap-2 px-1 text-xs text-stone-400">
        <span>
          {mode === "note"
            ? noteStatus === "saving"
              ? "想法保存中…"
              : noteStatus === "saved"
                ? "想法已保存"
                : "想法会追加到本次随手记"
            : "按 D 可随时切到打断记录"}
        </span>
        {hasContent && (
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
            className="flex items-center gap-1 font-medium text-stone-500 hover:text-stone-800"
          >
            {note.trim() && "随手记"}
            {note.trim() && distractions.list.length > 0 && " · "}
            {distractions.list.length > 0 &&
              `${distractions.list.length} 条打断`}
            <ChevronDown
              className={`size-3.5 transition-transform ${detailsOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {detailsOpen && hasContent && (
        <div className="mt-3 space-y-4 rounded-xl border border-stone-200 bg-white p-4 text-left">
          {note.trim() && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="focus-note"
                  className="text-xs font-medium text-stone-500"
                >
                  本次随手记
                </label>
                <span className="text-xs text-stone-400">
                  {noteStatus === "saving" && "保存中…"}
                  {noteStatus === "saved" && "已保存"}
                  {noteStatus === "error" && "保存失败"}
                </span>
              </div>
              <textarea
                id="focus-note"
                rows={4}
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                className="w-full resize-y rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm leading-6 focus:border-stone-400 focus:outline-hidden"
              />
            </div>
          )}

          {noteStatus === "conflict" && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            >
              <span>随手记在其他端有更新。你的输入已保留。</span>
              <span className="flex gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void onResolveNoteConflict()}
                >
                  用我的版本保存
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void onDismissNoteConflict()}
                >
                  放弃我的修改
                </Button>
              </span>
            </div>
          )}

          {distractions.list.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-stone-500">打断</p>
              <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                {distractions.list.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 p-3 text-sm"
                  >
                    {distractions.editingId === item.id ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void distractions.saveEdit(item.id);
                        }}
                        className="flex flex-1 items-center gap-2"
                      >
                        <Input
                          value={distractions.editingText}
                          onChange={(event) =>
                            distractions.setEditingText(event.target.value)
                          }
                          className="h-8 text-xs"
                          autoFocus
                        />
                        <Button type="submit" size="xs">
                          保存
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          onClick={distractions.cancelEdit}
                        >
                          取消
                        </Button>
                      </form>
                    ) : (
                      <>
                        <span className="truncate text-stone-700">
                          {item.text || "快速打断记录"}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="text-stone-400 hover:text-stone-700"
                            onClick={() => distractions.beginEdit(item)}
                            aria-label="编辑打断"
                          >
                            <Edit2 aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="text-stone-400 hover:text-stone-700"
                            onClick={() => void distractions.archive(item.id)}
                            aria-label="归档打断"
                          >
                            <Archive aria-hidden="true" />
                          </Button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {distractions.error && (
            <p role="alert" className="text-xs text-red-600">
              {distractions.error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-8 items-center justify-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors [&_svg]:size-3.5 ${
        active
          ? "bg-white text-stone-900 shadow-sm"
          : "text-stone-500 hover:text-stone-800"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
