import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });

export default async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for E2E.");
  const parsed = new URL(databaseUrl);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    !parsed.pathname.endsWith("_test")
  ) {
    throw new Error("E2E refuses to reset a non-local or non-test database.");
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query("drop schema if exists public cascade");
    await pool.query("drop schema if exists drizzle cascade");
    await pool.query("create schema public");
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}
