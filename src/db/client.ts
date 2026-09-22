import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { env } from "@/env";

const globalDatabase = globalThis as unknown as {
  timeOsPool?: Pool;
};

const pool =
  globalDatabase.timeOsPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalDatabase.timeOsPool = pool;
}

export const db = drizzle({ client: pool, schema });
export type Database = typeof db;
