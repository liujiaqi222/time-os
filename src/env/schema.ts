import { z } from "zod";

const postgresqlUrl = z.url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === "postgres:" || protocol === "postgresql:";
  },
  { message: "DATABASE_URL must be a PostgreSQL URL." },
);

export const serverEnvironmentSchema = z.object({
  DATABASE_URL: postgresqlUrl,
  TIMEOS_WEB_PASSWORD: z.string().min(12),
  TIMEOS_MCP_TOKEN: z.string().min(32),
  TIMEOS_SESSION_SECRET: z.string().min(32),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(
  input: Record<string, string | undefined>,
): ServerEnvironment {
  return serverEnvironmentSchema.parse(input);
}
