export const domainErrorCodes = [
  // PRD §9.3 — the registered domain error family.
  "UNAUTHORIZED",
  "GOAL_NOT_FOUND",
  "GOAL_NOT_ACTIVE",
  "TASK_NOT_IN_GOAL",
  "TASK_NOT_PENDING",
  "ACTIVE_SESSION_EXISTS",
  "PARENT_HAS_ACTIVE_SESSION",
  "SESSION_NOT_FOUND",
  "INVALID_SESSION_STATE",
  "STALE_SESSION_PHASE",
  "VERSION_CONFLICT",
  "SESSION_TIME_OVERLAP",
  "INVALID_POSITION_ORDER",
  "IDEMPOTENCY_KEY_REUSED",
  // Supporting codes for entities and infrastructure.
  "TASK_NOT_FOUND",
  "DISTRACTION_NOT_FOUND",
  "INVALID_INPUT",
  "INVALID_SETTINGS",
  "DATABASE_UNAVAILABLE",
  "SCHEMA_NOT_READY",
  "TOO_MANY_ATTEMPTS",
  "INTERNAL_ERROR",
] as const;

export type DomainErrorCode = (typeof domainErrorCodes)[number];
export type DomainErrorContext = Record<
  string,
  string | number | boolean | null
>;

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly context?: DomainErrorContext;

  constructor(
    code: DomainErrorCode,
    message: string,
    context?: DomainErrorContext,
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.context = context;
  }
}

export interface SerializedDomainError {
  code: DomainErrorCode;
  message: string;
  context?: DomainErrorContext;
}

export function serializeDomainError(error: unknown): SerializedDomainError {
  if (error instanceof DomainError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.context ? { context: error.context } : {}),
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  };
}
