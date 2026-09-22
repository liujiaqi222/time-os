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
    // Allow a request to run several queries in parallel (Promise.all in
    // services). Neon's pooled endpoint multiplexes clients, so this is safe.
    max: 10,
    // Opening a TLS connection to remote Postgres (e.g. Neon behind a proxy)
    // costs seconds, so keep idle connections around instead of dropping
    // them after the 10s default and re-paying the handshake every visit.
    idleTimeoutMillis: 300_000,
    keepAlive: true,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalDatabase.timeOsPool = pool;
}

export const db = drizzle({ client: pool, schema });
export type Database = typeof db;
