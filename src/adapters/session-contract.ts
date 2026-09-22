import { serializeDomainError } from "@/shared/domain-error";
import type { Result } from "@/shared/result";

export async function sessionContract<T>(
  work: () => Promise<T>,
): Promise<Result<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return { ok: false, error: serializeDomainError(error) };
  }
}
