// @vitest-environment jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/history/actions", () => ({
  getFirstExecutionFeedbackAction: vi
    .fn()
    .mockResolvedValue({ ok: true, data: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { EndCard } from "@/components/today/end-card";
import type { Task } from "@/db/schema";
import type { SessionView } from "@/services/session";

const now = new Date("2026-09-30T00:00:00.000Z");
const session: SessionView = {
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
  note: null,
  resumeHint: null,
  noteVersion: 0,
  resumeHintVersion: 0,
  revision: 1,
  startedAt: new Date("2026-09-29T23:56:24.000Z"),
  endedAt: now,
  durationSeconds: 216,
  createdAt: now,
  updatedAt: now,
  goal: {
    id: "00000000-0000-4000-8000-000000000002",
    title: "改进今天页面",
    description: null,
    status: "active",
    position: 1,
    createdAt: now,
    updatedAt: now,
  },
  task: null,
  intervals: [],
  serverNow: now.toISOString(),
  focusSeconds: 216,
  actions: ["resume_hint_update"],
};

const task: Task = {
  id: "00000000-0000-4000-8000-000000000003",
  goalId: session.goalId,
  title: "发一条帖子",
  description: null,
  status: "pending",
  position: 1,
  estimatedMinutes: null,
  resourceType: null,
  resourceValue: null,
  note: null,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};

afterEach(cleanup);

function renderEndCard(withTask = false) {
  const onSaveHint = vi.fn().mockResolvedValue({ ok: true });
  const onClose = vi.fn();
  const activeSession = withTask
    ? { ...session, taskId: task.id, task }
    : session;
  render(
    createElement(EndCard, {
      session: activeSession,
      task: withTask ? task : null,
      onCompleteTask: vi.fn().mockResolvedValue({ ok: true }),
      onSaveHint,
      onReloadHintVersion: vi.fn().mockResolvedValue(0),
      onClose,
    }),
  );
  return { onSaveHint, onClose };
}

describe("EndCard", () => {
  it("separates task completion from the next-step hint", () => {
    renderEndCard(true);

    const completion = screen.getByRole("button", {
      name: "标记任务完成",
    });
    const hint = screen.getByLabelText("下次继续的第一步");

    expect(completion.closest("section")?.getAttribute("aria-labelledby")).toBe(
      "execution-context-title",
    );
    expect(hint.closest("section")?.getAttribute("aria-labelledby")).toBe(
      "resume-hint-title",
    );
    expect(
      hint
        .closest("section")
        ?.contains(screen.getByRole("button", { name: "回到今天" })),
    ).toBe(false);
    expect(screen.queryByText("可选")).toBeNull();
    expect(hint.getAttribute("placeholder")).toBe("例如：先补完第二段的例子");
  });

  it("returns without a database write when the optional hint is untouched", () => {
    const { onSaveHint, onClose } = renderEndCard();

    fireEvent.click(screen.getByRole("button", { name: "回到今天" }));

    expect(onSaveHint).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it("writes only after the user changes the resume hint", async () => {
    const { onSaveHint, onClose } = renderEndCard();

    fireEvent.change(screen.getByLabelText("下次继续的第一步"), {
      target: { value: "先补完第二段的例子" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存起点并返回" }));

    await waitFor(() => {
      expect(onSaveHint).toHaveBeenCalledWith("先补完第二段的例子", 0);
      expect(onClose).toHaveBeenCalledWith(false);
    });
  });
});
