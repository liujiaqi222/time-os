import { expect, test } from "@playwright/test";
import { loginAndSetup, webPassword } from "./helpers";
import { OWNER_EMAIL } from "@/auth/constants";
import { mkdir, writeFile } from "node:fs/promises";
import { createLocalJWKSet, jwtVerify } from "jose";

test("measure Neon timer click-to-render latency", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  if (!/^timeos_test_[a-f0-9]{32}$/.test(process.env.TIMEOS_TEST_SCHEMA ?? ""))
    throw new Error("Timer latency measurements require an isolated schema.");
  await loginAndSetup(page);
  const samples: {
    operation: string;
    clickToRenderMs: number;
    timing: string | undefined;
    requestToFirstByteMs: number;
    actualClickToRenderMs: number;
  }[] = [];
  for (let iteration = 0; iteration < 3; iteration++) {
    if (process.env.TIMEOS_LATENCY_FRESH === "1")
      await context.clearCookies({ name: /session_data/ });
    const startResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/session/start") &&
        r.request().method() === "POST",
    );
    const started = performance.now();
    const startButton = page.getByRole("button", {
      name: /开始第一次执行|开始专注/,
    });
    await startButton.evaluate((button) =>
      button.addEventListener(
        "click",
        () => sessionStorage.setItem("timer-measure-click", String(Date.now())),
        { capture: true, once: true },
      ),
    );
    await startButton.click();
    const response = await startResponse;
    const body = await response.json();
    expect(body.ok).toBe(true);
    await expect(
      page.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();
    samples.push({
      operation: `start-${iteration}`,
      clickToRenderMs: Math.round(performance.now() - started),
      timing: response.headers()["server-timing"],
      requestToFirstByteMs: Math.round(
        response.request().timing().responseStart,
      ),
      actualClickToRenderMs: await page.evaluate(
        () =>
          Date.now() - Number(sessionStorage.getItem("timer-measure-click")),
      ),
    });

    const pauseResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/session/transition") &&
        r.request().method() === "POST",
    );
    const paused = performance.now();
    const pauseButton = page.getByRole("button", { name: "暂停", exact: true });
    await pauseButton.evaluate((button) =>
      button.addEventListener(
        "click",
        () => sessionStorage.setItem("timer-measure-click", String(Date.now())),
        { capture: true, once: true },
      ),
    );
    await pauseButton.click();
    const pause = await pauseResponse;
    expect((await pause.json()).ok).toBe(true);
    await expect(
      page.getByRole("button", { name: /继续/, exact: false }),
    ).toBeVisible();
    samples.push({
      operation: `pause-${iteration}`,
      clickToRenderMs: Math.round(performance.now() - paused),
      timing: pause.headers()["server-timing"],
      requestToFirstByteMs: Math.round(pause.request().timing().responseStart),
      actualClickToRenderMs: await page.evaluate(
        () =>
          Date.now() - Number(sessionStorage.getItem("timer-measure-click")),
      ),
    });
    const finish = await page.evaluate(async (id) => {
      const response = await fetch("/api/session/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      return response.json();
    }, body.data.id);
    expect(finish.ok).toBe(true);
    await page.reload();
  }
  await mkdir(".test-data", { recursive: true });
  await writeFile(
    `.test-data/timer-latency-${process.env.TIMEOS_LATENCY_LABEL ?? "baseline"}.json`,
    JSON.stringify(samples, null, 2),
  );
  console.log(JSON.stringify(samples));
  // Disabling the automatic web JWT header must retain explicit signing/JWKS.
  const tokenResponse = await page.request.get("/api/auth/token");
  expect(tokenResponse.ok()).toBe(true);
  const { token } = await tokenResponse.json();
  const keysResponse = await page.request.get("/api/auth/jwks");
  expect(keysResponse.ok()).toBe(true);
  await jwtVerify(token, createLocalJWKSet(await keysResponse.json()));
  const signedOutStatus = await page.evaluate(async () => {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const response = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return response.status;
  });
  expect(signedOutStatus).toBe(401);
  const signIn = await page.request.post("/api/auth/sign-in/email", {
    data: { email: OWNER_EMAIL, password: webPassword },
  });
  expect(signIn.ok()).toBe(true);
  const freshSession = await page.request.get(
    "/api/auth/get-session?disableCookieCache=true",
  );
  expect(freshSession.ok()).toBe(true);
  expect((await freshSession.json()).user.email).toBe(OWNER_EMAIL);
});
