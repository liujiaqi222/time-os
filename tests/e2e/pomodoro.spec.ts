import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { loginAndSetup, createMcpAccessToken, mcpCall } from "./helpers";
import { mkdir } from "node:fs/promises";

const pool = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  max: 2,
});
test.afterAll(() => pool.end());

// Only persisted deadline fixtures in the isolated test schema; no test clock API in production.
async function expireCurrent() {
  if (!/^timeos_test_[a-f0-9]{32}$/.test(process.env.TIMEOS_TEST_SCHEMA ?? ""))
    throw new Error("Deadline fixtures require an isolated schema.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update session_phases p set started_at = now() - interval '25 minutes', deadline_at = now() - interval '1 second' from sessions s where s.id = p.session_id and s.status = 'active' and p.ended_at is null and p.paused_at is null`,
    );
    await client.query(
      `update focus_intervals fi set started_at = p.started_at, deadline_at = p.deadline_at from session_phases p where p.id = fi.phase_id and fi.ended_at is null`,
    );
    await client.query("commit");
  } finally {
    client.release();
  }
}
async function evidence(page: Page, state: string) {
  await mkdir("test-results/t08-evidence", { recursive: true });
  await page.screenshot({
    path: `test-results/t08-evidence/${state}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("pomodoro defaults, pause, due, fourth long break, MCP takeover and 375px drawer", async ({
  page,
  request,
  context,
}) => {
  await loginAndSetup(page);
  await pool.query(
    "update sessions set status = 'cancelled', ended_at = now() where status in ('active', 'paused')",
  );
  await page.reload();
  await page.getByRole("button", { name: "番茄钟", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "番茄钟", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "计时设置", exact: true }).click();
  await page.getByLabel("专注分钟", { exact: true }).fill("25");
  await page.getByLabel("短休息分钟", { exact: true }).fill("5");
  await page.getByLabel("长休息分钟", { exact: true }).fill("15");
  await page.getByRole("checkbox", { name: "每四段专注后提供长休息" }).check();
  await page.getByRole("checkbox", { name: "到时提示音" }).uncheck();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /开始第一次执行|开始专注/ }).click();
  await expect(page.getByRole("timer", { name: "本段剩余时间" })).toBeVisible();
  await evidence(page, "desktop-running");
  await page
    .getByRole("button", { name: "暂停（Space）", exact: true })
    .click();
  await expect(page.getByText("专注已暂停", { exact: true })).toBeVisible();
  await evidence(page, "desktop-paused");
  await page.reload();
  await expect(page.getByText("专注已暂停", { exact: true })).toBeVisible();
  const token = await createMcpAccessToken(request);
  const active = await mcpCall(request, token, 101, "session_get_active", {});
  const id = active.result.structuredContent.data.id;
  await mcpCall(request, token, 102, "session_resume", { id });
  await expect(page.getByText("专注中", { exact: true })).toBeVisible();
  // Close a second tab before expiry, then return after the server deadline.
  const second = await context.newPage();
  await second.goto("/today");
  await second.close();
  await expireCurrent();
  await page.reload();
  await expect(page.getByText("专注已到时", { exact: true })).toBeVisible();
  await evidence(page, "desktop-due");
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "开始休息", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始休息", exact: true }).click();
  await expect(page.getByText("短休息中", { exact: true })).toBeVisible();
  await evidence(page, "desktop-break");
  for (let round = 2; round <= 4; round++) {
    await page
      .getByRole("button", { name: "提前开始下一轮", exact: true })
      .click();
    await expect(page.getByText("专注中", { exact: true })).toBeVisible();
    await expireCurrent();
    await page.reload();
    await expect(page.getByText("专注已到时", { exact: true })).toBeVisible();
    await page
      .getByRole("button", {
        name: round === 4 ? "开始长休息" : "开始休息",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(round === 4 ? "长休息中" : "短休息中", { exact: true }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 667 });
  await evidence(page, "mobile-break");
  await page
    .getByRole("button", { name: "暂停（Space）", exact: true })
    .click();
  await expect(page.getByText("长休息已暂停", { exact: true })).toBeVisible();
  await evidence(page, "mobile-paused");
  await page.getByRole("button", { name: "计时设置", exact: true }).click();
  await expect(page.getByText(/时长与长休息修改下次执行生效/)).toBeVisible();
  await page.getByLabel("专注分钟", { exact: true }).fill("50");
  await evidence(page, "mobile-drawer");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "提前开始下一轮", exact: true })
    .click();
  await expect(page.getByRole("timer")).toContainText(/24:|25:00/);
  await evidence(page, "mobile-running");
  await expireCurrent();
  await page.reload();
  await expect(page.getByText("专注已到时", { exact: true })).toBeVisible();
  await evidence(page, "mobile-due");
  await page
    .getByRole("button", { name: "结束并保存（F）", exact: true })
    .click();
  await expect(page.getByText("专注已保存", { exact: true })).toBeVisible();
  const finished = await mcpCall(request, token, 103, "session_get", { id });
  expect(finished.result.structuredContent.data.status).toBe("completed");
  expect(finished.result.structuredContent.data.completedFocusCount).toBe(5);
  expect(finished.result.structuredContent.data.phases).toHaveLength(9);
});
