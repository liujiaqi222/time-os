// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SessionView } from "@/services/session";

vi.mock("@/app/(app)/session-actions", () => ({
  listDistractionsAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  archiveDistractionAction: vi.fn(),
  createDistractionAction: vi.fn(),
  getSessionAction: vi.fn(),
  updateDistractionAction: vi.fn(),
  updateNoteAction: vi.fn(),
}));
vi.mock("@/components/focus/use-distractions", () => ({
  useDistractions: () => ({ replace: vi.fn() }),
}));
vi.mock("@/components/today/use-note-autosave", () => ({
  useNoteAutosave: () => ({
    note: "未保存的笔记",
    flush: async () => ({
      note: "未保存的笔记",
      expectedVersion: 2,
      changed: true,
    }),
  }),
}));
vi.mock("@/components/today/use-timer-display", () => ({
  useTimerDisplay: () => ({ due: true, seconds: 0 }),
}));
vi.mock("@/components/today/timer-sound", () => ({
  remindPhaseOnce: vi.fn(),
  unlockTimerSound: vi.fn(),
}));
vi.mock("@/components/focus/focus-capture", () => ({
  FocusCapture: () => null,
}));
vi.mock("@/components/today/timer-preferences", () => ({
  TimerPreferences: () => null,
}));
vi.mock("@/components/today/sound-toggle", () => ({ SoundToggle: () => null }));
import { RunPanel } from "@/components/today/run-panel";

const session = {
  id: "session",
  status: "active",
  timerMode: "pomodoro",
  timerConfig: { iterations: 4 },
  completedFocusCount: 3,
  note: "",
  noteVersion: 2,
  goal: { title: "目标" },
  task: null,
  phase: { id: "last-phase", kind: "focus", complete: false },
  phases: [],
} as unknown as SessionView;
const props = {
  session,
  busy: "none" as const,
  cancelOpen: false,
  onPreferencesSaved: vi.fn(),
  onSessionUpdated: vi.fn(),
  onSessionLost: vi.fn(),
  onOpenCancel: vi.fn(),
  onBusyChange: vi.fn(),
};
afterEach(cleanup);
it("automatically finishes once at the local final deadline and flushes pending notes", async () => {
  const finish = vi.fn().mockResolvedValue(true);
  const view = render(
    createElement(RunPanel, { ...props, onFinishRequested: finish }),
  );
  await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
  expect(finish).toHaveBeenCalledWith({
    note: "未保存的笔记",
    expectedVersion: 2,
    changed: true,
  });
  view.rerender(
    createElement(RunPanel, {
      ...props,
      session: { ...session },
      onFinishRequested: finish,
    }),
  );
  expect(finish).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "完成并保存" })).toBeNull();
});
it("retains a retry after failure without repeatedly submitting in the background", async () => {
  const finish = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  render(createElement(RunPanel, { ...props, onFinishRequested: finish }));
  const retry = await screen.findByRole("button", { name: "重试保存" });
  expect(finish).toHaveBeenCalledTimes(1);
  fireEvent.click(retry);
  await waitFor(() => expect(finish).toHaveBeenCalledTimes(2));
});
it("does not automatically finish at an intermediate deadline", async () => {
  const finish = vi.fn().mockResolvedValue(true);
  render(
    createElement(RunPanel, {
      ...props,
      session: { ...session, completedFocusCount: 2 },
      onFinishRequested: finish,
    }),
  );
  await screen.findByRole("button", { name: /^开始休息$/ });
  expect(finish).not.toHaveBeenCalled();
});
