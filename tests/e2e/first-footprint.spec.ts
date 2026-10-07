import { expect, test } from "@playwright/test";
import { createMcpAccessToken, loginAndSetup, mcpCall } from "./helpers";
import { localDateKey } from "@/shared/timezone";

test("the first saved execution lights the same real calendar and keeps zero days blank", async ({
  page,
  request,
}) => {
  await loginAndSetup(page);
  const token = await createMcpAccessToken(request);
  await page.getByRole("button", { name: "正计时", exact: true }).click();
  await page.getByRole("button", { name: /开始第一次执行|开始专注/ }).click();
  let seq = 10;
  await expect
    .poll(async () => {
      const r = await mcpCall(request, token, seq++, "session_get_active", {});
      return r.result.structuredContent.data?.focusSeconds ?? 0;
    })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "结束并保存", exact: true }).click();
  await expect(page.getByText("专注已保存", { exact: true })).toBeVisible();
  const feedback = page.getByRole("region", { name: "首次执行足迹" });
  await expect(feedback).toContainText("第一段投入，已经留下足迹");
  const today = localDateKey(new Date(), "Asia/Shanghai");
  const button = feedback.getByRole("button", {
    name: new RegExp(`^${today}，`),
  });
  await expect(button).not.toHaveAttribute("aria-label", new RegExp("，0 秒"));
  const label = await button.getAttribute("aria-label");
  await button.click();
  await expect(
    page.getByRole("heading", { name: "时间留下的痕迹" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: label!, exact: true }),
  ).toBeVisible();
});
