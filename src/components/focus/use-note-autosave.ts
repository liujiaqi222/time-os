"use client";

import { useEffect, useRef, useState } from "react";

export type NoteAutosaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Debounced Quick Note autosave (PRD §7.9): 500ms after the last edit the
 * note is saved and the status machine feeds the saving indicator. The
 * save action is injected, so tests can drive the hook without the
 * network.
 */
export function useNoteAutosave(options: {
  sessionId: string;
  initialNote: string | null;
  save: (sessionId: string, note: string | null) => Promise<{ ok: boolean }>;
  /** Notified with the note after a successful save (e.g. to sync dialogs). */
  onSaved?: (note: string) => void;
}) {
  const { sessionId, initialNote, save, onSaved } = options;
  const [note, setNote] = useState(initialNote ?? "");
  const [status, setStatus] = useState<NoteAutosaveStatus>("idle");
  const lastSavedRef = useRef(initialNote ?? "");
  const onSavedRef = useRef(onSaved);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    if (note === lastSavedRef.current) return;

    setStatus("saving");
    const timeout = setTimeout(async () => {
      const result = await save(sessionId, note);
      if (result.ok) {
        lastSavedRef.current = note;
        setStatus("saved");
        onSavedRef.current?.(note);
      } else {
        setStatus("error");
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [note, sessionId, save]);

  return { note, setNote, status };
}
