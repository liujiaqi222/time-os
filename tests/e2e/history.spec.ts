import { expect, test } from "@playwright/test";

import { createMcpAccessToken, loginAndSetup, mcpCall } from "./helpers";

test("manual history records, filters, and the cancelled audit view", async ({
  page,
}) => {
  await loginAndSetup(page);

  // Prepare a goal through the management page.
  await page.goto("/goals");
  await page.getByText("新建目标", { exact: true }).click();
  await page.getByLabel("目标名称").fill("History E2E Goal");
  await page.getByRole("button", { name: "创建目标" }).click();
  await expect(page.getByText("History E2E Goal")).toBeVisible();

  await page.goto("/history");
  const addSession = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "补录一段" }) });
  await addSession
    .getByLabel("目标")
    .selectOption({ label: "History E2E Goal (进行中)" });
  await addSession.getByLabel("时长（分钟）").fill("30");
  await addSession.getByLabel("结束于").fill("2020-01-02T10:00");
  await addSession.getByLabel("笔记").fill("First historical record");
  await addSession.getByRole("button", { name: "补录一段" }).click();

  const rows = page
    .locator("li.rounded-xl")
    .filter({ hasText: "History E2E Goal" });
  await expect(rows).toHaveCount(1);

  await addSession.getByLabel("笔记").fill("Overlapping historical record");
  await addSession.getByRole("button", { name: "补录一段" }).click();
  await expect(addSession.getByText(/时间冲突/)).toBeVisible();
  await addSession.getByRole("button", { name: "仍然保存" }).click();
  await expect(rows).toHaveCount(2);

  // Cancel the second record; it leaves the default view but stays in
  // the audit view.
  await rows.nth(1).click();
  await page.getByRole("button", { name: "取消这段专注" }).first().click();
  await page.getByRole("button", { name: "确认取消" }).click();
  await expect(rows).toHaveCount(1);

  await page.getByLabel("含已取消").check();
  await page.getByRole("button", { name: "应用" }).click();
  await expect(
    page.locator("li.rounded-xl").filter({ hasText: "History E2E Goal" }),
  ).toHaveCount(2);

  // The goal filter narrows the list to that goal's records.
  await page
    .locator("form")
    .getByLabel("目标")
    .selectOption({ label: "History E2E Goal (进行中)" });
  await expect(
    page.locator("li.rounded-xl").filter({ hasText: "History E2E Goal" }),
  ).toHaveCount(2);
});

test("stats_get and sessions_list read the goal-direct model over MCP", async ({
  request,
}) => {
  const token = await createMcpAccessToken(request);
  const callTool = (id: number, name: string, args: Record<string, unknown>) =>
    mcpCall(request, token, id, name, args);
  const created = await callTool(1, "goal_create", {
    title: "MCP History Goal",
  });
  expect(created.result.structuredContent).toMatchObject({ ok: true });
  const goalId = (created.result.structuredContent as { data: { id: string } })
    .data.id;

  const logged = await callTool(2, "session_log", {
    goalId,
    durationSeconds: 1800,
    endedAt: "2020-01-03T10:00:00.000Z",
    note: "MCP manual log",
  });
  expect(logged.result.structuredContent).toMatchObject({ ok: true });

  const listed = await callTool(3, "sessions_list", {
    from: "2020-01-01T00:00:00.000Z",
    to: "2020-01-31T00:00:00.000Z",
  });
  const items = (
    listed.result.structuredContent as {
      data: { items: { goalId: string; timeBasis: string }[] };
    }
  ).data.items;
  expect(
    items.some((item) => item.goalId === goalId && item.timeBasis === "manual"),
  ).toBe(true);

  const stats = await callTool(4, "stats_get", {
    period: "custom",
    from: "2020-01-01T00:00:00.000Z",
    to: "2020-01-31T00:00:00.000Z",
  });
  const statsData = (
    stats.result.structuredContent as {
      data: { byGoal: { goalId: string; focusSeconds: number }[] };
    }
  ).data;
  expect(
    statsData.byGoal.find((goal) => goal.goalId === goalId)?.focusSeconds,
  ).toBe(1800);
});
