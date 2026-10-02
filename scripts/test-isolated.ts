/** Reuse DATABASE_URL while isolating every test table and migration ledger. */
import { config } from "dotenv";
import {
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  config({ path: ".env.local", quiet: true });
  const kind = process.argv[2];
  if (kind !== "integration" && kind !== "e2e")
    throw new Error("Choose integration or e2e.");
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL is required in .env.local.");
  const namespace = `timeos_test_${randomUUID().replaceAll("-", "")}`;
  const directory = await mkdtemp(join(tmpdir(), "timeos-migrations-"));
  const url = new URL(source);
  // Neon transaction pooling rejects a persistent search_path startup option.
  if (url.hostname.endsWith(".neon.tech"))
    url.hostname = url.hostname.replace("-pooler.", ".");
  url.searchParams.set("options", `-c search_path=${namespace}`);
  const pool = new Pool({ connectionString: source, max: 1 });
  try {
    await pool.query(`create schema "${namespace}"`);
    await mkdir(join(directory, "meta"));
    await writeFile(
      join(directory, "meta", "_journal.json"),
      await readFile("drizzle/meta/_journal.json"),
    );
    for (const filename of await readdir("drizzle")) {
      if (!filename.endsWith(".sql")) continue;
      const sql = (await readFile(join("drizzle", filename), "utf8"))
        .replaceAll('"public".', `"${namespace}".`)
        .replaceAll("--> statement-breakpoint", "\n");
      await writeFile(join(directory, filename), sql);
    }
    if (kind === "e2e") {
      const bootstrap = new Pool({ connectionString: url.toString(), max: 1 });
      try {
        await migrate(drizzle(bootstrap), {
          migrationsFolder: directory,
          migrationsSchema: `${namespace}_migrations`,
        });
      } finally {
        await bootstrap.end();
      }
    }
    const child = spawn(
      "pnpm",
      [
        "exec",
        ...(kind === "integration"
          ? ["vitest", "run", "--config", "vitest.integration.config.mts"]
          : ["playwright", "test"]),
        ...process.argv.slice(3),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          TEST_DATABASE_URL: url.toString(),
          TIMEOS_TEST_SCHEMA: namespace,
          TIMEOS_TEST_MIGRATIONS: directory,
        },
      },
    );
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    await pool.query(`drop schema if exists "${namespace}" cascade`);
    await pool.query(`drop schema if exists "${namespace}_migrations" cascade`);
    await pool.end();
    await rm(directory, { recursive: true, force: true });
    if (kind === "e2e")
      await rm(join(".next-tests", namespace), {
        recursive: true,
        force: true,
      });
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Test setup failed.");
  process.exitCode = 1;
});
