import { expect, test } from "@playwright/test";
import { createMcpAccessToken, loginAndSetup, mcpCall } from "./helpers";
import { addLocalDays, localDateKey, localDateStart } from "@/shared/timezone";

test("T09 calendar, goal filter, text edits, corrections, overlap confirmation and audit at desktop/375px", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await loginAndSetup(page);
  const token = await createMcpAccessToken(request);
  let id = 1;
  const call = async (name: string, args: object) => {
    const result = await mcpCall(request, token, id++, name, args);
    expect(result.result.structuredContent).toMatchObject({ ok: true });
    return result.result.structuredContent.data;
  };
  const goal = await call("goal_create", { title: "T09 写下每一段真实投入" });
  const tasks = await call("tasks_create", {
    goalId: goal.id,
    tasks: [{ title: "已经完成的事项" }],
  });
  // tasks_create returns an array, independent of the completion event.
  await call("task_complete", { id: tasks[0].id });
  const today = localDateKey(new Date(), "Asia/Shanghai");
  const yesterday = addLocalDays(today, -1);
  const midnight = localDateStart(today, "Asia/Shanghai");
  const earlierEnd = new Date(midnight.getTime() - 12 * 3600000).toISOString();
  const earlier = await call("session_log", {
    goalId: goal.id,
    durationSeconds: 600,
    endedAt: earlierEnd,
    note: "午间投入",
  });
  const cross = await call("session_log", {
    goalId: goal.id,
    taskId: tasks[0].id,
    startedAt: new Date(midnight.getTime() - 600000).toISOString(),
    endedAt: new Date(midnight.getTime() + 600000).toISOString(),
    durationSeconds: 1200,
    note: "跨日投入",
    resumeHint: "下次补完例子",
  });
  const snapshot = new Date().toISOString();
  const stats = await call("stats_get", {
    period: "all",
    goalId: goal.id,
    now: snapshot,
  });
  expect(stats).toMatchObject({
    totalFocusSeconds: 1800,
    sessionCount: 2,
    completedTaskCount: 1,
  });
  const dayList = await call("sessions_list", {
    dateMode: "focus",
    goalId: goal.id,
    from: midnight.toISOString(),
    to: localDateStart(addLocalDays(today, 1), "Asia/Shanghai").toISOString(),
    now: snapshot,
  });
  expect(dayList.items.map((s: { id: string }) => s.id)).toEqual([cross.id]);
  const otherGoal = await call("goal_create", { title: "其他目标" });
  await call("session_log", {
    goalId: otherGoal.id,
    durationSeconds: 300,
    endedAt: new Date(midnight.getTime() - 13 * 3600000).toISOString(),
  });
  await page.goto("/history");
  await expect(page.getByRole("region", { name: "投入摘要" })).toContainText(
    "35 分钟",
  );
  await page.locator("summary").filter({ hasText: "按目标查看" }).click();
  await page.getByLabel("目标", { exact: true }).click();
  await page
    .getByRole("option", { name: new RegExp(`^${goal.title}`) })
    .click();
  await page.getByRole("button", { name: "应用" }).click();
  await expect(
    page.getByRole("region", { name: "最近执行" }),
  ).not.toContainText("其他目标");
  await expect(
    page.getByRole("heading", { name: "时间留下的痕迹" }),
  ).toBeVisible();
  const summary = page.getByRole("region", { name: "投入摘要" });
  await expect(summary).toContainText("30 分钟");
  await expect(summary).toContainText("2 次");
  await page.addStyleTag({ content: "nextjs-portal {display:none}" });
  await page.screenshot({ path: ".test-data/t09-desktop.png", fullPage: true });

  // Keyboard activation opens the day. An earlier-started Session is present.
  const dateButton = page.getByRole("button", {
    name: new RegExp(`^${today}，`),
  });
  await dateButton.focus();
  await dateButton.press("Enter");
  const day = page.getByRole("dialog");
  await expect(day).toContainText("当天投入 10 分钟");
  await day.getByRole("button", { name: /已经完成的事项/ }).click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("跨日投入");
  await detail.getByRole("button", { name: "更正记录" }).click();
  await detail.getByLabel("笔记", { exact: true }).fill("只改文字，不改时间");
  await detail.getByRole("button", { name: "保存更正" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const textOnly = await call("session_get", { id: cross.id });
  expect(textOnly.timeBasis).toBe("manual");
  expect(textOnly.durationSeconds).toBe(1200);

  await page
    .getByRole("region", { name: "最近执行" })
    .getByRole("button", { name: /已经完成的事项/ })
    .click();
  await page.getByRole("button", { name: "更正记录" }).click();
  await page.getByLabel("有效时长（分钟）").fill("10");
  await page.getByRole("button", { name: "保存更正" }).click();
  await expect(summary).toContainText("20 分钟");
  const corrected = await call("session_get", { id: cross.id });
  expect(corrected).toMatchObject({
    timeBasis: "corrected",
    durationSeconds: 600,
  });
  expect(corrected.startedAt).toBe(cross.startedAt);
  expect(corrected.endedAt).toBe(cross.endedAt);

  await page
    .getByRole("region", { name: "最近执行" })
    .getByRole("button", { name: /已经完成的事项/ })
    .click();
  await page.getByRole("button", { name: "取消这段执行" }).click();
  await expect(page.getByRole("dialog")).toContainText("已完成的任务会保留");
  await page.getByRole("button", { name: "确认取消" }).click();
  await expect(summary).toContainText("10 分钟");
  const afterCancel = await call("stats_get", {
    period: "all",
    goalId: goal.id,
  });
  expect(afterCancel.completedTaskCount).toBe(1);

  // Same historical range requires confirmation; inputs remain available.
  await page.getByRole("button", { name: "补录一段" }).click();
  await page.getByRole("dialog").getByLabel("目标", { exact: true }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByLabel("目标", { exact: true }).click();
  await page
    .getByRole("option", { name: new RegExp(`^${goal.title}`) })
    .click();
  await page.getByLabel("任务（可选）").click();
  await page.getByRole("option", { name: /已经完成的事项/ }).click();
  await expect(page.getByLabel("任务（可选）")).toContainText("已经完成的事项");
  await page.getByLabel("任务（可选）").click();
  await page.getByRole("option", { name: "仅围绕目标", exact: true }).click();
  await page.getByLabel("有效时长（分钟）").fill("10");
  await page.getByLabel("结束于").fill(`${yesterday}T12:00`);
  await page.getByLabel("笔记", { exact: true }).fill("确认后的重叠补录");
  await page.getByRole("button", { name: "保存补录" }).click();
  await expect(page.getByRole("dialog")).toContainText("与已有记录时间冲突");
  await expect(page.getByRole("dialog")).toContainText("不会自动去重");
  await page.getByRole("button", { name: "仍然保存" }).click();
  await expect(summary).toContainText("20 分钟");
  await expect(
    page.getByRole("region", { name: "最近执行" }).locator("li"),
  ).toHaveCount(2);

  await page.locator("summary").filter({ hasText: "筛选目标" }).click();
  await page.getByLabel("含已取消").check();
  await page.getByRole("button", { name: "应用" }).click();
  await expect(
    page.getByRole("region", { name: "最近执行" }).locator("li"),
  ).toHaveCount(3);
  await expect(summary).toContainText("20 分钟");

  await page.setViewportSize({ width: 375, height: 812 });
  const monthSelect = page.getByLabel("日历月份");
  await expect(monthSelect).toBeVisible();
  await monthSelect.click();
  const firstMonth = await page.getByRole("option").first().innerText();
  await page.getByRole("option").first().click();
  await expect(monthSelect).toContainText(firstMonth);
  await monthSelect.click();
  await page
    .getByRole("option", { name: today.slice(0, 7), exact: true })
    .click();
  await expect(monthSelect).toContainText(today.slice(0, 7));
  await expect(
    page.getByRole("button", { name: new RegExp(`^${today}，`) }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".test-data/t09-mobile.png", fullPage: true });
  await page.getByRole("button", { name: new RegExp(`^${today}，`) }).click();
  await expect(page.getByRole("dialog")).toContainText("这一天还没有有效投入");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page
    .getByRole("region", { name: "最近执行" })
    .getByRole("button", { name: /午间投入/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("10 分钟");
  await page.screenshot({
    path: ".test-data/t09-mobile-detail.png",
    fullPage: false,
  });
  const endStats = await call("stats_get", { period: "all", goalId: goal.id });
  expect(endStats).toMatchObject({
    totalFocusSeconds: 1200,
    sessionCount: 2,
    completedTaskCount: 1,
  });
  expect(earlier.id).toBeTruthy();
});
