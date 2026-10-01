"use client";

import { FormEvent, useState } from "react";

import { authClient } from "@/auth/auth-client";
import { OWNER_EMAIL } from "@/auth/constants";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function LoginForm({
  returnPath,
  ownerExists,
}: {
  returnPath: string;
  ownerExists: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    if (typeof password !== "string" || !password) return;

    setPending(true);
    setError(undefined);
    const result = ownerExists
      ? await authClient.signIn.email({
          email: OWNER_EMAIL,
          password,
          callbackURL: returnPath,
        })
      : await authClient.signUp.email({
          email: OWNER_EMAIL,
          name: "Time OS Owner",
          password,
          callbackURL: returnPath,
        });

    if (result.error) {
      setError(
        ownerExists
          ? "密码不正确，或登录暂时不可用。"
          : result.error.message || "暂时无法创建实例账户。",
      );
      setPending(false);
      return;
    }

    // The OAuth provider returns its own redirect after restoring the signed
    // ChatGPT authorization request. Do not overwrite it with the ordinary
    // application fallback.
    const redirect = result.data as {
      redirect?: boolean;
      url?: string;
    } | null;
    if (!redirect?.redirect || !redirect.url) {
      window.location.assign(returnPath);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field>
        <FieldLabel htmlFor="password">
          {ownerExists ? "实例密码" : "设置实例密码"}
        </FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={ownerExists ? "current-password" : "new-password"}
          autoFocus
          minLength={12}
          required
          aria-invalid={Boolean(error)}
        />
        {!ownerExists && (
          <p className="text-sm text-stone-500">
            至少 12 个字符，仅保存在当前实例。
          </p>
        )}
        <FieldError>{error}</FieldError>
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending
          ? ownerExists
            ? "正在登录…"
            : "正在创建…"
          : ownerExists
            ? "进入 Time OS"
            : "创建并进入 Time OS"}
      </Button>
    </form>
  );
}
