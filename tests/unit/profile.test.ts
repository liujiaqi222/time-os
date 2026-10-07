// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/components/login-form";
import { ProfileForm } from "@/components/profile-form";
import { userNameSchema } from "@/shared/schemas/profile";
import { authClient } from "@/auth/auth-client";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/auth/auth-client", () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    updateUser: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("owner profile", () => {
  it("trims names and rejects blank or oversized values", () => {
    expect(userNameSchema.parse("  小刘  ")).toBe("小刘");
    for (const name of ["", "  ", "a".repeat(41), null]) {
      expect(userNameSchema.safeParse(name).success).toBe(false);
    }
  });

  it("shows first-run fields and rejects mismatching passwords without signup", async () => {
    render(
      createElement(LoginForm, { returnPath: "/today", ownerExists: false }),
    );
    fireEvent.change(screen.getByLabelText("你的名称"), {
      target: { value: "小刘" },
    });
    fireEvent.change(screen.getByLabelText("设置实例密码"), {
      target: { value: "long-password-123" },
    });
    fireEvent.change(screen.getByLabelText("确认实例密码"), {
      target: { value: "long-password-456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并进入 Time OS" }));
    await screen.findByText("两次输入的密码不一致。");
    expect(authClient.signUp.email).not.toHaveBeenCalled();
  });

  it("passes the chosen name on signup", async () => {
    vi.mocked(authClient.signUp.email).mockResolvedValue({
      error: { message: "test failure" },
      data: null,
    } as never);
    render(
      createElement(LoginForm, { returnPath: "/today", ownerExists: false }),
    );
    fireEvent.change(screen.getByLabelText("你的名称"), {
      target: { value: " 小刘 " },
    });
    for (const label of ["设置实例密码", "确认实例密码"]) {
      fireEvent.change(screen.getByLabelText(label), {
        target: { value: "long-password-123" },
      });
    }
    fireEvent.click(screen.getByRole("button", { name: "保存并进入 Time OS" }));
    await waitFor(() =>
      expect(authClient.signUp.email).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "小刘",
          password: "long-password-123",
        }),
      ),
    );
  });

  it("does not offer account creation for an existing owner", () => {
    render(
      createElement(LoginForm, { returnPath: "/today", ownerExists: true }),
    );
    expect(screen.queryByLabelText("你的名称")).toBeNull();
    expect(screen.queryByLabelText("确认实例密码")).toBeNull();
    expect(screen.getByLabelText("实例密码")).toBeTruthy();
  });

  it("saves a name with Better Auth and refreshes the profile", async () => {
    vi.mocked(authClient.updateUser).mockResolvedValue({
      data: { status: true },
      error: null,
    } as never);
    render(createElement(ProfileForm, { name: "Time OS Owner" }));
    fireEvent.change(screen.getByLabelText("你的名称"), {
      target: { value: " 小刘 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
    await screen.findByText("名称已保存。");
    expect(authClient.updateUser).toHaveBeenCalledWith({ name: "小刘" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("allows retry after a failed save without reporting success", async () => {
    vi.mocked(authClient.updateUser).mockRejectedValue(new Error("network"));
    render(createElement(ProfileForm, { name: "小刘" }));
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
    await screen.findByText("暂时无法连接，请稍后重试。");
    expect(screen.queryByText("名称已保存。")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "保存名称" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
