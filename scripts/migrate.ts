import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

import { inferPublicOrigin } from "../src/shared/public-origin";

config({ path: [".env.local", ".env"], quiet: true });

const databaseUrl = process.env.DATABASE_URL;
const inferredAuthUrl = inferPublicOrigin(process.env);
const betterAuthUrl = process.env.BETTER_AUTH_URL ?? inferredAuthUrl;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply migrations.");
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    if (betterAuthUrl) {
      const resource = new URL(
        "/mcp",
        new URL(betterAuthUrl).origin,
      ).toString();
      // Better Auth also seeds this row lazily. Creating it during the
      // single-process migration step avoids concurrent cold-start workers
      // racing on the unique resource identifier during a production build.
      await pool.query(
        `insert into oauth_resource
          (id, identifier, name, access_token_ttl, allowed_scopes, disabled,
           dpop_bound_access_tokens_required, policy_version, created_at, updated_at)
         values ($1, $2, $2, 3600, $3, false, false, 1, now(), now())
         on conflict (identifier) do nothing`,
        [randomUUID(), resource, ["timeos:read", "timeos:write"]],
      );
    }
    console.info("Time OS database migrations are up to date.");
  } finally {
    await pool.end();
  }
}

void main();
