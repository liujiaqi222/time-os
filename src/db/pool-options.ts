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
    // Concurrent requests share each instance's pool. Allow parallel queries
    // while retaining a bounded pool and releasing idle Vercel connections.
    max: 10,
    idleTimeoutMillis: isVercel ? 5_000 : 300_000,
    keepAlive: true,
    allowExitOnIdle: isVercel,
    connectionTimeoutMillis: isVercel ? 20_000 : 10_000,
  };
}
