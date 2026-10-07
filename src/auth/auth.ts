import "server-only";

import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { sql } from "drizzle-orm";

import * as authSchema from "@/db/auth-schema";
import { authDb } from "@/db/client";
import { env } from "@/env";
import { OWNER_EMAIL } from "@/auth/constants";
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "@/auth/scopes";
import { userNameSchema } from "@/shared/schemas/profile";

export { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "@/auth/scopes";

const appOrigin = new URL(env.BETTER_AUTH_URL).origin;
export const MCP_RESOURCE = new URL("/mcp", appOrigin).toString();

export const auth = betterAuth({
  appName: "Time OS",
  baseURL: appOrigin,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(authDb, { provider: "pg", schema: authSchema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 90,
    updateAge: 60 * 60 * 24,
  },
  trustedOrigins: [appOrigin],
  telemetry: { enabled: false },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (user.email !== OWNER_EMAIL) {
            throw new APIError("BAD_REQUEST", {
              message: "This Time OS instance accepts one owner account.",
            });
          }

          // The fixed owner email is unique. Together with this preflight check,
          // concurrent first-run claims fail closed at the database constraint.
          const existing = await authDb.execute(
            sql`select 1 from "user" limit 1`,
          );
          if (existing.rows.length > 0) {
            throw new APIError("BAD_REQUEST", {
              message: "This Time OS instance already has an owner.",
            });
          }

          const parsed = userNameSchema.safeParse(user.name);
          if (!parsed.success) {
            throw new APIError("BAD_REQUEST", {
              message: parsed.error.issues[0].message,
            });
          }

          return {
            data: {
              ...user,
              email: OWNER_EMAIL,
              name: parsed.data,
            },
          };
        },
      },
      update: {
        before: async (user) => {
          if (user.name === undefined) return;
          const parsed = userNameSchema.safeParse(user.name);
          if (!parsed.success) {
            throw new APIError("BAD_REQUEST", {
              message: parsed.error.issues[0].message,
            });
          }
          return { data: { ...user, name: parsed.data } };
        },
      },
    },
  },
  plugins: [
    jwt(),
    mcp({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      resource: MCP_RESOURCE,
      scopes: ["offline_access", MCP_READ_SCOPE, MCP_WRITE_SCOPE],
      resources: [
        {
          identifier: MCP_RESOURCE,
          allowedScopes: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
          accessTokenTtl: 60 * 60,
        },
      ],
    }),
    cimd({
      fetchClientMetadataResource,
      metadataProfile: "mcp-2026-07-28",
      isMetadataDocumentUrlAllowed(clientIdUrl) {
        return new URL(clientIdUrl).hostname === "chatgpt.com";
      },
    }),
    // Required for auth.api calls made from Next.js Server Actions.
    nextCookies(),
  ],
});

export async function hasOwner(): Promise<boolean> {
  try {
    const result = await authDb.execute(sql`select 1 from "user" limit 1`);
    return result.rows.length > 0;
  } catch (error) {
    // Let schema diagnostics remain actionable instead of presenting a
    // misleading first-run account form when migrations have not run.
    throw new Error("Better Auth schema is not ready.", { cause: error });
  }
}
