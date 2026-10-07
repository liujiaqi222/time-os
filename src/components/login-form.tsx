"use client";

import { FormEvent, useState } from "react";

import { authClient } from "@/auth/auth-client";
import { OWNER_EMAIL } from "@/auth/constants";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { userNameSchema } from "@/shared/schemas/profile";

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

    const name = userNameSchema.safeParse(form.get("name"));
    if (!ownerExists) {
      if (!name.success) {
        setError(name.error.issues[0].message);
        return;
      }
      if (password !== form.get("confirmPassword")) {
        setError("两次输入的密码不一致。");
        return;
      }
    }

    setPending(true);
    setError(undefined);
    try {
      const result = ownerExists
        ? await authClient.signIn.email({
            email: OWNER_EMAIL,
            password,
            callbackURL: returnPath,
          })
        : await authClient.signUp.email({
            email: OWNER_EMAIL,
            name: name.success ? name.data : "Time OS Owner",
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
    } catch {
      setError("暂时无法连接，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {!ownerExists && (
        <Field>
          <FieldLabel htmlFor="name">你的名称</FieldLabel>
          <Input
            id="name"
            name="name"
            autoComplete="nickname"
            maxLength={40}
            required
            autoFocus
          />
          <p className="text-sm text-stone-500">
            怎么称呼你？以后可以在设置中修改。
          </p>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="password">
          {ownerExists ? "实例密码" : "设置实例密码"}
        </FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={ownerExists ? "current-password" : "new-password"}
          autoFocus={ownerExists}
          minLength={12}
          maxLength={128}
          required
          aria-invalid={Boolean(error)}
        />
        {!ownerExists && (
          <p className="text-sm text-stone-500">
            至少 12 个字符，不会明文保存，请妥善记住。
          </p>
        )}
      </Field>
      {!ownerExists && (
        <Field>
          <FieldLabel htmlFor="confirmPassword">确认实例密码</FieldLabel>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </Field>
      )}
      <FieldError>{error}</FieldError>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending
          ? ownerExists
            ? "正在登录…"
            : "正在创建…"
          : ownerExists
            ? "进入 Time OS"
            : "保存并进入 Time OS"}
      </Button>
    </form>
  );
}
