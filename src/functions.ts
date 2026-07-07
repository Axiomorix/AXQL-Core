import type { AXQLValue, LiteralValue } from "./ast.js";
import { EvaluationError } from "./errors.js";

export type StandardFunctionName = "IF" | "IN" | "SUM";

interface FunctionSpec {
  readonly arity: number;
  readonly lazy: boolean;
}

const STANDARD_FUNCTIONS: Readonly<Record<StandardFunctionName, FunctionSpec>> = Object.freeze(Object.assign(Object.create(null) as object, {
  IF: Object.freeze({ arity: 3, lazy: true }),
  IN: Object.freeze({ arity: 2, lazy: false }),
  SUM: Object.freeze({ arity: 1, lazy: false }),
})) as Readonly<Record<StandardFunctionName, FunctionSpec>>;

export function getFunctionSpec(name: string): FunctionSpec | undefined {
  return STANDARD_FUNCTIONS[name as StandardFunctionName];
}

function isScalar(value: AXQLValue): value is LiteralValue {
  return !Array.isArray(value);
}

export function invokeStandardFunction(
  name: Exclude<StandardFunctionName, "IF">,
  args: readonly AXQLValue[],
  consumeStep: () => void,
): AXQLValue {
  if (name === "IN") {
    const value = args[0];
    const list = args[1];
    if (value === undefined || !isScalar(value)) {
      throw new EvaluationError("TYPE_MISMATCH", "IN expects its first argument to be a scalar", {
        details: { function: "IN", argument: 0 },
      });
    }
    if (!Array.isArray(list)) {
      throw new EvaluationError("TYPE_MISMATCH", "IN expects its second argument to be an array", {
        details: { function: "IN", argument: 1 },
      });
    }
    for (const candidate of list) {
      consumeStep();
      if (!isScalar(candidate)) {
        throw new EvaluationError("TYPE_MISMATCH", "IN list elements must be scalars", {
          details: { function: "IN" },
        });
      }
      if (candidate === value) return true;
    }
    return false;
  }

  const values = args[0];
  if (!Array.isArray(values)) {
    throw new EvaluationError("TYPE_MISMATCH", "SUM expects an array", {
      details: { function: "SUM", argument: 0 },
    });
  }
  let total = 0;
  for (const value of values) {
    consumeStep();
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new EvaluationError("TYPE_MISMATCH", "SUM array elements must be finite numbers", {
        details: { function: "SUM" },
      });
    }
    total += value;
    if (!Number.isFinite(total)) {
      throw new EvaluationError("NON_FINITE_NUMBER", "SUM produced a non-finite number", {
        details: { function: "SUM" },
      });
    }
  }
  return total;
}
