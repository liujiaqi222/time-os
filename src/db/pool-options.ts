import type { PoolConfig } from "pg";

type PoolRuntimeEnvironment = Record<string, string | undefined>;

export function databasePoolOptions(
  environment: PoolRuntimeEnvironment,
): Pick<
  PoolConfig,
  | "max"
  | "idleTimeoutMillis"
  | "keepAlive"
  | "allowExitOnIdle"
  | "connectionTimeoutMillis"
> {
  const isVercel = environment.VERCEL === "1";

  return {
    // A Vercel deployment can run several isolated function instances at
    // once. Keep each instance to one PgBouncer client instead of multiplying
    // the Neon connection demand by the local-development pool size.
    max: isVercel ? 1 : 10,
    idleTimeoutMillis: isVercel ? 5_000 : 300_000,
    keepAlive: true,
    allowExitOnIdle: isVercel,
    connectionTimeoutMillis: isVercel ? 20_000 : 10_000,
  };
}
