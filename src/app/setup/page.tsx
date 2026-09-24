import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CheckCircle2, Database, PlugZap } from "lucide-react";

import { readWebSession } from "@/auth/web-session";
import { SettingsForm } from "@/components/settings-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { settingsService } from "@/services";

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
          <AlertTitle>数据库 schema 尚未就绪</AlertTitle>
          <AlertDescription>
            确认 DATABASE_URL 可连接，然后执行 pnpm db:migrate。Setup
            不会自行修改 schema。
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "your-time-os.vercel.app";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const endpoint = `${protocol}://${host}/mcp`;

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
            数据库已连接。确认时间设置，并保存这个实例的 MCP 地址。
          </p>
        </header>
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>数据库连接就绪</AlertTitle>
          <AlertDescription>
            连接与 committed migration 检查通过。
          </AlertDescription>
        </Alert>
        <div className="grid gap-6 md:grid-cols-[1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>时间偏好</CardTitle>
            </CardHeader>
            <CardContent>
              <SettingsForm
                mode="setup"
                timezone={settings.timezone}
                defaultFocusMinutes={settings.defaultFocusMinutes}
                weekStartsOn={settings.weekStartsOn}
                suggestBrowserTimezone={!settings.setupCompletedAt}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlugZap className="size-5" />
                AI 智能体连接 (MCP)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-stone-600">
                真实 Token 不会在网页回显。客户端配置中手动替换占位符。
              </p>
              <pre className="overflow-x-auto rounded-lg bg-stone-950 p-4 text-xs leading-6 text-stone-100">
                {JSON.stringify(
                  {
                    url: endpoint,
                    headers: { Authorization: "Bearer YOUR_MCP_TOKEN" },
                  },
                  null,
                  2,
                )}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
