import type { SourceSpan } from "./ast.js";

export type AXQLErrorPhase = "parse" | "validate" | "evaluate";

export type AXQLErrorCode =
  | "UNEXPECTED_TOKEN"
  | "INVALID_CHARACTER"
  | "INVALID_NUMBER"
  | "INVALID_STRING"
  | "INVALID_AST"
  | "UNKNOWN_OPERATOR"
  | "UNKNOWN_FUNCTION"
  | "INVALID_ARITY"
  | "INVALID_LIMIT"
  | "NODE_LIMIT_EXCEEDED"
  | "DEPTH_LIMIT_EXCEEDED"
  | "STEP_LIMIT_EXCEEDED"
  | "TYPE_MISMATCH"
  | "DIVISION_BY_ZERO"
  | "NON_FINITE_NUMBER"
  | "INVALID_CONTEXT"
  | "ACCESSOR_NOT_ALLOWED"
  | "INTERNAL_ERROR";

export interface AXQLErrorOptions {
  readonly phase: AXQLErrorPhase;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly location?: SourceSpan;
}

export class AXQLError extends Error {
  readonly code: AXQLErrorCode;
  readonly phase: AXQLErrorPhase;
  readonly details: Readonly<Record<string, unknown>>;
  readonly location: SourceSpan | undefined;

  constructor(code: AXQLErrorCode, message: string, options: AXQLErrorOptions) {
    super(message);
    this.name = "AXQLError";
    this.code = code;
    this.phase = options.phase;
    this.details = options.details ?? {};
    this.location = options.location;
  }
}

export class ParseError extends AXQLError {
  constructor(
    code: Extract<AXQLErrorCode, "UNEXPECTED_TOKEN" | "INVALID_CHARACTER" | "INVALID_NUMBER" | "INVALID_STRING">,
    message: string,
    options: Omit<AXQLErrorOptions, "phase"> = {},
  ) {
    super(code, message, { ...options, phase: "parse" });
    this.name = "ParseError";
  }
}

export class ValidationError extends AXQLError {
  constructor(
    code: Extract<AXQLErrorCode, "INVALID_AST" | "UNKNOWN_OPERATOR" | "UNKNOWN_FUNCTION" | "INVALID_ARITY" | "INVALID_LIMIT">,
    message: string,
    options: Omit<AXQLErrorOptions, "phase"> = {},
  ) {
    super(code, message, { ...options, phase: "validate" });
    this.name = "ValidationError";
  }
}

export class EvaluationError extends AXQLError {
  constructor(
    code: Extract<
      AXQLErrorCode,
      | "TYPE_MISMATCH"
      | "DIVISION_BY_ZERO"
      | "NON_FINITE_NUMBER"
      | "INVALID_CONTEXT"
      | "ACCESSOR_NOT_ALLOWED"
      | "INTERNAL_ERROR"
    >,
    message: string,
    options: Omit<AXQLErrorOptions, "phase"> = {},
  ) {
    super(code, message, { ...options, phase: "evaluate" });
    this.name = "EvaluationError";
  }
}

export class LimitError extends AXQLError {
  constructor(
    code: Extract<AXQLErrorCode, "NODE_LIMIT_EXCEEDED" | "DEPTH_LIMIT_EXCEEDED" | "STEP_LIMIT_EXCEEDED">,
    message: string,
    options: AXQLErrorOptions,
  ) {
    super(code, message, options);
    this.name = "LimitError";
  }
}
