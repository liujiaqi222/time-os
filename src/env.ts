import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { serverEnvironmentSchema } from "@/env/schema";
import { inferPublicOrigin } from "@/shared/public-origin";

const inferredAuthUrl = inferPublicOrigin(process.env);

export const env = createEnv({
  server: serverEnvironmentSchema.shape,
  client: {
    NEXT_PUBLIC_APP_NAME: z.string().trim().min(1).default("Time OS"),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? inferredAuthUrl,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
