"use client";

import { useActionState } from "react";

import { loginAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function LoginForm({ returnPath }: { returnPath: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={returnPath} />
      <Field>
        <FieldLabel htmlFor="password">实例密码</FieldLabel>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          aria-invalid={Boolean(state?.error)}
        />
        <FieldError>{state?.error}</FieldError>
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "正在登录…" : "进入 Time OS"}
      </Button>
    </form>
  );
}
