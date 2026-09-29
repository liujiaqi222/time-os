"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type NoteAutosaveStatus =
  "idle" | "saving" | "saved" | "conflict" | "error";

export interface NoteSaveResult {
  ok: boolean;
  code?: string;
  version?: number;
}

/**
 * Versioned Quick Note autosave (PRD §6.5): every save carries the content
 * version the edit was based on. The server rejects stale versions with
 * VERSION_CONFLICT, so an out-of-order request can never overwrite newer
 * text — the local input survives and can be recovered explicitly.
 */
export function useNoteAutosave(options: {
  sessionId: string;
  initialNote: string | null;
  initialVersion: number;
  save: (
    sessionId: string,
    note: string | null,
    expectedVersion: number,
  ) => Promise<NoteSaveResult>;
  /** Fetch the latest note/version after a conflict (recovery path). */
  reload: () => Promise<{ note: string | null; version: number } | null>;
  /** Notified with the note after a successful save. */
  onSaved?: (note: string) => void;
}) {
  const { sessionId, initialNote, initialVersion, save, reload, onSaved } =
    options;
  const [note, setNote] = useState(initialNote ?? "");
  const [status, setStatus] = useState<NoteAutosaveStatus>("idle");
  const versionRef = useRef(initialVersion);
  const lastSavedRef = useRef(initialNote ?? "");
  const onSavedRef = useRef(onSaved);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const persist = useCallback(
    async (text: string, expectedVersion: number) => {
      setStatus("saving");
      const result = await save(sessionId, text, expectedVersion);
      if (result.ok) {
        versionRef.current = expectedVersion + 1;
        lastSavedRef.current = text;
        setStatus("saved");
        onSavedRef.current?.(text);
      } else if (result.code === "VERSION_CONFLICT") {
        setStatus("conflict");
      } else {
        setStatus("error");
      }
      return result;
    },
    [sessionId, save],
  );

  useEffect(() => {
    if (note === lastSavedRef.current) return;

    setStatus("saving");
    const timeout = setTimeout(async () => {
      await persist(note, versionRef.current);
    }, 600);

    return () => clearTimeout(timeout);
  }, [note, persist]);

  /** Flush a pending debounced save immediately (used before finish). */
  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const changed = note !== lastSavedRef.current;
    if (!changed) {
      return {
        note: note || null,
        expectedVersion: versionRef.current,
        changed: false,
      };
    }
    // Report the version this save was based on, so the finish request
    // carries the same optimistic version the server will check.
    const usedVersion = versionRef.current;
    await persist(note, usedVersion);
    return {
      note: note || null,
      expectedVersion: usedVersion,
      changed: true,
    };
  }, [note, persist]);

  /**
   * Conflict recovery (PRD §6.5): reload the latest version and re-save
   * the local text on top of it — never discarding the user's input.
   */
  const resolveConflict = useCallback(async () => {
    const latest = await reload();
    if (!latest) {
      setStatus("error");
      return;
    }
    versionRef.current = latest.version;
    if (note !== latest.note) {
      await persist(note, latest.version);
    } else {
      lastSavedRef.current = note;
      setStatus("saved");
    }
  }, [note, persist, reload]);

  const dismissConflict = useCallback(async () => {
    const latest = await reload();
    if (!latest) {
      setStatus("error");
      return;
    }
    versionRef.current = latest.version;
    lastSavedRef.current = latest.note ?? "";
    setNote(latest.note ?? "");
    setStatus("idle");
  }, [reload]);

  return {
    note,
    setNote,
    status,
    flush,
    resolveConflict,
    dismissConflict,
    version: versionRef,
    savedNote: lastSavedRef,
  };
}
