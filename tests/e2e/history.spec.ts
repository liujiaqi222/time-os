import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const webPassword = "correct-horse-battery-staple";
const mcpToken = "mcp-token-that-is-at-least-32-characters";

async function readMcpResponse(response: {
  headers(): Record<string, string>;
  text(): Promise<string>;
}) {
  const text = await response.text();
  if (!response.headers()["content-type"]?.includes("text/event-stream"))
    return JSON.parse(text);
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6));
  return JSON.parse(data.at(-1) ?? "null");
}

async function callTool(
  request: APIRequestContext,
  id: number,
  name: string,
  args: Record<string, unknown>,
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
  return readMcpResponse(response);
}

async function loginAndSetup(page: Page) {
  await page.goto("/login");
  await page.getByLabel("实例密码").fill(webPassword);
  await page.getByRole("button", { name: "进入 Time OS" }).click();
  await page.waitForURL(/\/(setup|today)$/);
  // Visiting Setup is supported after first run too and avoids observing an
  // intermediate redirect while a fresh database is being initialized.
  await page.goto("/setup");
  await page.getByLabel("Timezone").fill("Asia/Shanghai");
  await page.getByRole("button", { name: "完成 Setup" }).click();
  await page.waitForURL(/\/today$/);
}

test("manual history requires overlap confirmation and keeps cancelled records in audit view", async ({
  page,
}) => {
  await loginAndSetup(page);

  await page.goto("/goals");
  await page
    .getByPlaceholder("例如：发布 Time OS MVP")
    .fill("History E2E Goal");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  const goal = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "History E2E Goal" })
    .first();
  await goal.getByPlaceholder("新 Track").fill("History E2E Track");
  await goal.getByRole("button", { name: "添加 Track" }).click();
  await expect(
    page.getByRole("link", { name: "History E2E Track" }),
  ).toBeVisible();

  await page.goto("/history");
  const addSession = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Add Session" }) });
  await addSession
    .getByLabel("Track")
    .selectOption({ label: "History E2E Track (active)" });
  await addSession.getByLabel("Duration (minutes)").fill("30");
  await addSession.getByLabel("Ended at").fill("2020-01-02T10:00");
  await addSession.getByLabel("Note").fill("First historical record");
  await addSession.getByRole("button", { name: "Add Session" }).click();

  const rows = page
    .locator("li.rounded-xl")
    .filter({ hasText: "History E2E Track" });
  await expect(rows).toHaveCount(1);

  await addSession.getByLabel("Note").fill("Overlapping historical record");
  await addSession.getByRole("button", { name: "Add Session" }).click();
  await expect(
    page.getByText(/The Session overlaps an existing record/i),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save anyway" }).click();
  await expect(rows).toHaveCount(2);

  await rows.first().getByRole("button").first().click();
  await expect(
    page.getByRole("heading", { name: "Edit record" }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await rows.first().getByRole("button", { name: "Cancel Session" }).click();
  await expect(rows).toHaveCount(1);

  await page.getByLabel("Audit cancelled").check();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("cancelled").first()).toBeVisible();
});

test("MCP log/overlap/stats and Web correction share one history contract", async ({
  page,
  request,
}) => {
  await loginAndSetup(page);

  const goalResponse = await callTool(request, 10, "goal_create", {
    title: "MCP History Goal",
  });
  const goalId = goalResponse.result.structuredContent.data.id as string;
  const trackResponse = await callTool(request, 11, "track_create", {
    goalId,
    title: "MCP History Track",
  });
  const trackId = trackResponse.result.structuredContent.data.id as string;

  const firstResponse = await callTool(request, 12, "session_log", {
    trackId,
    durationSeconds: 1800,
    endedAt: "2019-01-02T10:00:00.000Z",
    note: "First MCP record",
    idempotencyKey: "history-e2e-first",
  });
  expect(firstResponse.result.structuredContent.ok).toBe(true);

  const overlappingInput = {
    trackId,
    durationSeconds: 1800,
    endedAt: "2019-01-02T10:15:00.000Z",
    note: "MCP record to edit",
  };
  const rejected = await callTool(request, 13, "session_log", overlappingInput);
  expect(rejected.result.structuredContent).toMatchObject({
    ok: false,
    error: { code: "SESSION_TIME_OVERLAP" },
  });
  const confirmed = await callTool(request, 14, "session_log", {
    ...overlappingInput,
    allowOverlap: true,
  });
  const confirmedId = confirmed.result.structuredContent.data.id as string;

  const stats = await callTool(request, 15, "stats_get", {
    period: "custom",
    from: "2019-01-02T09:00:00.000Z",
    to: "2019-01-02T11:00:00.000Z",
    now: "2019-01-02T11:00:00.000Z",
  });
  expect(stats.result.structuredContent.data).toMatchObject({
    totalFocusSeconds: 3600,
    sessionCount: 2,
    timezone: "Asia/Shanghai",
  });

  await page.goto(`/history?trackId=${trackId}`);
  const rows = page
    .locator("li.rounded-xl")
    .filter({ hasText: "MCP History Track" });
  await expect(rows).toHaveCount(2);
  await rows.first().getByRole("button").first().click();
  await expect(
    page.getByRole("heading", { name: "Edit record" }),
  ).toBeVisible();
  await rows.first().getByLabel("Note").fill("Corrected on Web");
  await rows.first().getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText(/The Session overlaps an existing record/i),
  ).toBeVisible();
  await rows.first().getByRole("button", { name: "Confirm overlap" }).click();
  await expect(rows.first().locator("p.whitespace-pre-wrap")).toHaveText(
    "Corrected on Web",
  );

  const detail = await callTool(request, 16, "session_get", {
    id: confirmedId,
  });
  expect(detail.result.structuredContent.data.note).toBe("Corrected on Web");
});
