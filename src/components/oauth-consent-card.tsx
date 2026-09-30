"use client";

import { Check, Link2, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { authClient } from "@/auth/auth-client";
import { Button } from "@/components/ui/button";

const scopeCopy: Record<string, string> = {
  "timeos:read": "读取你的目标、任务和执行记录",
  "timeos:write": "创建和更新目标、任务与执行记录",
  offline_access: "在连接有效期内保持授权，不必每次重新登录",
};

export function OAuthConsentCard({
  clientName,
  scopes,
}: {
  clientName: string;
  scopes: string[];
}) {
  const [pending, setPending] = useState<"accept" | "deny">();
  const [error, setError] = useState<string>();

  async function decide(accept: boolean) {
    setPending(accept ? "accept" : "deny");
    setError(undefined);
    const result = await authClient.oauth2.consent({
      accept,
      ...(accept && scopes.length > 0 ? { scope: scopes.join(" ") } : {}),
    });
    if (result.error) {
      setError("授权没有完成，请回到 ChatGPT 后重试。");
      setPending(undefined);
    }
  }

  return (
    <section className="w-full max-w-lg rounded-[2rem] border border-stone-200 bg-white p-7 shadow-sm sm:p-9">
      <div className="flex items-center gap-3 text-stone-500">
        <div className="grid size-11 place-items-center rounded-2xl bg-stone-950 text-white">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </div>
        <div>
          <p className="font-mono text-xs tracking-[0.16em] uppercase">
            Time OS · 安全连接
          </p>
          <p className="mt-1 text-sm">由你决定是否允许这次访问</p>
        </div>
      </div>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-stone-950">
        连接 {clientName}
      </h1>
      <p className="mt-3 leading-7 text-stone-600">
        授权后，你可以在 ChatGPT 对话中讨论目标，并在确认后让它写入当前 Time OS
        实例。
      </p>

      <div className="mt-7 rounded-2xl bg-stone-50 p-5">
        <p className="flex items-center gap-2 text-sm font-medium text-stone-900">
          <Link2 className="size-4" aria-hidden="true" />
          此连接将能够
        </p>
        <ul className="mt-4 space-y-3">
          {scopes.map((scope) => (
            <li
              key={scope}
              className="flex items-start gap-2 text-sm text-stone-600"
            >
              <Check
                className="mt-0.5 size-4 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
              <span>{scopeCopy[scope] ?? scope}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-5 text-sm leading-6 text-stone-500">
        ChatGPT
        不会获得你的实例密码。你可以稍后在设置中撤销连接；写入操作仍会在对话中由你确认。
      </p>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={Boolean(pending)}
          onClick={() => void decide(false)}
        >
          {pending === "deny" ? "正在取消…" : "取消"}
        </Button>
        <Button
          type="button"
          disabled={Boolean(pending)}
          onClick={() => void decide(true)}
        >
          {pending === "accept" ? "正在连接…" : "允许连接"}
        </Button>
      </div>
    </section>
  );
}
