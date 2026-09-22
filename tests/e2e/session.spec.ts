import { expect, test, type Page } from "@playwright/test";

const webPassword = "correct-horse-battery-staple";

async function loginAndSetup(page: Page) {
  await page.goto("/login");
  await page.getByLabel("实例密码").fill(webPassword);
  await page.getByRole("button", { name: "进入 Time OS" }).click();
  await page.waitForURL(/\/(setup|today)$/);
  if (page.url().endsWith("/setup")) {
    await page.getByLabel("Timezone").fill("Asia/Shanghai");
    await page.getByRole("button", { name: "完成 Setup" }).click();
    await page.waitForURL(/\/today$/);
  }
}

async function ensureNoActiveSession(page: Page) {
  await page.goto("/today");
  const returnToFocusBtn = page.getByRole("link", {
    name: "返回正在进行的专注",
  });
  if (
    (await returnToFocusBtn.count()) > 0 &&
    (await returnToFocusBtn.first().isVisible())
  ) {
    await returnToFocusBtn.first().click();
    await page.waitForURL(/\/focus\/[0-9a-f-]+/);
    await page.getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "确定取消" }).click();
    await page.waitForURL(/\/today$/);
  }
}

test.describe("Focus execution loop", () => {
  test("full focus execution loop: start, pause, note autosave, distraction, and atomic finish review", async ({
    page,
  }) => {
    await loginAndSetup(page);
    await ensureNoActiveSession(page);

    // 1. Create a Goal and Track with two tasks
    await page.goto("/goals");
    await page
      .getByPlaceholder("例如：发布 Time OS MVP")
      .fill("Ship Focus Loop");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.getByText("Ship Focus Loop").first()).toBeVisible();

    const goalCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Ship Focus Loop" })
      .first();
    await goalCard.getByPlaceholder("新 Track").fill("Track Execution");
    await goalCard.getByRole("button", { name: "添加 Track" }).click();
    await page.getByRole("link", { name: "Track Execution" }).first().click();
    await page.waitForURL(/\/tracks\/.+/);
    const trackId = page.url().split("/").pop()!;

    await page.getByPlaceholder(/每行一个 Task/).fill("Task Alpha\nTask Beta");
    await page.getByRole("button", { name: "按行创建" }).click();
    await expect(page.getByText("Task Alpha").first()).toBeVisible();

    // 2. Open Today for this track
    await page.goto(`/today?trackId=${trackId}`);
    await expect(
      page.getByRole("heading", { name: "Task Alpha" }),
    ).toBeVisible();

    // Start Focus CTA
    const startButton = page.getByRole("button", {
      name: /开始专注/,
    });
    await expect(startButton).toBeVisible();
    await startButton.click();

    // Navigates to /focus/:id
    await page.waitForURL(/\/focus\/[0-9a-f-]+/);
    await expect(page.getByText("Track Execution").first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Task Alpha" }),
    ).toBeVisible();

    // 3. Pause & Resume
    const pauseButton = page.getByRole("button", { name: /暂停/ });
    await expect(pauseButton).toBeVisible();
    await pauseButton.click();
    await expect(page.getByRole("button", { name: /继续/ })).toBeVisible();

    await page.getByRole("button", { name: /继续/ }).click();
    await expect(page.getByRole("button", { name: /暂停/ })).toBeVisible();

    // 4. Quick Note autosave & reload recovery
    const noteArea = page.getByPlaceholder(/记录灵感/);
    await noteArea.fill("Important thoughts during focus");
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await expect(noteArea).toHaveValue("Important thoughts during focus");

    // 5. Distractions
    const distractionInput = page.getByPlaceholder(/记录打断/);
    await distractionInput.fill("Urgent phone call");
    await page.getByRole("button", { name: "记录" }).click();
    await expect(page.getByText("Urgent phone call")).toBeVisible();

    // 6. Finish Review Modal
    await page.getByRole("button", { name: /完成/ }).click();
    await expect(page.getByRole("heading", { name: /专注回顾/ })).toBeVisible();

    // Radio for Completed
    const completedRadio = page.getByRole("radio", { name: /标记已完成/ });
    await expect(completedRadio).toBeChecked();

    // Submit review
    await page.getByRole("button", { name: "确认完成" }).click();

    // 7. Verify redirection and advancement
    await page.waitForURL(/\/today$/);
    await page.goto(`/today?trackId=${trackId}`);
    // Task Alpha is finished, Current Next should now be Task Beta!
    await expect(
      page.getByRole("heading", { name: "Task Beta" }),
    ).toBeVisible();
    await expect(page.getByText("今日已投入")).toBeVisible();
  });

  test("cancelling a focus session allows immediately starting a new session", async ({
    page,
  }) => {
    await loginAndSetup(page);
    await ensureNoActiveSession(page);

    await page.goto("/today");
    const startButton = page
      .getByRole("button", {
        name: /开始专注|直接开始/,
      })
      .first();
    await startButton.click();

    await page.waitForURL(/\/focus\/[0-9a-f-]+/);

    // Click Cancel
    await page.getByRole("button", { name: "取消" }).click();
    await expect(
      page.getByRole("heading", { name: "确定取消本次专注吗？" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "确定取消" }).click();
    await page.waitForURL(/\/today$/);

    // Verify we can start again without ACTIVE_SESSION_EXISTS
    const startAgainButton = page
      .getByRole("button", {
        name: /开始专注|直接开始/,
      })
      .first();
    await expect(startAgainButton).toBeVisible();
    await startAgainButton.click();
    await page.waitForURL(/\/focus\/[0-9a-f-]+/);

    // Clean up
    await page.getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "确定取消" }).click();
    await page.waitForURL(/\/today$/);
  });

  test("mobile 375px viewport and global active banner", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAndSetup(page);
    await ensureNoActiveSession(page);

    await page.goto("/today");
    const startButton = page
      .getByRole("button", {
        name: /开始专注|直接开始/,
      })
      .first();
    await startButton.click();
    await page.waitForURL(/\/focus\/[0-9a-f-]+/);

    // Navigate to /goals while session is active
    await page.goto("/goals");

    // Global active banner should be visible
    const banner = page.getByRole("region", {
      name: "Active focus session banner",
    });
    await expect(banner).toBeVisible();
    await expect(banner.getByText("Return to focus")).toBeVisible();

    // Click Return to focus
    await banner.getByText("Return to focus").click();
    await page.waitForURL(/\/focus\/[0-9a-f-]+/);

    // Clean up
    await page.getByRole("button", { name: "取消" }).click();
    await page.getByRole("button", { name: "确定取消" }).click();
    await page.waitForURL(/\/today$/);
  });
});
