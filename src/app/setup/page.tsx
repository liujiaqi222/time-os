import { redirect } from "next/navigation";
import { CheckCircle2, Database } from "lucide-react";

import { readWebSession } from "@/auth/web-session";
import { SettingsForm } from "@/components/settings-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { settingsService } from "@/services";

// Setup inspects cookies and live database readiness; it has no static form.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await readWebSession())) redirect("/login");

  let settings;
  try {
    await settingsService.checkSchema({ actor: "web" });
    settings = await settingsService.get({ actor: "web" });
  } catch {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center px-5 py-12">
        <Alert variant="destructive">
          <Database aria-hidden="true" />
          <AlertTitle>数据库结构尚未就绪</AlertTitle>
          <AlertDescription>
            确认 DATABASE_URL 可连接，然后执行 pnpm db:migrate。首次配置
            不会自行修改数据库结构。
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-5 py-12">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3">
          <p className="font-mono text-xs tracking-[0.2em] text-stone-500 uppercase">
            首次配置
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            设置你的执行环境
          </h1>
          <p className="max-w-2xl text-stone-600">
            数据库已连接。确认时间设置，然后建立第一个真正想推进的目标。
          </p>
        </header>
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>数据库已就绪</AlertTitle>
          <AlertDescription>连接与数据库迁移检查通过。</AlertDescription>
        </Alert>
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>时间设置</CardTitle>
          </CardHeader>
          <CardContent>
            <SettingsForm
              mode="setup"
              timezone={settings.timezone}
              weekStartsOn={settings.weekStartsOn}
              suggestBrowserTimezone={!settings.setupCompletedAt}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
