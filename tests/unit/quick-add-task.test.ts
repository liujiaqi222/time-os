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

import { IdlePanel } from "@/components/today/idle-panel";
import type { Task } from "@/db/schema";
import type { DashboardData } from "@/services/dashboard";

vi.mock("@/app/(app)/session-actions", () => ({
  listTasksAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  quickAddTaskAction: vi.fn(),
  selectionSetAction: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}));

import {
  quickAddTaskAction,
  selectionSetAction,
} from "@/app/(app)/session-actions";

const now = new Date("2026-09-30T00:00:00.000Z");

const mockDashboard: DashboardData = {
  serverNow: now.toISOString(),
  activeSession: null,
  selection: {
    goal: {
      id: "00000000-0000-4000-8000-000000000001",
      title: "产品首页重构",
      description: null,
      status: "active",
      position: 1,
      createdAt: now,
      updatedAt: now,
    },
    task: null,
    goalOnly: true,
    reason: "explicit-selection",
  },
  resumeHint: null,
  todos: [],
  goals: [
    {
      goal: {
        id: "00000000-0000-4000-8000-000000000001",
        title: "产品首页重构",
        description: null,
        status: "active",
        position: 1,
        createdAt: now,
        updatedAt: now,
      },
      pendingTaskCount: 0,
    },
  ],
  todayStats: {
    totalFocusSeconds: 0,
    sessionCount: 0,
    completedTasksCount: 0,
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IdlePanel quick task add", () => {
  it("optimistically adds task, clears input, and resolves real task on success", async () => {
    const onOptimisticTaskAdd = vi.fn();
    const onOptimisticTaskResolve = vi.fn();
    const onOptimisticTaskRevert = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    const realTask: Task = {
      id: "real-task-1",
      goalId: mockDashboard.selection!.goal.id,
      title: "整理顶部导航结构",
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

    let resolveAction!: (val: { ok: true; data: Task[] }) => void;
    vi.mocked(quickAddTaskAction).mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );

    render(
      createElement(IdlePanel, {
        dashboard: mockDashboard,
        busy: "none",
        onStart: vi.fn(),
        onRefresh,
        onError,
        onOptimisticTaskAdd,
        onOptimisticTaskResolve,
        onOptimisticTaskRevert,
      }),
    );

    const input = screen.getByPlaceholderText(
      "给「产品首页重构」添加任务",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "整理顶部导航结构" } });

    // Submit form (press Enter)
    fireEvent.submit(input.closest("form")!);

    // Input must be cleared immediately
    expect(input.value).toBe("");

    // Optimistic callback must be called immediately with a temp task
    expect(onOptimisticTaskAdd).toHaveBeenCalledTimes(1);
    const optimisticTask = onOptimisticTaskAdd.mock.calls[0][0] as Task;
    expect(optimisticTask.title).toBe("整理顶部导航结构");
    expect(optimisticTask.id.startsWith("temp-")).toBe(true);

    // Resolve server action
    resolveAction({ ok: true, data: [realTask] });

    await waitFor(() => {
      expect(onOptimisticTaskResolve).toHaveBeenCalledWith(
        optimisticTask.id,
        realTask,
      );
    });

    expect(onOptimisticTaskRevert).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(null);
    expect(onRefresh).toHaveBeenCalled();
  });

  it("reverts optimistic task and restores input text on failure", async () => {
    const onOptimisticTaskAdd = vi.fn();
    const onOptimisticTaskResolve = vi.fn();
    const onOptimisticTaskRevert = vi.fn();
    const onError = vi.fn();

    vi.mocked(quickAddTaskAction).mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "数据库超时" },
    });

    render(
      createElement(IdlePanel, {
        dashboard: mockDashboard,
        busy: "none",
        onStart: vi.fn(),
        onRefresh: vi.fn().mockResolvedValue(undefined),
        onError,
        onOptimisticTaskAdd,
        onOptimisticTaskResolve,
        onOptimisticTaskRevert,
      }),
    );

    const input = screen.getByPlaceholderText(
      "给「产品首页重构」添加任务",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "失败的任务" } });

    // Submit form
    fireEvent.submit(input.closest("form")!);

    // Input immediately clears
    expect(input.value).toBe("");
    expect(onOptimisticTaskAdd).toHaveBeenCalledTimes(1);
    const tempId = onOptimisticTaskAdd.mock.calls[0][0].id;

    await waitFor(() => {
      expect(onOptimisticTaskRevert).toHaveBeenCalledWith(
        tempId,
        mockDashboard.selection!.goal.id,
      );
      expect(onError).toHaveBeenCalledWith("数据库超时");
      // Restores input value
      expect(input.value).toBe("失败的任务");
    });

    expect(onOptimisticTaskResolve).not.toHaveBeenCalled();
  });

  it("optimistically switches selected task on click and syncs in background", async () => {
    const onOptimisticSelectTask = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    const existingTask: Task = {
      id: "task-item-1",
      goalId: mockDashboard.selection!.goal.id,
      title: "优化响应速度",
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

    const dashboardWithTask: DashboardData = {
      ...mockDashboard,
      todos: [existingTask],
    };

    render(
      createElement(IdlePanel, {
        dashboard: dashboardWithTask,
        busy: "none",
        onStart: vi.fn(),
        onRefresh,
        onError,
        onOptimisticSelectTask,
      }),
    );

    const taskButton = screen.getByRole("button", { name: /优化响应速度/ });
    fireEvent.click(taskButton);

    // Optimistic selection should trigger immediately with the clicked task
    expect(onOptimisticSelectTask).toHaveBeenCalledWith(
      mockDashboard.selection!.goal.id,
      existingTask,
    );

    await waitFor(() => {
      expect(selectionSetAction).toHaveBeenCalledWith({
        goalId: mockDashboard.selection!.goal.id,
        taskId: existingTask.id,
      });
      expect(onRefresh).toHaveBeenCalled();
    });
  });
});
