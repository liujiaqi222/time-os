import { expect, test } from "@playwright/test";

import { createMcpAccessToken, loginAndSetup, mcpCall } from "./helpers";

test.describe("Basic goal and task management", () => {
  test("create a goal, quick-add tasks, and work their lifecycle", async ({
    page,
  }) => {
    await loginAndSetup(page);
    await page.goto("/goals");

    await page.getByText("新建目标", { exact: true }).click();
    await page.getByLabel("目标名称").fill("Ship planning flow");
    await page.getByLabel("为什么值得推进").fill("Better daily execution");
    await page.getByRole("button", { name: "创建目标" }).click();
    await expect(page.getByText("Ship planning flow")).toBeVisible();

    // Quick-add two tasks in one submission.
    const goalCard = page
      .locator('[data-goal-status="active"]')
      .filter({ hasText: "Ship planning flow" });
    await goalCard.getByLabel(/快速添加任务/).fill("First task\nSecond task");
    await goalCard.getByRole("button", { name: "添加", exact: true }).click();
    await expect(page.getByText("First task")).toBeVisible();
    await expect(page.getByText("Second task")).toBeVisible();

    // Complete, skip, and reopen across the two tasks.
    const firstRow = page
      .locator("li")
      .filter({ hasText: "First task" })
      .first();
    await firstRow.getByRole("button", { name: "完成" }).click();
    await expect(firstRow.getByText("已完成")).toBeVisible();
    await firstRow.getByRole("button", { name: "重新打开" }).click();
    await expect(firstRow.getByText("待办")).toBeVisible();

    const secondRow = page
      .locator("li")
      .filter({ hasText: "Second task" })
      .first();
    await secondRow.getByRole("button", { name: "跳过" }).click();
    await expect(secondRow.getByText("已跳过")).toBeVisible();

    // Goal lifecycle: archive (the card leaves the default view) and
    // reactivate from the full view.
    await goalCard.getByRole("button", { name: "归档" }).click();
    await page.getByRole("button", { name: "查看已完成与已归档" }).click();
    const archivedCard = page
      .locator('[data-goal-status="archived"]')
      .filter({ hasText: "Ship planning flow" });
    await expect(archivedCard).toBeVisible();
    await archivedCard.getByRole("button", { name: "重新启用" }).click();
    await expect(
      page
        .locator('[data-goal-status="active"]')
        .filter({ hasText: "Ship planning flow" }),
    ).toBeVisible();
  });

  test("MCP mirrors the same domain through structured tools", async ({
    request,
  }) => {
    const token = await createMcpAccessToken(request);
    const call = async (id: number, name: string, args: object) => {
      const parsed = await mcpCall(request, token, id, name, args);
      return parsed.result.structuredContent as {
        ok: boolean;
        data?: Record<string, unknown>;
        error?: { code: string };
      };
    };

    await call(1, "goal_create", {
      title: "MCP Planning Goal",
      idempotencyKey: "e2e-goal-1",
    });
    const replay = await call(2, "goal_create", {
      title: "MCP Planning Goal",
      idempotencyKey: "e2e-goal-1",
    });
    expect(replay.ok).toBe(true);

    const goals = await call(3, "goals_list", {});
    expect(goals.ok).toBe(true);
    const created = (goals.data as { items: { title: string }[] }).items.find(
      (goal) => goal.title === "MCP Planning Goal",
    );
    expect(created).toBeDefined();

    const goalId = (
      goals.data as { items: { id: string; title: string }[] }
    ).items.find((goal) => goal.title === "MCP Planning Goal")!.id;
    const tasks = await call(4, "tasks_create", {
      goalId,
      tasks: [{ title: "MCP Task One" }, { title: "MCP Task Two" }],
    });
    expect(tasks.ok).toBe(true);

    const selection = await call(5, "selection_set", {
      goalId,
    });
    expect(selection.ok).toBe(true);

    // Goal-level state guards still apply through MCP.
    const invalidTask = await call(6, "selection_set", {
      goalId,
      taskId: "00000000-0000-4000-8000-000000000000",
    });
    expect(invalidTask.ok).toBe(false);
    expect(invalidTask.error?.code).toBe("TASK_NOT_FOUND");
  });
});
