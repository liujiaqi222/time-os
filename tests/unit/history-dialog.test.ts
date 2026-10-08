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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/history/actions", () => ({
  logSessionAction: vi.fn(),
  updateHistorySessionAction: vi.fn(),
  cancelHistorySessionAction: vi.fn(),
  getHistorySessionAction: vi.fn(),
  archiveHistoryDistractionAction: vi.fn(),
  updateHistoryDistractionAction: vi.fn(),
}));
import { RecordDialog } from "@/components/history/record-dialog";
import {
  logSessionAction,
  updateHistorySessionAction,
} from "@/app/(app)/history/actions";
import type { HistorySessionDetail } from "@/services/history";

const now = new Date("2026-06-02T12:00:00Z");
const detail: HistorySessionDetail = {
  id: "00000000-0000-4000-8000-000000000001",
  goalId: "00000000-0000-4000-8000-000000000002",
  taskId: null,
  status: "completed",
  entryMode: "timer",
  createdVia: "web",
  timerMode: "stopwatch",
  timeBasis: "observed",
  timerConfig: null,
  intent: null,
  note: "原始文字",
  resumeHint: "下一步",
  noteVersion: 1,
  resumeHintVersion: 2,
  revision: 3,
  startedAt: new Date("2026-06-01T23:30:01Z"),
  endedAt: new Date("2026-06-02T00:30:02Z"),
  durationSeconds: 1800,
  createdAt: now,
  updatedAt: now,
  goal: {
    id: "00000000-0000-4000-8000-000000000002",
    title: "目标",
    description: null,
    status: "active",
    position: 1,
    createdAt: now,
    updatedAt: now,
  },
  task: null,
  intervals: [],
  phases: [],
  distractions: [],
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("text edits send only changed text plus versions, preserving exact observed time", async () => {
  vi.mocked(updateHistorySessionAction).mockResolvedValue({
    ok: true,
    data: detail,
  });
  const close = vi.fn();
  render(
    createElement(RecordDialog, {
      detail,
      targets: [{ goal: detail.goal, tasks: [] }],
      timezone: "Asia/Shanghai",
      now,
      onClose: close,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "更正记录" }));
  fireEvent.change(screen.getByLabelText("笔记", { exact: true }), {
    target: { value: "修改后的笔记" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存更正" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(updateHistorySessionAction).toHaveBeenCalledWith({
    id: detail.id,
    timezone: "Asia/Shanghai",
    expectedRevision: 3,
    expectedNoteVersion: 1,
    expectedResumeHintVersion: 2,
    note: "修改后的笔记",
    allowOverlap: false,
  });
});
it("overlap confirmation preserves input and reuses the same submission key", async () => {
  vi.mocked(logSessionAction)
    .mockResolvedValueOnce({
      ok: false,
      error: {
        code: "SESSION_TIME_OVERLAP",
        message: "overlap",
        context: {
          goal: "冲突目标",
          startedAt: "2026-06-02T11:30:00Z",
          endedAt: "2026-06-02T12:00:00Z",
        },
      },
    })
    .mockResolvedValueOnce({ ok: true, data: detail });
  render(
    createElement(RecordDialog, {
      targets: [{ goal: detail.goal, tasks: [] }],
      timezone: "UTC",
      now,
      onClose: vi.fn(),
    }),
  );
  fireEvent.change(screen.getByLabelText("笔记", { exact: true }), {
    target: { value: "保留这段输入" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存补录" }));
  await screen.findByText("与已有记录时间冲突");
  expect((screen.getByLabelText("笔记") as HTMLTextAreaElement).value).toBe(
    "保留这段输入",
  );
  fireEvent.click(screen.getByRole("button", { name: "仍然保存" }));
  await waitFor(() => expect(logSessionAction).toHaveBeenCalledTimes(2));
  const [first, second] = vi.mocked(logSessionAction).mock.calls;
  expect(second![0]).toEqual({ ...first![0], allowOverlap: true });
});
