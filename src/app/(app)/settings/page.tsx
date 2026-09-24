import { SettingsForm } from "@/components/settings-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { settingsService } from "@/services";

export default async function SettingsPage() {
  const settings = await settingsService.get({ actor: "web" });
  return (
    <div className="max-w-2xl space-y-8">
      <header className="space-y-2">
        <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
          偏好与接入
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">系统偏好</h1>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>时间与专注节奏</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm
            mode="settings"
            timezone={settings.timezone}
            defaultFocusMinutes={settings.defaultFocusMinutes}
            weekStartsOn={settings.weekStartsOn}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>AI 智能体接入端点 (MCP)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-stone-600">
          <p>
            Time OS 支持通过 Model Context Protocol (MCP) 与 Claude
            Code、Codex、ChatGPT 等 AI 工具无缝协作。
            <strong>AI 负责规划与拆解，Time OS 负责保存状态并守护执行。</strong>
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-stone-500">端点地址：</span>
            <code className="rounded bg-stone-100 px-2 py-1 font-mono text-stone-900">
              /mcp
            </code>
          </div>
          <p className="text-xs text-stone-500">
            认证方式：Authorization: Bearer
            YOUR_MCP_TOKEN。出于安全保护，已配置的真实 Token 永不在此回显。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
