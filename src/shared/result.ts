import type { SerializedDomainError } from "@/shared/domain-error";

export type Result<T> =
  { ok: true; data: T } | { ok: false; error: SerializedDomainError };
