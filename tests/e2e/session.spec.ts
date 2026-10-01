import { expect, test, type Page } from "@playwright/test";

import { loginAndSetup } from "./helpers";

/** Make sure no unfinished Session blocks the next test (PRD §6.1). */
async function ensureNoActiveSession(page: Page) {
  await page.goto("/today");
  const sessionControl = page.getByRole("button", {
    name: /暂停（Space）|继续（Space）/,
  });
  if (
    (await sessionControl.count()) > 0 &&
    (await sessionControl.isVisible())
  ) {
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "确定取消" }).click();
  }
  // The page is ready when either the idle panel or the no-goal empty
  // state is up (fresh runs have no goals yet).
  await expect(
    page.getByRole("button", { name: /开始专注|创建目标/ }).first(),
  ).toBeVisible({ timeout: 10_000 });
}

async function createGoalWithTasks(page: Page, title: string, tasks: string[]) {
  await page.goto("/goals");
  await page.getByText("新建目标", { exact: true }).click();
  await page.getByLabel("目标名称").fill(title);
  await page.getByRole("button", { name: "创建目标" }).click();
  await expect(page.getByText(title)).toBeVisible();
  const goalCard = page
    .locator('[data-goal-status="active"]')
    .filter({ hasText: title });
  await goalCard.getByLabel(/快速添加任务/).fill(tasks.join("\n"));
  await goalCard.getByRole("button", { name: "添加", exact: true }).click();
  for (const task of tasks) {
    await expect(page.getByText(task)).toBeVisible();
  }
}

test.describe("Goal-direct execution loop", () => {
  test("goal → task → start → refresh → pause/resume → finish → optional complete → next visit continues", async ({
    page,
  }) => {
    await loginAndSetup(page);
    await ensureNoActiveSession(page);

    // 1. Create the Goal and its Tasks through the management entry.
    await createGoalWithTasks(page, "Ship Execution Loop", [
      "Write the first draft",
      "Review the second half",
    ]);

    // 2. Select the goal on the execution home; the first pending Task
    //    auto-resolves (PRD §5.2).
    await page.goto("/today");
    await page.getByLabel("目标", { exact: true }).click();
    await page.getByRole("option", { name: "Ship Execution Loop" }).click();
    await expect(
      page.getByRole("heading", { name: "Write the first draft" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "目标任务" })).toBeVisible();

    // Session-only context is deliberately secondary and explicitly separate
    // from the persistent Task list below it.
    await expect(page.getByLabel("本次说明")).toHaveCount(0);
    await page.getByRole("button", { name: "添加本次说明" }).click();
    await page.getByLabel("本次说明").fill("Only for this focus session");

    // 3. One click starts; the big timer appears with the paused-capable
    //    primary action.
    await page.getByRole("button", { name: /开始专注/ }).click();
    const timer = page.getByRole("timer", { name: "已专注时间" });
    await expect(timer).toBeVisible();
    await expect(page.getByText("正计时中")).toBeVisible();

    // 4. Refresh: the server keeps the Session running (never localStorage).
    await page.reload();
    await expect(timer).toBeVisible();
    await expect(page.getByText("正计时中")).toBeVisible();

    // 5. Pause / resume.
    await page.getByRole("button", { name: /暂停（Space）/ }).click();
    await expect(page.getByText("已暂停")).toBeVisible();
    await page.getByRole("button", { name: /继续（Space）/ }).click();
    await expect(page.getByText("正计时中")).toBeVisible();

    // 6. Note autosave survives a reload.
    const capture = page.getByLabel("快速记录");
    await capture.fill("Important thoughts during focus");
    await page.getByRole("button", { name: "记下", exact: true }).click();
    await expect(page.getByText("想法已保存")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "随手记", exact: true }).click();
    const noteArea = page.getByLabel("本次随手记");
    await expect(noteArea).toHaveValue("Important thoughts during focus");
    await expect(page.getByText("正计时中")).toBeVisible();

    // 7. Distraction quick log.
    await page.getByRole("button", { name: "打断", exact: true }).click();
    await capture.fill("Urgent phone call");
    await page.getByRole("button", { name: "记下", exact: true }).click();
    await expect(page.getByText("Urgent phone call")).toBeVisible();

    // 8. Finish saves directly — no review form (PRD §6.5).
    await page.getByRole("button", { name: /结束并保存（F）/ }).click();
    await expect(page.getByText("专注已保存")).toBeVisible();

    // 9. Optional completion + resume hint are independent actions.
    await page.getByRole("button", { name: "标记任务完成" }).click();
    await expect(
      page.getByRole("button", { name: "任务已完成" }),
    ).toBeVisible();
    await page.getByLabel("下次继续的第一步").fill("下次先补第二段例子");

    // 10. Back to idle: completing the selected Task advanced the
    //     selection to the next pending one, atomically (PRD §5.2).
    await page.getByRole("button", { name: "保存起点并返回" }).click();
    await expect(page.getByRole("button", { name: /开始专注/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Review the second half" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Review the second half" }),
    ).toBeVisible();
  });

  test("goal-only execution, keyboard shortcuts, and the hint continuing on the next visit", async ({
    page,
  }) => {
    await loginAndSetup(page);
    await ensureNoActiveSession(page);

    // Switch to explicit goal-only execution.
    await page.goto("/today");
    await page.getByLabel("任务", { exact: true }).click();
    await page.getByRole("option", { name: /不设任务|仅围绕目标执行/ }).click();
    await expect(
      page.getByRole("heading", { name: /围绕目标执行|Ship Execution Loop/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: /开始专注/ }).click();
    await expect(
      page.getByRole("heading", { name: "围绕目标执行" }),
    ).toBeVisible();

    // Space pauses without focusing any input first.
    await page.keyboard.press("Space");
    await expect(page.getByText("已暂停")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /继续（Space）/ }),
    ).toBeEnabled();
    await page.keyboard.press("Space");
    await expect(page.getByText("正计时中")).toBeVisible();

    // 让时长真实超过 1 秒：零有效时长不计有效执行，也带不回接续提示。
    await page.waitForTimeout(1100);

    // Finish; the end card has no Task section for a goal-only run.
    await page.getByRole("button", { name: /结束并保存（F）/ }).click();
    await expect(page.getByText("专注已保存")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "标记任务完成" }),
    ).toHaveCount(0);

    // The hint continues on the next visit (PRD §1 核心验收).
    await page.getByLabel("下次继续的第一步").fill("周三先跑五公里");
    await page.getByRole("button", { name: "保存起点并返回" }).click();
    await expect(page.getByText("周三先跑五公里")).toBeVisible();
    await page.reload();
    await expect(page.getByText("周三先跑五公里")).toBeVisible();

    // One click starts the next Session; a mis-start cancels cleanly.
    await page.getByRole("button", { name: /开始专注/ }).click();
    await expect(
      page.getByRole("heading", { name: "围绕目标执行" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "确定取消" }).click();
    await expect(page.getByRole("button", { name: /开始专注/ })).toBeVisible();
  });

  test("a running Session shows the compact banner on other pages", async ({
    page,
  }) => {
    await loginAndSetup(page);
    await ensureNoActiveSession(page);

    await page.goto("/today");
    await page.getByRole("button", { name: /开始专注/ }).click();
    await expect(page.getByRole("timer", { name: "已专注时间" })).toBeVisible();

    // Other pages show the compact banner, never a second timer.
    await page.goto("/history");
    const banner = page.getByRole("region", {
      name: "进行中的专注提示条",
    });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: /回到今天/ }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("timer", { name: "已专注时间" })).toBeVisible();

    // Clean up for the next test.
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "确定取消" }).click();
    await expect(page.getByRole("button", { name: /开始专注/ })).toBeVisible();
  });

  test("full operation works at 375px and the primary action stays reachable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAndSetup(page);
    await ensureNoActiveSession(page);

    await page.goto("/today");
    await page.getByRole("button", { name: /开始专注/ }).click();
    const timer = page.getByRole("timer", { name: "已专注时间" });
    await expect(timer).toBeVisible();

    // The pause button sits inside the viewport, above the bottom nav.
    const pause = page.getByRole("button", { name: /暂停（Space）/ });
    await expect(pause).toBeVisible();
    const pauseBox = await pause.boundingBox();
    const nav = page.getByRole("navigation", { name: "主导航" });
    const navBox = await nav.boundingBox();
    expect(pauseBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(pauseBox!.y + pauseBox!.height).toBeLessThan(navBox!.y);

    await pause.click();
    await expect(page.getByText("已暂停")).toBeVisible();
    await page.getByRole("button", { name: /继续（Space）/ }).click();

    await page.getByRole("button", { name: /结束并保存（F）/ }).click();
    await expect(page.getByText("专注已保存")).toBeVisible();
    await page.getByRole("button", { name: "回到今天" }).click();
    await expect(page.getByRole("button", { name: /开始专注/ })).toBeVisible();
  });
});
