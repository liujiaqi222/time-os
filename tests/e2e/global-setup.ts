import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });

export default async function globalSetup() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for E2E.");
  const parsed = new URL(databaseUrl);
  const testSchema = process.env.TIMEOS_TEST_SCHEMA ?? "public";
  const isolated = /^timeos_test_[a-f0-9]{32}$/.test(testSchema);
  const migrationsSchema = isolated ? `${testSchema}_migrations` : "drizzle";
  if (
    !isolated &&
    (!["localhost", "127.0.0.1"].includes(parsed.hostname) ||
      !parsed.pathname.endsWith("_test"))
  ) {
    throw new Error("E2E refuses to reset a non-local or non-test database.");
  }

  // The isolated runner migrates before the web server starts to avoid auth cold-start races.
  if (isolated) return;
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query(`drop schema if exists "${testSchema}" cascade`);
    await pool.query(`drop schema if exists "${migrationsSchema}" cascade`);
    await pool.query(`create schema "${testSchema}"`);
    await migrate(drizzle(pool), {
      migrationsFolder: process.env.TIMEOS_TEST_MIGRATIONS ?? "drizzle",
      migrationsSchema,
    });
  } finally {
    await pool.end();
  }
}
