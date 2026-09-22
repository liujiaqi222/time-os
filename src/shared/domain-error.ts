export const domainErrorCodes = [
  "ACTIVE_SESSION_EXISTS",
  "SESSION_NOT_FOUND",
  "INVALID_SESSION_STATE",
  "SESSION_TIME_OVERLAP",
  "TASK_NOT_IN_TRACK",
  "TASK_NOT_PENDING",
  "TASK_ALREADY_COMPLETED",
  "INVALID_NEXT_TASK",
  "TRACK_NOT_ACTIVE",
  "GOAL_NOT_ACTIVE",
  "PARENT_HAS_ACTIVE_SESSION",
  "INVALID_POSITION_ORDER",
  "IDEMPOTENCY_KEY_REUSED",
  "INVALID_SETTINGS",
  "DATABASE_UNAVAILABLE",
  "SCHEMA_NOT_READY",
  "UNAUTHORIZED",
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
