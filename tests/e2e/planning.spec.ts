import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const webPassword = "correct-horse-battery-staple";
const mcpToken = "mcp-token-that-is-at-least-32-characters";

async function loginAndSetup(page: Page) {
  await page.goto("/login");
  await page.getByLabel("实例密码").fill(webPassword);
  await page.getByRole("button", { name: "进入 Time OS" }).click();
  await page.waitForURL(/\/(setup|today)$/);
  await page.goto("/setup");
  await page.getByLabel("时区").fill("Asia/Shanghai");
  await page.getByRole("button", { name: "完成设置" }).click();
  await page.waitForURL(/\/today$/);
}

async function mcpCall(
  request: APIRequestContext,
  id: number,
  name: string,
  args: object,
) {
  const response = await request.post("/mcp", {
    data: {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    },
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${mcpToken}`,
      "mcp-protocol-version": "2025-11-25",
    },
  });
  expect(response.status()).toBe(200);
  const text = await response.text();
  const raw = response.headers()["content-type"]?.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .at(-1)
        ?.slice(6)
    : text;
  return JSON.parse(raw ?? "null").result.structuredContent;
}

test("Web maintains a plan and Current Next across reorder, completion, and reopen", async ({
  page,
}) => {
  await loginAndSetup(page);
  await page.goto("/goals");
  await page.getByText("新建目标", { exact: true }).click();
  await page
    .getByPlaceholder("例如：发布 Time OS MVP")
    .fill("Ship planning flow");
  await page.getByRole("button", { name: "创建目标" }).click();

  const goalCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Ship planning flow" })
    .first();
  await goalCard.getByText("＋ 添加推进线", { exact: true }).click();
  await goalCard.getByLabel("推进线名称").fill("Core workflow");
  await goalCard.getByRole("button", { name: "创建推进线" }).click();
  await page.getByRole("link", { name: "Core workflow" }).click();

  await page.getByText("批量粘贴", { exact: true }).click();
  await page
    .getByPlaceholder(/每行一个任务/)
    .fill("First task\nSecond task\nThird task");
  await page.getByRole("button", { name: "按行创建" }).click();
  await expect(page.getByText("First task").first()).toBeVisible();
  await expect(
    page.getByText("这是这条推进线现在唯一需要关注的下一步。"),
  ).toBeVisible();

  const reorder = page.getByRole("region", {
    name: "调整任务顺序（不会改变下一步）",
  });
  await reorder
    .getByRole("button", { name: "Third task", exact: true })
    .dragTo(reorder.getByRole("button", { name: "First task", exact: true }));
  await expect(page.getByText("First task").first()).toBeVisible();

  const firstCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "First task" })
    .last();
  await firstCard.getByRole("button", { name: "完成" }).click();
  await expect(
    page.getByRole("heading", { name: "Second task" }),
  ).toBeVisible();
  await expect(firstCard.getByText("编辑任务", { exact: true })).toHaveCount(0);
  await firstCard.getByRole("button", { name: "重新打开" }).click();
  await expect(firstCard.getByText("编辑任务", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Second task" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    page.getByRole("heading", { name: "Core workflow" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "设为下一步" }).first(),
  ).toBeVisible();
});

test("MCP creates a complete plan that appears in Web immediately", async ({
  page,
  request,
}) => {
  const goal = await mcpCall(request, 20, "goal_create", { title: "MCP Goal" });
  expect(goal.ok).toBe(true);
  const track = await mcpCall(request, 21, "track_create", {
    goalId: goal.data.id,
    title: "MCP Track",
  });
  const created = await mcpCall(request, 22, "tasks_create", {
    trackId: track.data.id,
    tasks: [{ title: "MCP planned task" }, { title: "MCP follow-up" }],
    idempotencyKey: "planning-e2e-mcp-batch",
  });
  expect(created.ok).toBe(true);
  expect(created.data).toHaveLength(2);
  expect(created.data[0]).toMatchObject({ title: "MCP planned task" });

  await loginAndSetup(page);
  await page.goto(`/tracks/${track.data.id}`);
  await expect(page.getByRole("heading", { name: "MCP Track" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "MCP planned task" }),
  ).toBeVisible();
});

test("completing a Goal with an active Session stays in an actionable dialog", async ({
  page,
  request,
}) => {
  const goal = await mcpCall(request, 30, "goal_create", {
    title: "Protected active Goal",
  });
  const track = await mcpCall(request, 31, "track_create", {
    goalId: goal.data.id,
    title: "Running Track",
  });
  const tasks = await mcpCall(request, 32, "tasks_create", {
    trackId: track.data.id,
    tasks: [{ title: "Running Task" }],
    idempotencyKey: "planning-active-session-tasks",
  });
  const session = await mcpCall(request, 33, "session_start", {
    trackId: track.data.id,
    taskId: tasks.data[0].id,
    plannedMinutes: 25,
    idempotencyKey: "planning-active-session",
  });

  await loginAndSetup(page);
  await page.goto("/goals");
  const goalCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Protected active Goal" })
    .first();
  await goalCard.getByRole("button", { name: "完成" }).click();

  await expect(
    page.getByRole("heading", { name: "暂时无法完成目标" }),
  ).toBeVisible();
  await expect(page.getByText(/还有一段进行中的专注/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "返回当前专注" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/goals$/);

  await mcpCall(request, 34, "session_cancel", { id: session.data.id });
});
