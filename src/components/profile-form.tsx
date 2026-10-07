"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { userNameSchema } from "@/shared/schemas/profile";

export function ProfileForm({ name }: { name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setError(undefined);
    const parsed = userNameSchema.safeParse(
      new FormData(event.currentTarget).get("name"),
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setPending(true);
    try {
      const result = await authClient.updateUser({ name: parsed.data });
      if (result.error) {
        setError("名称保存失败，请确认仍已登录后重试。");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("暂时无法连接，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field>
        <FieldLabel htmlFor="profileName">你的名称</FieldLabel>
        <Input
          id="profileName"
          name="name"
          defaultValue={name}
          autoComplete="nickname"
          maxLength={40}
          required
          aria-invalid={Boolean(error)}
          onChange={() => {
            setSaved(false);
            setError(undefined);
          }}
        />
        <p className="text-sm text-stone-500">
          名称仅用于显示，不是登录账号；仍然使用实例密码登录。
        </p>
        <FieldError>{error}</FieldError>
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "正在保存…" : "保存名称"}
        </Button>
        <span role="status" className="text-sm text-stone-600">
          {saved ? "名称已保存。" : ""}
        </span>
      </div>
    </form>
  );
}
