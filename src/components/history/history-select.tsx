"use client";

import type { ComponentProps } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function HistorySelect({
  id,
  label,
  name,
  value,
  onValueChange,
  options,
  disabled,
  required,
  container,
  className,
}: {
  id?: string;
  label?: string;
  name?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  required?: boolean;
  container?: ComponentProps<typeof SelectContent>["container"];
  className?: string;
}) {
  return (
    <Select
      items={options}
      name={name}
      value={value}
      onValueChange={(value) => onValueChange(value ?? "")}
      disabled={disabled}
      required={required}
    >
      <SelectTrigger
        id={id}
        aria-label={label}

        className={className ?? "mt-1 h-10 w-full min-w-0 bg-white px-3"}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        container={container}
        align="start"
        alignItemWithTrigger={false}
      >
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
