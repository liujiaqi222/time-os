import { SettingsForm } from "@/components/settings-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { settingsService } from "@/services";
import { timerModeLabel } from "@/shared/labels";
import Link from "next/link";

export default async function SettingsPage() {
  const settings = await settingsService.get({ actor: "web" });
  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-2">
        <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
          实例
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">设置</h1>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>时间偏好</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm
            mode="settings"
            timezone={settings.timezone}
            weekStartsOn={settings.weekStartsOn}
          />
          <p className="mt-4 text-xs text-stone-500">
            当前计时偏好：{timerModeLabel[settings.timerMode]}
            （番茄钟偏好设置随番茄钟功能提供）。
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>目标与任务</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-stone-600">
          <p>完整的目标与任务管理入口。</p>
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href="/goals" />}
          >
            打开目标管理
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>MCP 地址</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-stone-600">
          <code className="rounded bg-stone-100 px-2 py-1 text-stone-900">
            /mcp
          </code>
          <p>
            Authorization: Bearer YOUR_MCP_TOKEN。出于安全考虑，真实 Token
            永不回显。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
