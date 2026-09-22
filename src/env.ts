import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { serverEnvironmentSchema } from "@/env/schema";

export const env = createEnv({
  server: serverEnvironmentSchema.shape,
  client: {
    NEXT_PUBLIC_APP_NAME: z.string().trim().min(1).default("Time OS"),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    TIMEOS_WEB_PASSWORD: process.env.TIMEOS_WEB_PASSWORD,
    TIMEOS_MCP_TOKEN: process.env.TIMEOS_MCP_TOKEN,
    TIMEOS_SESSION_SECRET: process.env.TIMEOS_SESSION_SECRET,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
