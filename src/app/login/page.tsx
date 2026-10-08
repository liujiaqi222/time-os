import type { Metadata } from "next";

import { hasOwner } from "@/auth/auth";
import { safeReturnPath } from "@/auth/secrets";
import { LoginForm } from "@/components/login-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const query = await searchParams;
  const next = Array.isArray(query.next) ? query.next[0] : query.next;
  const ownerExists = await hasOwner();
  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f1ea] px-5 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 space-y-2">
          <p className="font-mono text-xs tracking-[0.2em] text-stone-500 uppercase">
            执行系统
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-stone-950">
            Time OS
          </h1>
          <p className="text-stone-600">记住下一步，也记住你真正投入的时间。</p>
        </div>
        <Card className="border-stone-300 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>{ownerExists ? "欢迎回来" : "设置实例密码"}</CardTitle>
            <p className="text-sm leading-6 text-stone-500">
              {ownerExists
                ? "这个实例已设置密码，请输入密码继续。"
                : "第一次使用，设置你的名称和密码。以后在其他设备上也用这个密码登录。"}
            </p>
          </CardHeader>
          <CardContent>
            <LoginForm
              returnPath={safeReturnPath(next)}
              ownerExists={ownerExists}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
