import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { createPlanningService } from "@/services/planning";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * Development seed for a fresh v3 database (PRD §11: new-version structure
 * initialization only, no legacy transformation). Refuses to touch a
 * database that already has Goals unless --force is passed.
 *
 * Usage: pnpm db:migrate && pnpm db:seed
 */
async function main() {
  const force = process.argv.includes("--force");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed the database.");
  }
  const parsedUrl = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(parsedUrl.hostname)) {
    throw new Error("Seed refuses to run against a remote database.");
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle({ client: pool, schema });
  const planningService = createPlanningService(database);
  const context = { actor: "web" } as const;

  try {
    const existing = await pool.query<{ count: string }>(
      "select count(*) from goals",
    );
    const count = Number(existing.rows[0]?.count ?? 0);
    if (count > 0 && !force) {
      console.info(
        `数据库已有 ${count} 个目标，跳过 seed（--force 可在已有数据上追加）。`,
      );
      return;
    }

    const goal = await planningService.createGoal(context, {
      title: "把产品介绍页改完",
      description: "让访客一眼明白这个产品解决什么问题。",
    });
    await planningService.createTasks(context, {
      goalId: goal.id,
      tasks: [
        { title: "整理现有素材", estimatedMinutes: 20 },
        { title: "写首屏文案初稿" },
        { title: "做一版配图" },
      ],
    });

    const side = await planningService.createGoal(context, {
      title: "每周保持三次慢跑",
    });
    await planningService.createTasks(context, {
      goalId: side.id,
      tasks: [{ title: "周二傍晚 5 公里" }, { title: "周四清晨 3 公里" }],
    });

    console.info("Seed 完成：2 个目标、5 个任务。执行页已可一键开始。");
  } finally {
    await pool.end();
  }
}

void main();
