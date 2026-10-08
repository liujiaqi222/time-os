// @vitest-environment jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNoteAutosave } from "@/components/today/use-note-autosave";

/**
 * Versioned note autosave (PRD §6.5): every save carries the content
 * version it was based on; stale writes surface as conflicts instead of
 * overwriting newer text, and the local input always survives.
 */
describe("useNoteAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function renderAutosave(options?: {
    initialNote?: string | null;
    initialVersion?: number;
    save?: (
      sessionId: string,
      note: string | null,
      expectedVersion: number,
    ) => Promise<{ ok: boolean; code?: string; version?: number }>;
    reload?: () => Promise<{ note: string | null; version: number } | null>;
  }) {
    const save =
      options?.save ??
      vi
        .fn<
          (
            sessionId: string,
            note: string | null,
            expectedVersion: number,
          ) => Promise<{ ok: boolean; code?: string; version?: number }>
        >()
        .mockResolvedValue({ ok: true });
    const reload =
      options?.reload ??
      vi
        .fn<() => Promise<{ note: string | null; version: number } | null>>()
        .mockResolvedValue({ note: "server text", version: 7 });
    const hook = renderHook(() =>
      useNoteAutosave({
        sessionId: "s1",
        initialNote: options?.initialNote ?? null,
        initialVersion: options?.initialVersion ?? 0,
        save,
        reload,
      }),
    );
    return { ...hook, save, reload };
  }

  it("stays idle until the note changes", async () => {
    const { result, save } = renderAutosave();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("debounces, saves with the current version, then bumps it", async () => {
    const { result, save } = renderAutosave();
    act(() => result.current.setNote("first draft"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenCalledWith("s1", "first draft", 0);
    expect(result.current.status).toBe("saved");

    act(() => result.current.setNote("second draft"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenLastCalledWith("s1", "second draft", 1);
  });

  it("reports a conflict without losing the local text on a stale version", async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "VERSION_CONFLICT" })
      .mockResolvedValue({ ok: true });
    const { result } = renderAutosave({ save });

    act(() => result.current.setNote("my newer words"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(result.current.status).toBe("conflict");
    expect(result.current.note).toBe("my newer words");
  });

  it("resolveConflict rebases onto the latest version and keeps the input", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const reload = vi
      .fn()
      .mockResolvedValue({ note: "other client's words", version: 5 });
    const { result } = renderAutosave({ save, reload });

    act(() => result.current.setNote("my words"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.status).toBe("saved");

    // Simulate another client bumping the version to 5.
    act(() => void result.current.resolveConflict());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(save).toHaveBeenLastCalledWith("s1", "my words", 5);
    expect(result.current.status).toBe("saved");
    expect(result.current.note).toBe("my words");
  });

  it("flush transfers pending text to finish and cancels the separate save", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderAutosave({ save });

    act(() => result.current.setNote("last words"));
    const flushed = await act(async () => result.current.flush());
    expect(flushed).toEqual({
      note: "last words",
      expectedVersion: 0,
      changed: true,
    });
    await act(async () => vi.advanceTimersByTime(600));
    expect(save).not.toHaveBeenCalled();
  });

  it("flush reports changed=false when nothing is pending", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderAutosave({ save, initialNote: "saved" });
    const flushed = await act(async () => result.current.flush());
    expect(flushed).toEqual({
      note: "saved",
      expectedVersion: 0,
      changed: false,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("never re-saves an unchanged note after reverting", async () => {
    const { result, save } = renderAutosave();
    act(() => result.current.setNote("same"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenCalledTimes(1);

    act(() => result.current.setNote("other"));
    act(() => result.current.setNote("same"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("reports error when the save fails for other reasons", async () => {
    const save = vi
      .fn()
      .mockResolvedValue({ ok: false, code: "INTERNAL_ERROR" });
    const { result } = renderAutosave({ save });
    act(() => result.current.setNote("doomed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.status).toBe("error");
  });
});
