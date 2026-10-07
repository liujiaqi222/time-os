import { z } from "zod";

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .trim()
  .refine(isIanaTimezone, "Use a valid IANA timezone such as Asia/Shanghai.");
