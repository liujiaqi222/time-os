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
  await page.getByLabel("Timezone").fill("Asia/Shanghai");
  await page.getByRole("button", { name: "完成 Setup" }).click();
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
  await page
    .getByPlaceholder("例如：发布 Time OS MVP")
    .fill("Ship planning flow");
  await page.getByRole("button", { name: "创建", exact: true }).click();

  await page.getByPlaceholder("新 Track").fill("Core workflow");
  await page.getByRole("button", { name: "添加 Track" }).click();
  await page.getByRole("link", { name: "Core workflow" }).click();

  await page
    .getByPlaceholder(/每行一个 Task/)
    .fill("First task\nSecond task\nThird task");
  await page.getByRole("button", { name: "按行创建" }).click();
  await expect(page.getByText("First task").first()).toBeVisible();
  await expect(page.getByText("这是这条推进线唯一明确的下一步")).toBeVisible();

  const reorder = page.getByRole("region", {
    name: "拖动调整 Task 顺序（Current Next 不会变化）",
  });
  await reorder
    .getByRole("button", { name: "Third task", exact: true })
    .dragTo(reorder.getByRole("button", { name: "First task", exact: true }));
  await expect(page.getByText("First task").first()).toBeVisible();

  const firstCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "First task" })
    .last();
  await firstCard.getByRole("button", { name: "Complete" }).click();
  await expect(
    page.getByRole("heading", { name: "Second task" }),
  ).toBeVisible();
  await firstCard.getByRole("button", { name: "Reopen" }).click();
  await expect(
    page.getByRole("heading", { name: "Second task" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    page.getByRole("heading", { name: "Core workflow" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set as Next" }).first(),
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
