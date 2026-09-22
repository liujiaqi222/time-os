import type { Database } from "@/db/client";

export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export interface TransactionBoundary {
  run<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
}

export function createTransactionBoundary(
  database: Database,
): TransactionBoundary {
  return {
    run(work) {
      return database.transaction(work);
    },
  };
}
