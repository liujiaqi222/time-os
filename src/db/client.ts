import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as authSchema from "@/db/auth-schema";
import * as domainSchema from "@/db/schema";
import { databasePoolOptions } from "@/db/pool-options";
import { env } from "@/env";

const globalDatabase = globalThis as unknown as {
  timeOsPool?: Pool;
};

const pool =
  globalDatabase.timeOsPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    ...databasePoolOptions(process.env),
  });

// HMR retains this pool across edits. Apply current limits to the retained
// instance too, otherwise an older one-connection pool keeps queuing reads.
Object.assign(pool.options, databasePoolOptions(process.env));

// Next.js can evaluate the database module from multiple route bundles inside
// one process. Reuse one pool in production too, not just during local HMR.
globalDatabase.timeOsPool = pool;

export const databaseSchema = { ...domainSchema, ...authSchema };
export const db = drizzle({ client: pool, schema: domainSchema });
export const authDb = drizzle({ client: pool, schema: databaseSchema });
export type Database = typeof db;
