import { ValidationError } from "./errors.js";

export interface ExecutionLimits {
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxSteps: number;
}

export const DEFAULT_LIMITS: Readonly<ExecutionLimits> = Object.freeze({
  maxNodes: 500,
  maxDepth: 32,
  maxSteps: 10_000,
});

export interface LimitOptions {
  readonly limits?: Partial<ExecutionLimits>;
}

export function resolveLimits(overrides?: Partial<ExecutionLimits>): ExecutionLimits {
  const limits: ExecutionLimits = {
    maxNodes: overrides?.maxNodes ?? DEFAULT_LIMITS.maxNodes,
    maxDepth: overrides?.maxDepth ?? DEFAULT_LIMITS.maxDepth,
    maxSteps: overrides?.maxSteps ?? DEFAULT_LIMITS.maxSteps,
  };

  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ValidationError("INVALID_LIMIT", `${name} must be a positive safe integer`, {
        details: { name, value },
      });
    }
  }

  return limits;
}
