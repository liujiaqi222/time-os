import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/auth/web-session", () => ({ readWebSession: vi.fn() }));
vi.mock("@/services", () => ({
  sessionService: {
    pauseSession: vi.fn(),
    resumeSession: vi.fn(),
    cancelSession: vi.fn(),
  },
}));

import { POST } from "@/app/api/session/transition/route";
import { readWebSession } from "@/auth/web-session";
import { sessionService } from "@/services";

const id = "00000000-0000-4000-8000-000000000001";
function request(operation: string, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/session/transition", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ id, operation }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
});

it("rejects cross-origin requests before authentication or mutation", async () => {
  expect((await POST(request("pause", "https://other.example"))).status).toBe(
    403,
  );
  expect(readWebSession).not.toHaveBeenCalled();
  expect(sessionService.pauseSession).not.toHaveBeenCalled();
});
it("rejects unauthenticated timer mutations", async () => {
  vi.mocked(readWebSession).mockResolvedValue(false);
  expect((await POST(request("pause"))).status).toBe(401);
  expect(sessionService.pauseSession).not.toHaveBeenCalled();
});
it.each(["pause", "resume", "cancel"] as const)(
  "dispatches an authenticated %s to the shared service",
  async (operation) => {
    vi.mocked(readWebSession).mockResolvedValue(true);
    const response = await POST(request(operation));
    expect(response.status).toBe(200);
    expect(
      operation === "pause"
        ? sessionService.pauseSession
        : operation === "resume"
          ? sessionService.resumeSession
          : sessionService.cancelSession,
    ).toHaveBeenCalledWith({ actor: "web" }, id);
  },
);
it("rejects unsupported operations without mutating", async () => {
  vi.mocked(readWebSession).mockResolvedValue(true);
  expect((await POST(request("finish"))).status).toBe(400);
  expect(sessionService.pauseSession).not.toHaveBeenCalled();
  expect(sessionService.resumeSession).not.toHaveBeenCalled();
});
