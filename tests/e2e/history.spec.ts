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
  await page.getByLabel("时区").fill("Asia/Shanghai");
  await page.getByRole("button", { name: "完成设置" }).click();
  await page.waitForURL(/\/today$/);
}

test("manual history requires overlap confirmation and keeps cancelled records in audit view", async ({
  page,
}) => {
  await loginAndSetup(page);

  await page.goto("/goals");
  await page.getByText("新建目标", { exact: true }).click();
  await page
    .getByPlaceholder("例如：发布 Time OS MVP")
    .fill("History E2E Goal");
  await page.getByRole("button", { name: "创建目标" }).click();
  const goal = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "History E2E Goal" })
    .first();
  await goal.getByText("＋ 添加推进线", { exact: true }).click();
  await goal.getByLabel("推进线名称").fill("History E2E Track");
  await goal.getByRole("button", { name: "创建推进线" }).click();
  await expect(
    page.getByRole("link", { name: "History E2E Track" }),
  ).toBeVisible();

  await page.goto("/history");
  const addSession = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "补录一段" }) });
  await addSession
    .getByLabel("推进线")
    .selectOption({ label: "History E2E Track (进行中)" });
  await addSession.getByLabel("时长（分钟）").fill("30");
  await addSession.getByLabel("结束于").fill("2020-01-02T10:00");
  await addSession.getByLabel("笔记").fill("First historical record");
  await addSession.getByRole("button", { name: "补录一段" }).click();

  const rows = page
    .locator("li.rounded-xl")
    .filter({ hasText: "History E2E Track" });
  await expect(rows).toHaveCount(1);

  await addSession.getByLabel("笔记").fill("Overlapping historical record");
  await addSession.getByRole("button", { name: "补录一段" }).click();
  await expect(
    page.getByText(/这段专注与「History E2E Track」的时间冲突/),
  ).toBeVisible();
  await page.getByRole("button", { name: "仍然保存" }).click();
  await expect(rows).toHaveCount(2);

  await rows.first().getByRole("button").first().click();
  await expect(page.getByRole("heading", { name: "编辑记录" })).toBeVisible();
  await rows.first().getByRole("button", { name: "取消这段专注" }).click();
  await page.getByRole("button", { name: "确认取消" }).click();
  await expect(rows).toHaveCount(1);

  await page.getByLabel("含已取消").check();
  await page.getByRole("button", { name: "应用" }).click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByText("已取消").first()).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "编辑记录" })).toBeVisible();
  await rows.first().getByLabel("笔记").fill("Corrected on Web");
  await rows.first().getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText(/这段专注与已有记录的时间冲突/)).toBeVisible();
  await rows.first().getByRole("button", { name: "确认重叠" }).click();
  await expect(rows.first().locator("p.whitespace-pre-wrap")).toHaveText(
    "Corrected on Web",
  );

  const detail = await callTool(request, 16, "session_get", {
    id: confirmedId,
  });
  expect(detail.result.structuredContent.data.note).toBe("Corrected on Web");
});
