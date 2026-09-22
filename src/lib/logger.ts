import "server-only";

const sensitiveKey = /authorization|cookie|password|secret|token/i;

function redact(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : item,
    ]),
  );
}

export const logger = {
  info(message: string, context?: Record<string, unknown>) {
    console.info(message, context ? redact(context) : "");
  },
  error(message: string, context?: Record<string, unknown>) {
    console.error(message, context ? redact(context) : "");
  },
};
