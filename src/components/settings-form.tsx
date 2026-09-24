"use client";

import { useActionState, useEffect, useRef } from "react";

import { saveSettingsAction } from "@/app/settings/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type SettingsFormProps = {
  mode: "setup" | "settings";
  timezone: string;
  defaultFocusMinutes: number;
  weekStartsOn: number;
  suggestBrowserTimezone?: boolean;
};

export function SettingsForm(props: SettingsFormProps) {
  const [state, action, pending] = useActionState(
    saveSettingsAction,
    undefined,
  );
  const timezoneInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.suggestBrowserTimezone || props.timezone !== "UTC") return;
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const input = timezoneInput.current;
    if (
      browserTimezone &&
      input &&
      input.value === props.timezone &&
      document.activeElement !== input
    ) {
      input.value = browserTimezone;
    }
  }, [props.suggestBrowserTimezone, props.timezone]);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="mode" value={props.mode} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="timezone">所在时区</FieldLabel>
          <Input
            ref={timezoneInput}
            id="timezone"
            name="timezone"
            defaultValue={props.timezone}
            required
          />
          <FieldDescription>
            使用 IANA 时区名称，例如 Asia/Shanghai。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="defaultFocusMinutes">
            默认专注时长（分钟）
          </FieldLabel>
          <Input
            id="defaultFocusMinutes"
            name="defaultFocusMinutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={props.defaultFocusMinutes}
            required
          />
          <FieldDescription>
            开启新专注时刻的默认预设计时时长。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="weekStartsOn">每周起始日</FieldLabel>
          <select
            id="weekStartsOn"
            name="weekStartsOn"
            defaultValue={props.weekStartsOn}
            className="border-input bg-background h-9 rounded-lg border px-3 text-sm"
            required
          >
            <option value="1">周一 (Monday)</option>
            <option value="0">周日 (Sunday)</option>
          </select>
        </Field>
      </FieldGroup>
      {state && (
        <Alert variant={state.status === "error" ? "destructive" : "default"}>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending
          ? "正在保存…"
          : props.mode === "setup"
            ? "完成初始化"
            : "保存设置"}
      </Button>
    </form>
  );
}
