// @vitest-environment jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNoteAutosave } from "@/components/focus/use-note-autosave";

describe("useNoteAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("stays idle until the note changes", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() =>
      useNoteAutosave({ sessionId: "s1", initialNote: null, save }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("debounces the save and reports saving → saved", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() =>
      useNoteAutosave({ sessionId: "s1", initialNote: null, save }),
    );

    act(() => result.current.setNote("first draft"));
    expect(result.current.status).toBe("saving");
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(save).toHaveBeenCalledWith("s1", "first draft");
    expect(result.current.status).toBe("saved");
  });

  it("resets the debounce while typing", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() =>
      useNoteAutosave({ sessionId: "s1", initialNote: null, save }),
    );

    act(() => result.current.setNote("a"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    act(() => result.current.setNote("ab"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("s1", "ab");
  });

  it("never re-saves an unchanged note", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() =>
      useNoteAutosave({ sessionId: "s1", initialNote: null, save }),
    );

    act(() => result.current.setNote("same"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(save).toHaveBeenCalledTimes(1);

    // Set it back to the saved value: no new save fires.
    act(() => result.current.setNote("other"));
    act(() => result.current.setNote("same"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("reports error when the save fails", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false });
    const { result } = renderHook(() =>
      useNoteAutosave({ sessionId: "s1", initialNote: null, save }),
    );

    act(() => result.current.setNote("doomed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.status).toBe("error");
  });

  it("notifies onSaved with the saved note", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    const { result } = renderHook(() =>
      useNoteAutosave({
        sessionId: "s1",
        initialNote: null,
        save,
        onSaved,
      }),
    );

    act(() => result.current.setNote("shared"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(onSaved).toHaveBeenCalledWith("shared");
  });
});
