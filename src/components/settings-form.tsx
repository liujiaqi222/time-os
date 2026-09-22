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
          <FieldLabel htmlFor="timezone">Timezone</FieldLabel>
          <Input
            ref={timezoneInput}
            id="timezone"
            name="timezone"
            defaultValue={props.timezone}
            required
          />
          <FieldDescription>
            使用 IANA 名称，例如 Asia/Shanghai。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="defaultFocusMinutes">Default focus</FieldLabel>
          <Input
            id="defaultFocusMinutes"
            name="defaultFocusMinutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={props.defaultFocusMinutes}
            required
          />
          <FieldDescription>新 Focus Session 的默认分钟数。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="weekStartsOn">Week starts on</FieldLabel>
          <select
            id="weekStartsOn"
            name="weekStartsOn"
            defaultValue={props.weekStartsOn}
            className="border-input bg-background h-9 rounded-lg border px-3 text-sm"
            required
          >
            <option value="1">Monday</option>
            <option value="0">Sunday</option>
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
            ? "完成 Setup"
            : "保存设置"}
      </Button>
    </form>
  );
}
